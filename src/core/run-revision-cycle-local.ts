import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactStore } from './artifact-store.js';
import { createAgentPorts } from './agent-factory.js';
import { contentApiUrlFromEnv } from '../config.js';
import { ContentPipeline } from './pipeline.js';
import { loadProjectKnowledge } from './project-knowledge.js';
import type { DraftDoc, FactPackage, MaterialStructure, PipelineRequest } from './types.js';
import { validateMaterial } from './validation.js';

const requestId = process.argv[2] || 'A-0001';
const maxSteps = Number(process.argv[3] || 14);
const dataDir = process.env.DATA_DIR || './data-topic-tehniki-prodazh';
const requestDir = join(dataDir, 'requests', requestId);

const projectKnowledge = await loadProjectKnowledge(process.env.HANDOFF_KONVEYER_DIR);
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

const request = await mustFindRequest(store, requestId);
const facts = await readJson<FactPackage>(join(requestDir, 'facts.v1.json'));
const structure = await readFirstJson<MaterialStructure>([join(requestDir, 'structure.retry.json'), join(requestDir, 'structure.v1.json')]);
const draft = await readFirstJson<DraftDoc>([join(requestDir, 'draft.retry.json'), join(requestDir, 'draft.v1.json')]);
const assembled = await readFirstJson<DraftDoc>([join(requestDir, 'assembled.v1.json'), join(requestDir, 'draft.retry.json'), join(requestDir, 'draft.v1.json')]);
const validationReport = validateMaterial(request, facts, structure, assembled);

await store.writeArtifact(requestId, 'facts', facts);
await store.writeArtifact(requestId, 'structure', structure);
await store.writeArtifact(requestId, 'draft', draft);
await store.writeArtifact(requestId, 'assembled', assembled);
await store.writeArtifact(requestId, 'validationReport', validationReport);
await store.updateRequest({ ...request, status: 'llm_review', notes: [...request.notes, 'Revision cycle local runner restored state at llm_review from current artifacts.'] });

const result = await pipeline.runUntilIdle(requestId, maxSteps);
const artifacts = await store.readArtifacts(requestId);

console.log(
  JSON.stringify(
    {
      id: result.id,
      status: result.status,
      maxSteps,
      notesTail: result.notes.slice(-8),
      revision: artifacts.revision
        ? {
            source: artifacts.revision.source,
            targetStatus: artifacts.revision.targetStatus,
            targetOwner: artifacts.revision.targetOwner,
            attempt: artifacts.revision.attempt,
            issues: artifacts.revision.issues,
          }
        : null,
      review: artifacts.reviewReport
        ? {
            approved: artifacts.reviewReport.approved,
            issueCount: artifacts.reviewReport.issues.length,
            summary: artifacts.reviewReport.summary,
          }
        : null,
    },
    null,
    2,
  ),
);

async function mustFindRequest(storeInstance: ArtifactStore, id: string): Promise<PipelineRequest> {
  const request = await storeInstance.findRequest(id);
  if (!request) throw new Error(`Request ${id} not found in ${dataDir}.`);
  return request;
}

async function readFirstJson<T>(filePaths: string[]): Promise<T> {
  const errors: string[] = [];
  for (const filePath of filePaths) {
    try {
      return await readJson<T>(filePath);
    } catch (error) {
      errors.push(`${filePath}: ${(error as Error).message}`);
    }
  }
  throw new Error(`Cannot read any JSON file:\n${errors.join('\n')}`);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}
