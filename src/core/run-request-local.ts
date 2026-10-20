import { ArtifactStore } from './artifact-store.js';
import { createAgentPorts } from './agent-factory.js';
import { contentApiUrlFromEnv } from '../config.js';
import { ContentPipeline } from './pipeline.js';
import { loadProjectKnowledge } from './project-knowledge.js';

const requestId = process.argv[2];
if (!requestId) throw new Error('Usage: npm run request:local -- <request-id> [max-steps]');

const maxSteps = Number(process.argv[3] || 12);
const dataDir = process.env.DATA_DIR || './data';
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
            issueCount: artifacts.revision.issues.length,
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
