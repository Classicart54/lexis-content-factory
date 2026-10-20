import { NeuromediaClient } from './neuromedia-client.js';
import { buildKnowledgeContext, type ProjectKnowledge } from './project-knowledge.js';
import type { DraftBlock, DraftDoc, FactPackage, PipelineRequest, ReviewReport, ValidationIssue, ValidationReport } from './types.js';

interface ReviewerAgentJson {
  approved?: boolean;
  issues?: Array<Partial<ValidationIssue>>;
  summary?: string;
}

const ISSUE_OWNERS = new Set<ValidationIssue['owner']>(['facts', 'structure', 'writer', 'system']);
const ISSUE_SEVERITIES = new Set<ValidationIssue['severity']>(['error', 'warning']);
const BLOCKING_CODES = new Set(['unsupported_fact', 'boundary_violation', 'broken_text', 'wrong_answer', 'fabricated_source']);

export class NeuromediaReviewerAgent {
  constructor(
    private readonly client: NeuromediaClient,
    private readonly projectKnowledge: ProjectKnowledge | null,
  ) {}

  async run(request: PipelineRequest, facts: FactPackage, finalDoc: DraftDoc, validationReport: ValidationReport, _context?: unknown): Promise<ReviewReport> {
    if (!validationReport.ok) {
      return {
        requestId: request.id,
        approved: false,
        issues: validationReport.issues,
        summary: 'Machine validation has blocking issues; semantic review was skipped.',
        checkedAt: new Date().toISOString(),
      };
    }

    const result = await this.client.createJsonCompletion<ReviewerAgentJson>({
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: [
            'You are the reviewer agent for Lexis Voice content pipeline.',
            'Role: autonomous semantic quality gate after deterministic validation. You do not rewrite the article and you do not publish it.',
            'Return only valid JSON.',
            'Approve only if the material answers the brief, uses sourced facts honestly, has no generic filler, no рекламная самоуверенность, and no unsupported conclusions.',
            'A paragraph is weak if it can be copied into a competitor article without changing words. Flag it as writer issue.',
            'Lexis Voice product facts, cases, metrics, integrations and definitions must come only from project knowledge or FactPackage. Never use memory or web assumptions.',
            'Do not flag Алексей Зеленин / expert-alexey-zelenin as fabricated_source when he appears in Project knowledge editorialExperts. Treat that block as internal editorial commentary, not as an external factual source. Still flag any unsupported statistics, legal claims, competitor facts or biographical claims inside the comment.',
            'Check visual_slot blocks as rendered schemes: visualKind must show a relationship between elements, not a row of text cards. Pipeline needs real sequence, checklist needs pass/fail norm, bars need sourced values, split needs two real paths.',
            'Flag a visual_slot if it duplicates the neighboring section with the same title, is the last useful block, or would remain an ordinary list after removing arrows/line/scale/checkmarks.',
            'Do not demand human approval. Route issues to facts, structure, writer or system.',
            'Use owner=facts for unsupported claims, weak sources, missing dates/quotes, legal/stat/competitor risks.',
            'Use owner=structure for wrong answer, missing section, bad order, CTA not matching topic, misplaced visual slot.',
            'Use owner=writer for filler, repetition, рекламный тон, weak FAQ/CTA wording, weak visual labels or product links grouped at the end instead of placed in relevant paragraphs.',
            'Use owner=system for broken JSON, missing artifacts, publication-format problems.',
            'Related blocks may intentionally contain only items[{href}]. The site resolves titles from its link index. Do not block publication only because related items have href without visible text; at most warn about relevance.',
            'Allowed severities: error, warning. approved must be false if any error exists. Broken grammar, broken sentence, unreadable wording, empty visible content and misleading visuals are errors, not warnings.',
            'Final JSON shape: {"approved":true|false,"issues":[{"code":"...","severity":"error|warning","owner":"facts|structure|writer|system","message":"...","path":"blocks[3].paragraphs[1]"}],"summary":"short review summary"}.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: buildReviewerPrompt(request, facts, finalDoc, validationReport, this.projectKnowledge),
        },
      ],
    });

    return normalizeReviewReport(request, result);
  }
}

function buildReviewerPrompt(request: PipelineRequest, facts: FactPackage, finalDoc: DraftDoc, validationReport: ValidationReport, knowledge: ProjectKnowledge | null): string {
  return [
    'Brief:',
    JSON.stringify(request.brief, null, 2),
    'Accepted FactPackage:',
    JSON.stringify(
      {
        claims: facts.claims,
        sources: facts.sources.map((source) => ({ id: source.id, url: source.url, title: source.title, publisher: source.publisher, retrievedAt: source.retrievedAt, publishedAt: source.publishedAt, reliability: source.reliability })),
        gaps: facts.gaps,
        angle: facts.angle,
      },
      null,
      2,
    ),
    'Machine validation report:',
    JSON.stringify(validationReport, null, 2),
    'Final assembled document summary:',
    JSON.stringify({ meta: finalDoc.meta, blocks: finalDoc.blocks.map(summarizeBlockForReview) }, null, 2),
    'Project knowledge:',
    buildKnowledgeContext(knowledge, request),
  ].join('\n\n');
}

