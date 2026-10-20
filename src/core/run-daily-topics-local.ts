import { writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactStore } from './artifact-store.js';
import { createAgentPorts } from './agent-factory.js';
import { ContentPipeline } from './pipeline.js';
import { findTopicBySlug, loadProjectKnowledge, sortTopicsForQueue, topicKnownFacts, topicToInternalLinks, type TopicQueueItem } from './project-knowledge.js';
import { TopicQueueStore, type TopicQueueEntry } from './topic-queue.js';
import { contentApiUrlFromEnv } from '../config.js';
import type { MaterialKind, PipelineRequest } from './types.js';

const limit = Math.max(1, Number(process.argv[2] || process.env.DAILY_ARTICLE_LIMIT || 5));
const maxSteps = Math.max(20, Number(process.env.DAILY_ARTICLE_MAX_STEPS || 160));
const dataDir = process.env.DATA_DIR || './data';
const projectKnowledge = await loadProjectKnowledge(process.env.HANDOFF_KONVEYER_DIR);
if (!projectKnowledge) throw new Error('HANDOFF_KONVEYER_DIR is required for daily topic runs.');
const knowledge = projectKnowledge;

const store = new ArtifactStore(dataDir);
const topicQueue = new TopicQueueStore(dataDir);
const pipeline = new ContentPipeline(
  store,
  createAgentPorts({
    neuromediaApiKey: process.env.NEUROMEDIA_API_KEY,
    neuromediaBaseUrl: process.env.NEUROMEDIA_BASE_URL,
    neuromediaModel: process.env.NEUROMEDIA_MODEL,
    neuromediaTimeoutMs: Number(process.env.NEUROMEDIA_TIMEOUT_MS || 120000),
    projectKnowledge: knowledge,
    contentApiUrl: contentApiUrlFromEnv(),
    contentApiToken: process.env.CONTENT_API_TOKEN,
  }),
);

const startedAt = new Date().toISOString();
console.log(`[daily] ${startedAt} model=${process.env.NEUROMEDIA_MODEL || 'gpt-5.6-terra'}`);
if (!process.env.NEUROMEDIA_API_KEY || !process.env.CONTENT_API_TOKEN) throw new Error('Real generation and publication credentials are required.');
await syncTopicQueueWithRequests();
await fillQueueFromContentPlan(limit);

let published = 0;
let attempted = 0;
const results: Array<{ slug: string; requestId: string; status: string; url?: string; note?: string }> = [];

const attemptedIds = new Set<string>();
let providerFailed = false;
while (published < limit && attempted < limit) {
  const item = await nextQueueWorkItem(attemptedIds);
  if (!item) break;

  attempted += 1;
  attemptedIds.add(item.requestId);
  await topicQueue.update(item.requestId, { status: 'running', note: `Started by daily cron runner. Target: ${limit} articles.` });
  console.log(`[daily] start ${item.slug} #${item.requestId}`);

  const request = await store.findRequest(item.requestId);
  if (!request) {
    await topicQueue.update(item.requestId, { status: 'blocked', note: 'Request disappeared from store.' });
    results.push({ slug: item.slug, requestId: item.requestId, status: 'blocked', note: 'Request disappeared from store.' });
    continue;
  }

  let result: PipelineRequest;
  try {
    result = await runUntilIdle(request.id, maxSteps);
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    await topicQueue.update(item.requestId, { status: 'pending', note });
    results.push({ slug: item.slug, requestId: item.requestId, status: 'error', note });
    console.error(`[daily] ${new Date().toISOString()} failed ${item.slug}: ${note}`);
    providerFailed = true;
    break; // Preserve the request; do not burn the rest of the queue on an upstream outage.
  }
  const artifacts = await store.readArtifacts(request.id);
  const publicationUrl = artifacts.publicationReport?.url;

  if (result.status === 'monitoring' && publicationUrl) {
    published += 1;
    await topicQueue.update(item.requestId, { status: 'done', publishedUrl: publicationUrl, note: artifacts.publicationReport?.summary || 'Published.' });
    results.push({ slug: item.slug, requestId: item.requestId, status: 'done', url: publicationUrl });
    console.log(`[daily] done ${item.slug} #${item.requestId} ${publicationUrl}`);
    continue;
  }

  const note = result.notes.at(-1) || `Stopped with status ${result.status}.`;
  await topicQueue.update(item.requestId, { status: result.status === 'blocked' ? 'blocked' : 'pending', note });
  results.push({ slug: item.slug, requestId: item.requestId, status: result.status, note });
  console.log(`[daily] stopped ${item.slug} #${item.requestId}: ${result.status}`);
}

const report = { startedAt, finishedAt: new Date().toISOString(), model: process.env.NEUROMEDIA_MODEL || 'gpt-5.6-terra', limit, attempted, published, ok: !providerFailed && published > 0, results };
await mkdir(dataDir, { recursive: true });
await writeFile(join(dataDir, 'daily-report.json.tmp'), JSON.stringify(report, null, 2) + '\n');
await rename(join(dataDir, 'daily-report.json.tmp'), join(dataDir, 'daily-report.json'));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

