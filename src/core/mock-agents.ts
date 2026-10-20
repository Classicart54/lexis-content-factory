import { runDeterministicInfographicsAgent } from './deterministic-infographics-agent.js';
import type { AgentPorts, DraftDoc, FactPackage, MaterialStructure, PipelineRequest, PublicationReport, ReviewReport, ValidationReport } from './types.js';

const LONG_PARAGRAPH =
  'Материал объясняет задачу через проверенные факты, контекст внедрения и практические ограничения. Он показывает, где голосовой ИИ помогает продажам, обучению и клиентскому сервису, а где нужны данные, сценарии, интеграции и контроль качества. Такой подход не обещает универсального решения, зато дает читателю понятную рамку выбора, критерии проверки результата и основания для следующего шага.';

export const mockAgents: AgentPorts = {
  async runSearchAgent(request) {
    const now = new Date().toISOString();
    const baseTitle = request.brief.inputType === 'planned_topic' ? request.brief.title : request.brief.eventSummary;

    return {
      requestId: request.id,
      topicOccupied: true,
      createdAt: now,
      sources: [
        {
          id: 'S1',
          url: request.brief.inputType === 'news' ? request.brief.sourceUrl : 'https://lexisvoice.example/internal-research',
          title: `Source package for ${baseTitle}`,
          publisher: 'Lexis Voice research workspace',
          retrievedAt: now,
          reliability: 'official',
          snapshotText: 'Mock source text with a direct quote for local pipeline development.',
        },
        {
          id: 'S2',
          url: 'https://lexisvoice.example/validation-rules',
          title: 'Mock validation rules',
          publisher: 'Lexis Voice research workspace',
          retrievedAt: now,
          reliability: 'official',
          snapshotText: 'Deterministic validation runs before LLM review in the content pipeline.',
        },
        {
          id: 'S3',
          url: 'https://lexisvoice.example/fact-rules',
          title: 'Mock fact rules',
          publisher: 'Lexis Voice research workspace',
          retrievedAt: now,
          reliability: 'official',
          snapshotText: 'Every final claim must be connected to a source and reviewed before publication.',
        },
      ],
      claims: [
        {
          id: 'F1',
          claim: 'A voice AI material must connect claims to sources before publication.',
          sourceIds: ['S1'],
          allowedInFinal: true,
          kind: 'internal',
          quote: 'Mock source text with a direct quote for local pipeline development.',
          confidence: 'high',
        },
        {
          id: 'F2',
          claim: 'Deterministic validation must run before LLM review.',
          sourceIds: ['S2'],
          allowedInFinal: true,
          kind: 'internal',
          quote: 'Deterministic validation runs before LLM review in the content pipeline.',
          confidence: 'high',
        },
        {
          id: 'F3',
          claim: 'Every final claim must be connected to a source and reviewed before publication.',
          sourceIds: ['S3'],
          allowedInFinal: true,
          kind: 'internal',
          quote: 'Every final claim must be connected to a source and reviewed before publication.',
          confidence: 'high',
        },
      ],
      gaps: [],
      angle: 'The pipeline should treat missing evidence as a routing problem, not as a writing problem.',
    } satisfies FactPackage;
  },

  async runStructureAgent(request, facts) {
    const title = request.brief.inputType === 'planned_topic' ? request.brief.title : request.brief.eventSummary;
    const materialKind = request.brief.inputType === 'planned_topic' ? request.brief.materialKind : 'news';
    const requiredBlocks = materialKind === 'compare' ? ['lead', 'table', 'fork', 'verdict', 'faq', 'cta'] : ['lead', 'prose', 'faq', 'cta'];

    return {
      requestId: request.id,
      materialKind,
      title,
      seoTitle: title.slice(0, 65),
      description: 'Практичный материал Lexis Voice с фактами, выводами и проверяемой структурой.',
      requiredBlocks,
      thesis: 'A material must turn sourced facts into a useful decision frame.',
      audience: 'Sales, training, HR and commercial leaders.',
      plannedCta: {
        purpose: 'Offer the next product conversation that follows from the topic.',
        productContext: 'Lexis Voice',
        desiredAction: 'Discuss implementation fit.',
      },
      createdAt: new Date().toISOString(),
      sections: [
        { id: 'lead', blockType: 'lead', purpose: 'Self-contained lead.', requiredClaimIds: ['F1'], targetWords: 80 },
        { id: 'context', blockType: 'prose', title: 'Почему эта тема важна для продаж?', purpose: 'Explain why the topic matters.', requiredClaimIds: facts.claims.map((claim) => claim.id), targetWords: 450 },
        { id: 'decision', blockType: materialKind === 'compare' ? 'fork' : 'prose', title: 'Как принимать решение?', purpose: 'Give a decision frame.', requiredClaimIds: ['F1', 'F2'], targetWords: 450, constraints: materialKind === 'compare' ? ['Include neither option.'] : [] },
        ...(materialKind === 'compare'
          ? [
              { id: 'table', blockType: 'table', title: 'Что отличается на практике?', purpose: 'Compare options by criteria.', requiredClaimIds: ['F1', 'F2'], targetWords: 180 },
              { id: 'verdict', blockType: 'verdict', title: 'Что выбрать?', purpose: 'Give a non-cloned verdict.', requiredClaimIds: ['F1', 'F2'], targetWords: 220 },
            ]
          : []),
        {
          id: 'faq',
          blockType: 'faq',
          title: 'Что еще спрашивают?',
          purpose: 'Answer long-tail objections.',
          requiredClaimIds: ['F1'],
          targetWords: 350,
          plannedQuestions: Array.from({ length: 8 }, (_, index) => `Вопрос ${index + 1}?`),
        },
        { id: 'cta', blockType: 'cta', purpose: 'Suggest a topic-specific next action.', requiredClaimIds: [], targetWords: 80 },
      ],
    } satisfies MaterialStructure;
  },

  async runWriterAgent(request, facts, structure) {
    const slug = slugify(structure.title);
    const lead =
      'Голосовой ИИ полезен только тогда, когда материал опирается на проверенные факты, понятную структуру и заранее заданные правила качества. Этот черновик показывает, как конвейер Lexis Voice должен доводить тему от брифа до готового JSON без ручного согласования.';

    const blocks: DraftDoc['blocks'] = [
      { id: 'lead', type: 'lead', text: lead, sourceClaimIds: ['F1'] },
      { id: 'context', type: 'section', title: 'Контекст задачи', text: repeatText(12), sourceClaimIds: facts.claims.map((claim) => claim.id) },
      { id: 'decision', type: structure.materialKind === 'compare' ? 'fork' : 'section', title: 'Как принимать решение', text: repeatText(10), sourceClaimIds: ['F1', 'F2'] },
    ];

    if (structure.materialKind === 'compare') {
      blocks.push({ id: 'table', type: 'table', title: 'Сравнение подходов', text: repeatText(4), sourceClaimIds: ['F1'] });
    }

    blocks.push({
      id: 'faq',
      type: 'faq',
      title: 'FAQ',
      text: repeatText(4),
      items: Array.from({ length: 8 }, (_, index) => ({
        question: `Вопрос ${index + 1}`,
        answer: 'Ответ связывает решение с фактами, ограничениями и практическим следующим шагом, чтобы читатель не получал пустую рекомендацию.',
      })),
      sourceClaimIds: ['F1'],
    });

    return {
      meta: {
        title: structure.title,
        seoTitle: structure.seoTitle,
        description: structure.description,
        slug,
        author: 'Lexis Voice',
      },
      blocks,
    } satisfies DraftDoc;
  },

  async runInfographicsAgent(request, facts, draft) {
    return runDeterministicInfographicsAgent(request, facts, draft);
  },

  async runReviewAgent(request, _facts, _draft, validationReport) {
    return {
      requestId: request.id,
      approved: validationReport.ok,
      issues: validationReport.ok ? [] : validationReport.issues,
      summary: validationReport.ok ? 'Mock reviewer approved the material after deterministic checks.' : 'Mock reviewer returned validation issues.',
      checkedAt: new Date().toISOString(),
    } satisfies ReviewReport;
  },

  async publishMaterial(request, draft) {
    return {
      requestId: request.id,
      ok: true,
      statusCode: 200,
      url: `mock://guides/${draft.meta.slug}`,
      updated: false,
      issues: [],
      summary: 'Mock publisher accepted the material.',
      publishedAt: new Date().toISOString(),
    } satisfies PublicationReport;
  },
};

function repeatText(times: number): string {
  return Array.from({ length: times }, () => LONG_PARAGRAPH).join('\n\n');
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'material';
}