export function summarizeBlockForReview(block: DraftBlock, index: number): Record<string, unknown> {
  return {
    index,
    id: block.id,
    type: block.type,
    title: block.heading || block.title,
    sourceBlockId: block.sourceBlockId,
    sourceClaimIds: block.sourceClaimIds || [],
    text: compactText(block.text),
    paragraphs: Array.isArray(block.paragraphs) ? block.paragraphs.map(compactText) : undefined,
    items: summarizeItems(block.items),
    cards: summarizeItems(block.cards as unknown[] | undefined),
    rows: Array.isArray(block.rows) ? block.rows.slice(0, 12) : undefined,
    groups: Array.isArray(block.groups) ? block.groups : undefined,
    table: summarizeTable(block),
    visualSlot: block.type === 'visual_slot' ? summarizeVisualSlot(block) : undefined,
  };
}

function summarizeTable(block: DraftBlock): Record<string, unknown> | undefined {
  if (block.type !== 'table' && block.type !== 'matrix') return undefined;
  return {
    columns: block.columns,
    head: block.head,
    rows: Array.isArray(block.rows) ? block.rows.slice(0, 12) : block.rows,
    groups: block.groups,
  };
}

function summarizeItems(items: unknown[] | undefined): unknown[] | undefined {
  if (!Array.isArray(items)) return undefined;
  return items.slice(0, 12).map((item) => {
    if (typeof item === 'string') return compactText(item);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, typeof value === 'string' ? compactText(value) : value]));
    }
    return item;
  });
}

function summarizeVisualSlot(block: DraftBlock): Record<string, unknown> {
  return {
    visualKind: block.visualKind || block.visual,
    items: summarizeItems(block.items as unknown[] | undefined),
    sides: block.sides,
    data: block.data,
  };
}

function compactText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > 900 ? `${value.slice(0, 900)}...` : value;
}

export function normalizeReviewReport(request: PipelineRequest, result: ReviewerAgentJson): ReviewReport {
  const issues = normalizeIssues(result.issues || []);
  const hasErrors = issues.some((issue) => issue.severity === 'error');

  return {
    requestId: request.id,
    approved: result.approved === true && !hasErrors,
    issues,
    summary: result.summary || (hasErrors ? 'Reviewer found blocking semantic issues.' : 'Reviewer approved the material.'),
    checkedAt: new Date().toISOString(),
  };
}

function normalizeIssues(issues: Array<Partial<ValidationIssue>>): ValidationIssue[] {
  return issues
    .map((issue, index) => normalizeIssue(issue, index))
    .filter((issue) => issue.message.trim().length > 0);
}

function normalizeIssue(issue: Partial<ValidationIssue>, index: number): ValidationIssue {
  const code = normalizeCode(issue.code, index);
  const severity = normalizeSeverity(issue, code);

  return {
    code,
    severity,
    owner: normalizeOwner(issue),
    message: String(issue.message || 'Reviewer returned an issue without a message.'),
    path: issue.path,
  };
}

function normalizeSeverity(issue: Partial<ValidationIssue>, normalizedCode: string): ValidationIssue['severity'] {
  const code = String(issue.code || '').toLowerCase();
  const message = String(issue.message || '').toLowerCase();
  if (/(related|читайте также|ссылк|href)/.test(`${code} ${message}`) && /href|ссылк|related|читайте также/.test(message)) return 'warning';
  if (/broken|grammar|wording_error|empty|misleading|unreadable|нечитаем|граммат|сломана|обрыва/.test(`${code} ${message}`)) return 'error';
  if (BLOCKING_CODES.has(normalizedCode)) return 'error';
  if (ISSUE_SEVERITIES.has(issue.severity as ValidationIssue['severity']) && issue.severity === 'warning') return 'warning';
  if (!ISSUE_SEVERITIES.has(issue.severity as ValidationIssue['severity']) && issue.severity) return 'error';
  return 'warning';
}

function normalizeOwner(issue: Partial<ValidationIssue>): ValidationIssue['owner'] {
  const code = typeof issue.code === 'string' ? issue.code.toLowerCase() : '';
  if (code.includes('internal_link')) return 'writer';
  if (code.includes('visual')) return 'writer';
  if (code.includes('unsupported_fact') || code.includes('fabricated_source')) return 'writer';
  if (ISSUE_OWNERS.has(issue.owner as ValidationIssue['owner'])) return issue.owner as ValidationIssue['owner'];
  return 'writer';
}

function normalizeCode(code: unknown, index: number): string {
  const raw = typeof code === 'string' ? code.toLowerCase() : '';
  if (/broken|grammar|wording_error|empty|unreadable|нечитаем|граммат|сломана|обрыва/.test(raw)) return 'broken_text';
  if (typeof code === 'string' && /^[a-z0-9_]+$/i.test(code)) return code.toLowerCase();
  return `review_issue_${index + 1}`;
}