async function syncTopicQueueWithRequests(): Promise<void> {
  for (const item of await topicQueue.list()) {
    let request = await store.findRequest(item.requestId);
    if (!request) continue;
    const topic = findTopicBySlug(knowledge, item.slug);
    if (topic && request.brief.inputType === 'planned_topic' && ['brief_draft', 'needs_facts'].includes(request.status) && request.brief.cluster !== topic.cluster) {
      request = await store.updateRequest({ ...request, brief: { ...request.brief, cluster: topic.cluster }, notes: [...request.notes, 'Publication cluster aligned with the specific content-plan question; seed keywords remain in the brief.'] });
    }
    if (request.status === 'monitoring') {
      const publicationReport = (await store.readArtifacts(item.requestId)).publicationReport;
      await topicQueue.update(item.requestId, { status: 'done', publishedUrl: publicationReport?.url || item.publishedUrl, note: publicationReport?.summary || item.note });
    } else if (request.status === 'blocked') {
      await topicQueue.update(item.requestId, { status: 'blocked', note: request.notes.at(-1) || item.note });
    } else if (item.status === 'running') {
      await topicQueue.update(item.requestId, { status: 'pending', note: `Restored from interrupted daily run. Request status: ${request.status}.` });
    }
  }
}

async function fillQueueFromContentPlan(count: number): Promise<void> {
  const pending = (await topicQueue.list()).filter((item) => item.status === 'pending' || item.status === 'running').length;
  const needed = Math.max(0, count - pending);
  if (needed === 0) return;

  const used = await usedTopicKeys();
  const candidates = knowledge.topics
    .filter((topic) => !used.has(topic.slug) && !used.has(topic.url))
    .sort(sortTopicsForQueue)
    .slice(0, needed);

  for (const topic of candidates) {
    const request = await createRequestFromTopic(topic);
    await topicQueue.add({ requestId: request.id, slug: topic.slug, url: topic.url, title: topic.question });
    used.add(topic.slug);
    used.add(topic.url);
    console.log(`[daily] queued ${topic.slug} #${request.id}`);
  }
}

async function nextQueueWorkItem(excluded: Set<string>): Promise<TopicQueueEntry | null> {
  await syncTopicQueueWithRequests();
  const items = (await topicQueue.list()).filter((item) => !excluded.has(item.requestId));
  return items.find((item) => item.status === 'running') || items.find((item) => item.status === 'pending') || null;
}

async function usedTopicKeys(): Promise<Set<string>> {
  const requests = await store.listRequests();
  const queue = await topicQueue.list();
  return new Set([
    ...requests
      .filter((request) => request.status !== 'blocked')
      .flatMap((request) => request.brief.inputType === 'planned_topic' ? [slugFromKnownFacts(request.brief.knownFacts), urlFromKnownFacts(request.brief.knownFacts)] : []),
    ...queue.filter((item) => item.status !== 'blocked').flatMap((item) => [item.slug, item.url]),
  ].filter(isString));
}

async function createRequestFromTopic(topic: TopicQueueItem): Promise<PipelineRequest> {
  const existing = await findExistingTopicRequest(topic);
  if (existing) return existing;

  return pipeline.createRequest({
    brief: {
      inputType: 'planned_topic',
      title: topic.question,
      cluster: topic.cluster,
      materialKind: parseMaterialKind(topic.kind),
      goal: `Ответить на вопрос: ${topic.question}`,
      knownFacts: topicKnownFacts(topic),
      forbiddenMentions: 'Не использовать факты о Lexis Voice из открытого поиска; продукт, кейсы, конкуренты, термины и ссылки брать из handoff/fakty.',
      internalLinks: topicToInternalLinks(knowledge, topic),
    },
    createdBy: { source: 'system' },
    notes: [`Created from daily topic queue: ${topic.slug} (${topic.url}).`],
  });
}

async function findExistingTopicRequest(topic: TopicQueueItem): Promise<PipelineRequest | null> {
  const requests = await store.listRequests();
  return requests.find((request) => {
    if (request.status === 'blocked') return false;
    if (request.brief.inputType !== 'planned_topic') return false;
    return request.brief.knownFacts.includes(`Slug: ${topic.slug}`) || request.brief.knownFacts.includes(`URL: ${topic.url}`);
  }) || null;
}

async function runUntilIdle(requestId: string, steps: number): Promise<PipelineRequest> {
  let current = await mustFindRequest(requestId);
  for (let step = 0; step < steps; step += 1) {
    console.log(`[daily] ${new Date().toISOString()} ${current.id}: ${current.status}`);
    const next = await pipeline.runNext(current.id);
    if (next.status === current.status && next.updatedAt === current.updatedAt) return next;
    current = next;
    if (current.status === 'monitoring' || current.status === 'blocked') return current;
  }
  return current;
}

async function mustFindRequest(requestId: string): Promise<PipelineRequest> {
  const request = await store.findRequest(requestId);
  if (!request) throw new Error(`Request ${requestId} not found.`);
  return request;
}

function parseMaterialKind(value: string): MaterialKind {
  if (value === 'compare' || value === 'guide' || value === 'news' || value === 'programmatic') return value;
  return 'unknown';
}

function slugFromKnownFacts(knownFacts: string): string | undefined {
  return knownFacts.match(/Slug:\s*([^\s]+)/)?.[1];
}

function urlFromKnownFacts(knownFacts: string): string | undefined {
  return knownFacts.match(/URL:\s*(\/[^\s]+)/)?.[1];
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
