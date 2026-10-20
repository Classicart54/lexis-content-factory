import type { FactPackage, MaterialKind, MaterialStructure, PipelineRequest, StructureSection } from './types.js';
import { NeuromediaClient } from './neuromedia-client.js';
import { buildKnowledgeContext, type ProjectKnowledge } from './project-knowledge.js';

interface StructureAgentJson {
  materialKind?: MaterialKind;
  title?: string;
  seoTitle?: string;
  description?: string;
  thesis?: string;
  audience?: string;
  requiredBlocks?: string[];
  sections?: Array<Partial<StructureSection>>;
  plannedCta?: MaterialStructure['plannedCta'];
  missingFacts?: string[];
  risks?: string[];
}

export class NeuromediaStructureAgent {
  constructor(
    private readonly client: NeuromediaClient,
    private readonly projectKnowledge: ProjectKnowledge | null,
  ) {}

  async run(request: PipelineRequest, facts: FactPackage, _context?: unknown): Promise<MaterialStructure> {
    const result = await this.client.createJsonCompletion<StructureAgentJson>({
      messages: [
        {
          role: 'system',
          content: [
            'You are the structure agent for Lexis Voice content pipeline.',
            'Role: выпускающий редактор. You design article structure, not prose.',
            'Return only valid JSON. Do not write final article text.',
            'Use only block types from: lead, tldr, prose, points, steps, table, stats, matrix, cards, fork, verdict, quote, callout, image, promo, related, faq, sources, cta.',
            'Lexis Voice product facts, metrics and cases must come only from project knowledge and FactPackage. Do not invent product capabilities.',
            'Every meaningful section must reference existing fact ids from FactPackage.',
            'If a necessary section has no fact support, put it into missingFacts instead of planning an empty generic section.',
            'Use missingFacts only for facts required to write a planned section or CTA. If missing evidence can be honestly stated as a limitation or boundary, put it into risks or section constraints, not missingFacts.',
            'Do not require universal market proof when the article can honestly say that no universal proof exists and explain what to do instead.',
            'Lead must be first and exactly one. FAQ is mandatory and must plan at least 8 questions. CTA must be topic-specific, not default.',
            'For compare: table, fork, verdict, faq and cta are mandatory. Fork must explicitly include neither constraint.',
            'Headings must carry the subject; never use bare rubric headings like Introduction, Benefits, Features or Conclusions.',
            'Question headings are optional: use them only when the heading naturally sounds like a reader question. Overview sections may use named headings like SPIN: выявление потребности.',
            'For overview guides, use predictable structure: list what exists, then short named sections for each item in the same order, then what to choose for the task.',
            'Plan 1200-2000 target words total. If the plan needs more than 2000 words, split the topic instead of expanding this material.',
            'Plan 6-8 content sections, not ten or more. FAQ, related, sources and CTA do not count as content sections.',
            'For guides, do not use matrix. Matrix is only for market/compare layouts; use table or cards/prose in guides.',
            'Alternate block forms. Never plan three cards blocks in a row, and do not make a visual slot the last meaningful block.',
            'Use fork only when there is a real either/or decision. Do not use fork for complementary techniques in an overview.',
            'Do not plan sections about search results, SEO, keyword clusters or topic occupancy. Those are internal signals, not reader content.',
            'Do not expand beyond the exact brief question; adjacent topics need separate pages.',
            'Final JSON shape: {"materialKind":"guide|compare|news","title":"...","seoTitle":"<=65 chars","description":"<=160 chars","thesis":"...","audience":"...","requiredBlocks":["lead","prose","faq","cta"],"sections":[{"id":"lead","blockType":"lead","title":"optional","purpose":"...","requiredClaimIds":["F1"],"targetWords":80,"constraints":["..."],"plannedQuestions":["...?"],"internalLinks":["/..."]}],"plannedCta":{"purpose":"...","productContext":"...","desiredAction":"..."},"missingFacts":[],"risks":[]}.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: buildStructurePrompt(request, facts, this.projectKnowledge),
        },
      ],
    });

    return normalizeStructure(request, result);
  }
}

function buildStructurePrompt(request: PipelineRequest, facts: FactPackage, knowledge: ProjectKnowledge | null): string {
  return [
    'Brief:',
    JSON.stringify(request.brief, null, 2),
    'Revision notes from orchestrator. If present, fix these issues directly and do not restart from scratch:',
    summarizeRevisionNotes(request.notes),
    'FactPackage:',
    JSON.stringify(
      {
        topicOccupied: facts.topicOccupied,
        angle: facts.angle,
        claims: facts.claims,
        gaps: facts.gaps,
        sources: facts.sources.map((source) => ({ id: source.id, title: source.title, publisher: source.publisher, url: source.url, retrievedAt: source.retrievedAt })),
      },
      null,
      2,
    ),
    'Project knowledge:',
    buildKnowledgeContext(knowledge, request),
  ].join('\n\n');
}

function summarizeRevisionNotes(notes: string[]): string {
  const revisionNotes = notes.filter((note) => note.includes('Revision packet'));
  return (revisionNotes.at(-1) || notes.slice(-3).join('\n')).slice(0, 4000);
}

function normalizeStructure(request: PipelineRequest, result: StructureAgentJson): MaterialStructure {
  const title = result.title || (request.brief.inputType === 'planned_topic' ? request.brief.title : request.brief.eventSummary);
  const materialKind = normalizeKind(result.materialKind || (request.brief.inputType === 'planned_topic' ? request.brief.materialKind : 'news'));
  const sections = normalizeTargetWords(ensureMinimumContentSections(normalizeSections(result.sections || []), request, materialKind));

  return {
    requestId: request.id,
    materialKind,
    title,
    seoTitle: (result.seoTitle || title).slice(0, 65),
    description: (result.description || 'Материал Lexis Voice с проверяемой фактурой и практическим выводом.').slice(0, 160),
    sections,
    requiredBlocks: result.requiredBlocks || inferRequiredBlocks(materialKind),
    thesis: result.thesis,
    audience: result.audience,
    plannedCta: result.plannedCta,
    missingFacts: normalizeStringList(result.missingFacts || []),
    risks: result.risks || [],
    createdAt: new Date().toISOString(),
  };
}

function ensureMinimumContentSections(sections: StructureSection[], request: PipelineRequest, materialKind: MaterialKind): StructureSection[] {
  if (materialKind !== 'guide') return sections;

  const contentSections = sections.filter((section) => isContentSection(section.blockType));
  if (contentSections.length >= 6) return sections;

  const templates = buildGuideSectionTemplates(request);
  const existingIds = new Set(sections.map((section) => section.id));
  const existingTypes = new Set(sections.map((section) => section.blockType));
  const additions: StructureSection[] = [];

  for (const template of templates) {
    if (contentSections.length + additions.length >= 6) break;
    if (existingTypes.has(template.blockType)) continue;
    const id = uniqueSectionId(template.id, existingIds);
    existingIds.add(id);
    existingTypes.add(template.blockType);
    additions.push({
      ...template,
      id,
    });
  }

  return [...sections, ...additions];
}

function buildGuideSectionTemplates(request: PipelineRequest): StructureSection[] {
  if (request.brief.inputType !== 'planned_topic') return [];
  const topic = request.brief.title || request.brief.goal;
  const productLink = request.brief.internalLinks.split(/\s+/).find((link: string) => /^\//.test(link)) || '/product/call-scoring';

  return [
    {
      id: 'context',
      blockType: 'prose',
      title: `${topic} в разговоре с клиентом`,
      purpose: 'Объяснить, где этот этап находится и зачем он нужен.',
      requiredClaimIds: [],
      targetWords: 180,
      constraints: ['Кратко связать с предыдущим и следующим шагом разговора.'],
      plannedQuestions: [],
      internalLinks: [productLink],
    },
    {
      id: 'sequence',
      blockType: 'steps',
      title: `Порядок вопросов по теме: ${topic}`,
      purpose: 'Показать рабочую последовательность вопросов от общего к конкретному.',
      requiredClaimIds: [],
      targetWords: 180,
      constraints: ['Не превращать в анкету.'],
      plannedQuestions: [],
      internalLinks: [productLink],
    },
    {
      id: 'criteria',
      blockType: 'table',
      title: `Какие вопросы помогают, а какие портят ${topic}`,
      purpose: 'Дать сравнимые примеры хороших и плохих формулировок.',
      requiredClaimIds: [],
      targetWords: 220,
      constraints: ['Должны быть конкретные примеры формулировок.'],
      plannedQuestions: [],
      internalLinks: [productLink],
    },
    {
      id: 'example',
      blockType: 'example',
      title: `Пример: как менеджер ведёт клиента через ${topic}`,
      purpose: 'Показать бытовой сценарий на выдуманной истории.',
      requiredClaimIds: [],
      targetWords: 200,
      constraints: ['Сторителлинг, без абстрактных рассуждений.'],
      plannedQuestions: [],
      internalLinks: [productLink],
    },
    {
      id: 'evaluation',
      blockType: 'prose',
      title: `Как проверять качество вопросов по теме ${topic}`,
      purpose: 'Показать, как руководителю смотреть на реальные звонки.',
      requiredClaimIds: [],
      targetWords: 180,
      constraints: ['Привязать к разбору звонков и чек-листу.'],
      plannedQuestions: [],
      internalLinks: [productLink],
    },
    {
      id: 'practice',
      blockType: 'prose',
      title: `Что делать после прочтения статьи про ${topic}`,
      purpose: 'Дать короткое практическое действие для команды.',
      requiredClaimIds: [],
      targetWords: 160,
      constraints: ['Без маркетинговой воды и общих лозунгов.'],
      plannedQuestions: [],
      internalLinks: [productLink],
    },
  ];
}

function isContentSection(blockType: string): boolean {
  return ['tldr', 'prose', 'points', 'steps', 'table', 'stats', 'matrix', 'cards', 'fork', 'verdict', 'quote', 'callout'].includes(blockType);
}

function uniqueSectionId(baseId: string, existingIds: Set<string>): string {
  if (!existingIds.has(baseId)) return baseId;
  let index = 2;
  while (existingIds.has(`${baseId}-${index}`)) index += 1;
  return `${baseId}-${index}`;
}

function normalizeTargetWords(sections: StructureSection[]): StructureSection[] {
  const total = sections.reduce((sum, section) => sum + (section.targetWords || 0), 0);
  if (total <= 1950 || total === 0) return sections;
  const ratio = 1950 / total;
  return sections.map((section) => ({
    ...section,
    targetWords: section.targetWords ? Math.max(40, Math.round(section.targetWords * ratio)) : section.targetWords,
  }));
}

function normalizeSections(sections: Array<Partial<StructureSection>>): StructureSection[] {
  return sections.map((section, index) => ({
    id: section.id || `section-${index + 1}`,
    blockType: section.blockType || 'prose',
    title: section.title,
    purpose: section.purpose || 'No purpose returned by structure agent.',
    requiredClaimIds: section.requiredClaimIds || [],
    targetWords: section.targetWords,
    constraints: section.constraints || [],
    plannedQuestions: section.plannedQuestions || [],
    internalLinks: section.internalLinks || [],
  }));
}

function normalizeKind(kind: MaterialKind): MaterialKind {
  if (kind === 'compare' || kind === 'guide' || kind === 'news') return kind;
  return 'guide';
}

function inferRequiredBlocks(kind: MaterialKind): string[] {
  if (kind === 'compare') return ['lead', 'table', 'fork', 'verdict', 'faq', 'cta'];
  if (kind === 'news') return ['lead', 'prose', 'callout', 'cta'];
  return ['lead', 'prose', 'faq', 'cta'];
}

function normalizeStringList(values: unknown[]): string[] {
  return values
    .map((value) => {
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object') return JSON.stringify(value);
      return String(value);
    })
    .filter((value) => value.trim().length > 0);
}
