import type { DraftBlock, DraftDoc, FactPackage, MaterialStructure, PipelineRequest } from './types.js';
import { NeuromediaClient } from './neuromedia-client.js';
import { buildKnowledgeContext, type ProjectKnowledge } from './project-knowledge.js';

interface WriterAgentJson {
  meta?: Partial<DraftDoc['meta']>;
  blocks?: DraftBlock[];
  openQuestions?: string[];
  writerNotes?: string[];
}

export class NeuromediaWriterAgent {
  constructor(
    private readonly client: NeuromediaClient,
    private readonly projectKnowledge: ProjectKnowledge | null,
  ) {}

  async run(request: PipelineRequest, facts: FactPackage, structure: MaterialStructure): Promise<DraftDoc> {
    const result = await this.client.createJsonCompletion<WriterAgentJson>({
      messages: [
        {
          role: 'system',
          content: [
            'You are the writer agent for Lexis Voice content pipeline.',
            'Role: автор отраслевого материала. You write final block content as JSON, not Markdown and not HTML.',
            'Return only valid JSON.',
            'Use only facts from FactPackage and project knowledge. Do not invent metrics, product capabilities, legal conclusions, competitor facts, prices or dates.',
            'Lexis Voice product facts, cases, integrations and metrics must come only from project knowledge. Never use web memory for Lexis Voice.',
            'Definitions from terminy.json must be repeated word for word; if a term is in glossary, link internally instead of redefining it.',
            'Use internal links only, from the provided project knowledge or structure. No external links in body text.',
            'Internal links inside prose must use exact syntax [text](/path). Never write a bare path like /cases or /chat-training as visible text.',
            'Add 2-4 product links per material using projectKnowledge.productLinks. Link only where the product solves the paragraph task, on a meaningful phrase like проговорить сложный разговор с ИИ-клиентом, never on подробнее or the product name.',
            'Write Lexis Voice, not we/our service. Do not use the word competitor in final text.',
            'No superlatives about product or market: best, only, number one, cheapest, innovative.',
            'Lead must be 200-450 characters, self-contained, no links, no emphasis, and answer the main question fully.',
            'Lead must say what the subject is directly. Never use a не X, а Y contrast in the lead, including не просто..., а... and не только..., но и....',
            'Total body text must be 1200-2000 words. If structure is too broad, write compactly and do not expand beyond the brief question.',
            'FAQ must contain at least 8 questions and each answer must be longer than 80 characters, but answers should be compact.',
            'Use inline accents for scanability: **bold** for paragraph conclusions or checkable facts, ==marker== for the main takeaway. Hard rule: at least one accent per 250 words, minimum 4 total. Target 1-2 accents per section, never more than 3 per paragraph. Do not mark headings, lead or table cells.',
            'Return all requiredBlocks from the accepted MaterialStructure. If requiredBlocks contains tldr, include one tldr block near the top with concrete bullets/items, not generic prose.',
            'Every block must include sourceClaimIds referencing existing FactPackage claims. CTA can use sourceClaimIds from product/method facts when relevant.',
            'For table or matrix blocks, return structured columns/head and rows/items. Never return a table as prose-only text.',
            'For cards blocks, use cards:[{title,text}], not items. A cards block without cards will render as an empty heading.',
            'For guides, avoid matrix blocks entirely. Use table with head/rows or cards with cards[{title,text}].',
            'FAQ block must have a visible heading/title and at least 8 items.',
            'If revision notes are present, fix only the addressed issues and preserve approved facts, structure, slug and useful blocks. Do not introduce new unsupported numbers or product claims while revising.',
            'Never write about search results, SEO, keyword clusters, topic occupancy or why the page is needed. Those are internal signals, not reader content.',
            'Do not expand the topic beyond the brief question. If the brief is about sales techniques, cold calling can be an example, not half of the article unless the question says so.',
            'If the brief knownFacts contains Boundary, treat it as a hard content ban. Do not mention the adjacent topic except where the brief explicitly asks for it.',
            'Use не X, а Y contrast no more than two times outside the lead. Avoid generated-text cliches: важно отметить, стоит подчеркнуть, в современном мире, по словам экспертов, в заключение, подводя итог, не только... но и, не просто... а.',
            'Final JSON shape: {"meta":{"title":"...","seoTitle":"<=65","description":"<=160","slug":"...","author":{"name":"Команда Lexis Voice","kind":"organization"}},"blocks":[{"id":"lead","type":"lead","text":"...","sourceClaimIds":["F1"]},{"id":"...","type":"prose","heading":"...?","paragraphs":["..."],"sourceClaimIds":["F1"]},{"id":"faq","type":"faq","heading":"Частые вопросы","items":[{"q":"...?","a":"..."}],"sourceClaimIds":["F1"]}]}.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: buildWriterPrompt(request, facts, structure, this.projectKnowledge),
        },
      ],
    });

    return normalizeDraft(request, structure, result);
  }
}

function buildWriterPrompt(request: PipelineRequest, facts: FactPackage, structure: MaterialStructure, knowledge: ProjectKnowledge | null): string {
  return [
    'Brief:',
    JSON.stringify(request.brief, null, 2),
    'Revision notes from orchestrator. If present, address these issues directly:',
    summarizeRevisionNotes(request.notes),
    'Accepted FactPackage:',
    JSON.stringify({ claims: facts.claims, sources: facts.sources, gaps: facts.gaps, angle: facts.angle }, null, 2),
    'Accepted MaterialStructure:',
    JSON.stringify(structure, null, 2),
    'Project knowledge:',
    buildKnowledgeContext(knowledge, request),
  ].join('\n\n');
}

function summarizeRevisionNotes(notes: string[]): string {
  const revisionNotes = notes.filter((note) => note.includes('Revision packet'));
  return (revisionNotes.at(-1) || notes.slice(-3).join('\n')).slice(0, 4000);
}

function normalizeDraft(request: PipelineRequest, structure: MaterialStructure, result: WriterAgentJson): DraftDoc {
  const title = result.meta?.title || structure.title;
  const slug = result.meta?.slug || slugFromRequest(request, structure);

  return {
    meta: {
      title,
      seoTitle: String(result.meta?.seoTitle || structure.seoTitle || title).slice(0, 65),
      description: String(result.meta?.description || structure.description).slice(0, 160),
      slug,
      author: result.meta?.author || { name: 'Команда Lexis Voice', kind: 'organization' },
      ...result.meta,
    },
    blocks: normalizeBlocks(result.blocks || [], structure),
  };
}

function normalizeBlocks(blocks: DraftBlock[], structure: MaterialStructure): DraftBlock[] {
  const normalized = blocks.map((block, index) => normalizeRenderableBlock({
    ...block,
    id: block.id || structure.sections[index]?.id || `block-${index + 1}`,
    type: block.type || structure.sections[index]?.blockType || 'prose',
    sourceClaimIds: block.sourceClaimIds || structure.sections.find((section) => section.id === block.id)?.requiredClaimIds || [],
  }));

  return normalized.length > 0 ? normalized : structure.sections.map((section) => ({ id: section.id, type: section.blockType, title: section.title, text: '', sourceClaimIds: section.requiredClaimIds }));
}

function normalizeRenderableBlock(block: DraftBlock): DraftBlock {
  if (block.type === 'faq' && !block.heading && !block.title) {
    return { ...block, heading: 'Частые вопросы' };
  }
  if (block.type === 'cards' && !Array.isArray(block.cards) && Array.isArray(block.items)) {
    return { ...block, cards: block.items };
  }
  if (block.type === 'matrix') {
    return { ...block, type: 'table', head: block.head || block.columns || [], rows: block.rows || [] };
  }
  return block;
}

function slugFromRequest(request: PipelineRequest, structure: MaterialStructure): string {
  const knownUrl = request.brief.inputType === 'planned_topic' ? request.brief.knownFacts.match(/URL:\s*(\/[^\s]+)/)?.[1] : undefined;
  if (knownUrl) return knownUrl.split('/').filter(Boolean).at(-1) || slugify(structure.title);
  return slugify(structure.title);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'material';
}
