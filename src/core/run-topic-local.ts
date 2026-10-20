import { ArtifactStore } from './artifact-store.js';
import { createAgentPorts } from './agent-factory.js';
import { contentApiUrlFromEnv } from '../config.js';
import { ContentPipeline } from './pipeline.js';
import { findTopicBySlug, loadProjectKnowledge, topicToInternalLinks } from './project-knowledge.js';
import type { MaterialKind } from './types.js';

const slug = process.argv[2];
if (!slug) {
  throw new Error('Usage: npm run topic:local -- <slug-or-url>');
}

const dataDir = process.env.DATA_DIR || './data-topic-run';
const projectKnowledge = await loadProjectKnowledge(process.env.HANDOFF_KONVEYER_DIR);
if (!projectKnowledge) throw new Error('HANDOFF_KONVEYER_DIR is required for topic runs.');

const topic = findTopicBySlug(projectKnowledge, slug);
if (!topic) throw new Error(`Topic ${slug} not found in project knowledge.`);

const store = new ArtifactStore(dataDir);
const pipeline = new ContentPipeline(
  store,
  createAgentPorts({
    neuromediaApiKey: process.env.NEUROMEDIA_API_KEY,
    neuromediaBaseUrl: process.env.NEUROMEDIA_BASE_URL,
    neuromediaModel: process.env.NEUROMEDIA_MODEL,
    neuromediaTimeoutMs: Number(process.env.NEUROMEDIA_TIMEOUT_MS || 120000),
    projectKnowledge,
    contentApiUrl: contentApiUrlFromEnv(),
    contentApiToken: process.env.CONTENT_API_TOKEN,
  }),
);

const request = await pipeline.createRequest({
  brief: {
    inputType: 'planned_topic',
    title: topic.question,
    cluster: topic.cluster,
    materialKind: parseMaterialKind(topic.kind),
    goal: `Ответить на вопрос: ${topic.question}`,
    knownFacts: [
      'Источник темы: fakty/temy.json',
      `Slug: ${topic.slug}`,
      `URL: ${topic.url}`,
      `Role: ${topic.role || 'не указано'}`,
      `Parent: ${topic.parent || 'не указано'}`,
      `Section: ${topic.section || 'не указано'}`,
      `Demand: ${topic.demand?.shows ?? 'не измерялся'} shows, ${topic.demand?.clusters ?? 'не измерялось'} clusters`,
      `Wave: ${topic.wave ?? 'не указана'}`,
      topic.slug === 'tehniki-prodazh' ? 'Boundary: не раскрывать холодные звонки как половину материала; для этого есть отдельные темы /guides/holodnye-zvonki и /guides/tehniki-holodnyh-zvonkov.' : '',
    ].join('\n'),
    forbiddenMentions: 'Не использовать факты о Lexis Voice из открытого поиска; продукт, кейсы, конкуренты, термины и ссылки брать из handoff/fakty.',
    internalLinks: topicToInternalLinks(projectKnowledge, topic),
  },
  createdBy: { source: 'cli' },
  notes: [`Created from topic queue: ${topic.slug} (${topic.url}).`],
});

const result = await pipeline.runUntilIdle(request.id, 24);

console.log(
  JSON.stringify(
    {
      id: result.id,
      status: result.status,
      dataDir,
      requestDir: `${dataDir}/requests/${result.id}`,
      notes: result.notes,
    },
    null,
    2,
  ),
);

function parseMaterialKind(value: string): MaterialKind {
  if (value === 'compare' || value === 'guide' || value === 'news' || value === 'programmatic') return value;
  return 'unknown';
}
