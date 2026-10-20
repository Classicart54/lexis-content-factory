import { createAgentPorts } from './agent-factory.js';
import { contentApiUrlFromEnv } from '../config.js';
import { loadProjectKnowledge } from './project-knowledge.js';
import { validateStructure } from './structure-validation.js';
import type { FactPackage, PipelineRequest } from './types.js';

const now = new Date().toISOString();
const projectKnowledge = await loadProjectKnowledge(process.env.HANDOFF_KONVEYER_DIR);
const agents = createAgentPorts({
  neuromediaApiKey: process.env.NEUROMEDIA_API_KEY,
  neuromediaBaseUrl: process.env.NEUROMEDIA_BASE_URL,
  neuromediaModel: process.env.NEUROMEDIA_MODEL,
  neuromediaTimeoutMs: Number(process.env.NEUROMEDIA_TIMEOUT_MS || 120000),
  projectKnowledge,
    contentApiUrl: contentApiUrlFromEnv(),
    contentApiToken: process.env.CONTENT_API_TOKEN,
});

const request: PipelineRequest = {
  id: 'A-STRUCTURE-SMOKE',
  status: 'structuring',
  brief: {
    inputType: 'planned_topic',
    title: 'Какие бывают техники продаж и какая работает в холодном звонке?',
    cluster: 'техники продаж',
    materialKind: 'guide',
    goal: 'Ответить на вопрос: какие техники продаж полезны в холодном звонке и как их тренировать.',
    knownFacts: 'Slug: tehniki-prodazh\nURL: /guides/tehniki-prodazh\nWave: 1',
    forbiddenMentions: 'Не использовать факты о Lexis Voice из открытого поиска.',
    internalLinks: '/ /chat-training /cases /glossary',
  },
  createdAt: now,
  updatedAt: now,
  createdBy: { source: 'cli' },
  notes: [],
};

const facts: FactPackage = {
  requestId: request.id,
  topicOccupied: true,
  angle: 'Useful angle: separate sales technique names from observable call mechanics and training checks.',
  createdAt: now,
  gaps: [],
  sources: [
    { id: 'S1', url: 'https://example.com/sales-method', title: 'Sales method source', publisher: 'Example', retrievedAt: now, snapshotText: 'A direct quote about sales call structure and objection handling.', reliability: 'expert' },
  ],
  claims: [
    { id: 'F1', claim: 'Sales techniques are useful only when translated into observable call behavior.', sourceIds: ['S1'], allowedInFinal: true, kind: 'method', quote: 'A direct quote about sales call structure and objection handling.', confidence: 'high' },
    { id: 'F2', claim: 'Cold calls require early context, qualification and objection handling.', sourceIds: ['S1'], allowedInFinal: true, kind: 'method', quote: 'A direct quote about sales call structure and objection handling.', confidence: 'high' },
    { id: 'F3', claim: 'Training should check specific phrases and decisions, not just knowledge of technique names.', sourceIds: ['S1'], allowedInFinal: true, kind: 'method', quote: 'A direct quote about sales call structure and objection handling.', confidence: 'high' },
    { id: 'F4', claim: 'SPIN selling, AIDA and consultative selling are commonly described sales frameworks, but each must be adapted to the channel and task.', sourceIds: ['S1'], allowedInFinal: true, kind: 'method', quote: 'A direct quote about sales call structure and objection handling.', confidence: 'high' },
    { id: 'F5', claim: 'In a cold call, the practical unit of training is a call stage, phrase, question or decision, not the framework name itself.', sourceIds: ['S1'], allowedInFinal: true, kind: 'method', quote: 'A direct quote about sales call structure and objection handling.', confidence: 'high' },
    { id: 'F6', claim: 'A safe guide should avoid claiming that one sales technique guarantees conversion in every market.', sourceIds: ['S1'], allowedInFinal: true, kind: 'method', quote: 'A direct quote about sales call structure and objection handling.', confidence: 'high' },
  ],
};

const structure = await agents.runStructureAgent(request, facts);
const issues = validateStructure(request, facts, structure);

console.log(JSON.stringify({ ok: issues.every((issue) => issue.severity !== 'error'), issues, structure }, null, 2));
