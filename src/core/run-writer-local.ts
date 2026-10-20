import { createAgentPorts } from './agent-factory.js';
import { contentApiUrlFromEnv } from '../config.js';
import { loadProjectKnowledge } from './project-knowledge.js';
import type { FactPackage, MaterialStructure, PipelineRequest } from './types.js';
import { validateMaterial } from './validation.js';

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
  id: 'A-WRITER-SMOKE',
  status: 'writing',
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
  sources: [{ id: 'S1', url: 'https://example.com/sales-method', title: 'Sales method source', publisher: 'Example', retrievedAt: now, snapshotText: 'A direct quote about sales call structure and objection handling.', reliability: 'expert' }],
  claims: [
    { id: 'F1', claim: 'Sales techniques are useful only when translated into observable call behavior.', sourceIds: ['S1'], allowedInFinal: true, kind: 'method', quote: 'A direct quote about sales call structure and objection handling.', confidence: 'high' },
    { id: 'F2', claim: 'Cold calls require early context, qualification and objection handling.', sourceIds: ['S1'], allowedInFinal: true, kind: 'method', quote: 'A direct quote about sales call structure and objection handling.', confidence: 'high' },
    { id: 'F3', claim: 'Training should check specific phrases and decisions, not just knowledge of technique names.', sourceIds: ['S1'], allowedInFinal: true, kind: 'method', quote: 'A direct quote about sales call structure and objection handling.', confidence: 'high' },
    { id: 'F4', claim: 'SPIN selling, AIDA and consultative selling are commonly described sales frameworks, but each must be adapted to the channel and task.', sourceIds: ['S1'], allowedInFinal: true, kind: 'method', quote: 'A direct quote about sales call structure and objection handling.', confidence: 'high' },
    { id: 'F5', claim: 'In a cold call, the practical unit of training is a call stage, phrase, question or decision, not the framework name itself.', sourceIds: ['S1'], allowedInFinal: true, kind: 'method', quote: 'A direct quote about sales call structure and objection handling.', confidence: 'high' },
    { id: 'F6', claim: 'A safe guide should avoid claiming that one sales technique guarantees conversion in every market.', sourceIds: ['S1'], allowedInFinal: true, kind: 'method', quote: 'A direct quote about sales call structure and objection handling.', confidence: 'high' },
  ],
};

const structure: MaterialStructure = {
  requestId: request.id,
  materialKind: 'guide',
  title: 'Какие бывают техники продаж и какая работает в холодном звонке?',
  seoTitle: 'Техники продаж для холодного звонка: что работает',
  description: 'Разбираем техники продаж, которые полезны в холодном звонке, и показываем, как переводить их в фразы, этапы и тренировки.',
  thesis: 'В холодном звонке работает не название техники, а наблюдаемое поведение менеджера.',
  requiredBlocks: ['lead', 'prose', 'faq', 'cta'],
  plannedCta: { purpose: 'Перевести читателя от выбора техники к практике холодного звонка.', productContext: 'Голосовой тренажер продаж Lexis Voice.', desiredAction: 'Потренировать холодный звонок.' },
  sections: [
    { id: 'lead', blockType: 'lead', purpose: 'Answer the main question.', requiredClaimIds: ['F1', 'F2', 'F6'], targetWords: 80 },
    { id: 'what-are-sales-techniques', blockType: 'prose', title: 'Что вообще называют техникой продаж?', purpose: 'Explain frameworks vs behavior.', requiredClaimIds: ['F1', 'F4'], targetWords: 220 },
    { id: 'cold-call-specifics', blockType: 'prose', title: 'Почему холодный звонок отличается от обычной продажи?', purpose: 'Explain cold call mechanics.', requiredClaimIds: ['F2', 'F5'], targetWords: 260 },
    { id: 'training-steps', blockType: 'steps', title: 'Как тренировать техники продаж для холодного звонка?', purpose: 'Give a training process.', requiredClaimIds: ['F2', 'F3', 'F5'], targetWords: 260 },
    { id: 'limits', blockType: 'prose', title: 'Когда техника продаж не спасает звонок?', purpose: 'Explain boundaries.', requiredClaimIds: ['F6'], targetWords: 220 },
    { id: 'faq', blockType: 'faq', purpose: 'Plan FAQ.', requiredClaimIds: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'], targetWords: 360, plannedQuestions: ['Какая техника продаж лучше всего подходит для холодного звонка?', 'SPIN работает в холодных звонках?', 'AIDA подходит для телефонных продаж?', 'Что важнее: скрипт или техника?', 'Как тренировать отработку возражений?', 'Можно ли тренироваться без реальных клиентов?', 'Когда техника продаж не поможет?', 'Как понять, что менеджер применяет технику правильно?'] },
    { id: 'cta', blockType: 'cta', purpose: 'Topic-specific CTA.', requiredClaimIds: ['F3', 'F5'], targetWords: 100 },
  ],
  createdAt: now,
};

const draft = await agents.runWriterAgent(request, facts, structure);
const report = validateMaterial(request, facts, structure, draft);

console.log(JSON.stringify({ ok: report.ok, issues: report.issues, meta: draft.meta, blockCount: draft.blocks.length }, null, 2));
