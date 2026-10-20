import { ArtifactStore } from './artifact-store.js';
import { createAgentPorts } from './agent-factory.js';
import { contentApiUrlFromEnv } from '../config.js';
import { ContentPipeline } from './pipeline.js';
import { loadProjectKnowledge } from './project-knowledge.js';

const dataDir = process.env.DATA_DIR || './data';
const projectKnowledge = await loadProjectKnowledge(process.env.HANDOFF_KONVEYER_DIR);
const pipeline = new ContentPipeline(
  new ArtifactStore(dataDir),
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
    title: 'Как голосовой ИИ помогает контролировать качество продаж',
    cluster: 'голосовой ИИ для продаж',
    materialKind: 'guide',
    goal: 'Показать, как строить материал с фактами, структурой и проверками.',
    knownFacts: 'Нужно проверять источники, объем и финальный JSON.',
    forbiddenMentions: 'Нет',
    internalLinks: '/blog /cases',
  },
  createdBy: { source: 'cli' },
});

const result = await pipeline.runUntilIdle(request.id);

console.log(JSON.stringify({ id: result.id, status: result.status, notes: result.notes }, null, 2));
