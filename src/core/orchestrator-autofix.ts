import { prepareSeoForPublication } from './seo-preparation.js';
import type { DraftBlock, DraftDoc, FactPackage, MaterialStructure, PipelineRequest, ValidationIssue } from './types.js';

const CONTENT_SECTION_TYPES = new Set(['tldr', 'prose', 'points', 'steps', 'table', 'stats', 'matrix', 'cards', 'fork', 'verdict', 'quote', 'callout']);
const MAX_CONTENT_SECTIONS = 8;

const AUTOFIXABLE_VALIDATION_CODES = [
  /^visual_/,
  /visual/,
  /^related_/,
  /^product_links_/,
  /^product_link_/,
  /^bare_internal_path$/,
  /^cards_not_renderable$/,
  /^matrix_not_renderable$/,
  /^guide_matrix_forbidden$/,
  /^faq_heading_missing$/,
  /^lead_length$/,
  /^sources_/,
  /^too_many_content_sections$/,
  /^not_enough_accents$/,
  /^publication_not_enough_accents$/,
  /^publication_word_count_high$/,
  /^publication_parent_unpublished$/,
  /^publication_related_links$/,
  /^publication_visual_issue$/,
];

export function canAutofixValidationIssues(issues: ValidationIssue[]): boolean {
  const errors = issues.filter((issue) => issue.severity === 'error');
  return errors.length > 0 && errors.every((issue) => AUTOFIXABLE_VALIDATION_CODES.some((pattern) => pattern.test(issue.code)));
}

export function applyValidationAutofixes(request: PipelineRequest, facts: FactPackage, structure: MaterialStructure, draft: DraftDoc, issues: ValidationIssue[]): DraftDoc {
  let fixed: DraftDoc = { ...draft, blocks: [...draft.blocks] };

  if (issues.some((issue) => issue.code === 'too_many_content_sections')) {
    fixed = { ...fixed, blocks: trimExtraContentSections(fixed.blocks) };
  }

  if (issues.some((issue) => issue.code === 'publication_word_count_high')) {
    fixed = { ...fixed, blocks: trimForWordLimit(fixed.blocks, 1800, new Set(structure.requiredBlocks || [])) };
  }

  if (issues.some((issue) => issue.code === 'not_enough_accents' || issue.code === 'publication_not_enough_accents')) {
    fixed = { ...fixed, blocks: addScanAccent(fixed.blocks) };
  }

  if (issues.some((issue) => issue.code === 'lead_length')) {
    fixed = { ...fixed, blocks: normalizeLeadLength(fixed.blocks) };
  }

  if (issues.some((issue) => issue.code === 'publication_parent_unpublished')) {
    fixed = { ...fixed, meta: { ...fixed.meta, parent: undefined } };
  }

  return prepareSeoForPublication(request, facts, structure, fixed);
}

function normalizeLeadLength(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block) => {
    if (block.type !== 'lead' || typeof block.text !== 'string') return block;
    let text = block.text.trim();
    if (text.length < 200) {
      text = `${text.replace(/[.!?]?$/u, '')}. Так менеджер отвечает на реальный барьер, проверяет смысл сомнения и ведет клиента к следующему шагу без давления в разговоре.`;
    }
    while (text.length > 450) {
      const next = text.replace(/\s*[^.!?]{20,220}[.!?]\s*$/u, '').trim();
      if (!next || next === text || next.length < 200) break;
      text = next;
    }
    return { ...block, text };
  });
}

function trimForWordLimit(blocks: DraftBlock[], maxWords = 1950, requiredTypes = new Set<string>()): DraftBlock[] {
  let out = [...blocks];
  while (countWords(out) > maxWords) {
    const index = findTrimCandidate(out, requiredTypes);
    if (index < 0) break;
    const trimmed = trimBlock(out[index]);
    if (!trimmed && canRemoveForWordLimit(out[index], requiredTypes)) out = out.filter((_block, blockIndex) => blockIndex !== index);
    else if (!trimmed) break;
    else out = out.map((block, blockIndex) => blockIndex === index ? trimmed : block);
  }
  return out;
}

function addScanAccent(blocks: DraftBlock[]): DraftBlock[] {
  let added = 0;
  return blocks.map((block) => {
    if (added >= 3 || block.type === 'lead' || block.type === 'sources' || block.type === 'related' || block.type === 'visual_slot' || !canAccentBlock(block)) return block;
    added += 1;
    return accentBlock(block);
  });
}

function canAccentBlock(block: DraftBlock): boolean {
  if (Array.isArray(block.paragraphs) && block.paragraphs.some((paragraph) => accentableSentence(String(paragraph)))) return true;
  if (typeof block.text === 'string' && accentableSentence(block.text)) return true;
  if (Array.isArray(block.items) && block.items.some((item) => item && typeof item === 'object' && accentableSentence(String((item as { text?: unknown; answer?: unknown; description?: unknown }).text || (item as { answer?: unknown }).answer || (item as { description?: unknown }).description || '')))) return true;
  return false;
}

function accentBlock(block: DraftBlock): DraftBlock {
  if (Array.isArray(block.paragraphs)) {
    return { ...block, paragraphs: block.paragraphs.map((paragraph, index) => index === 0 ? accentFirstSentence(String(paragraph)) : paragraph) };
  }
  if (typeof block.text === 'string') return { ...block, text: accentFirstSentence(block.text) };
  if (Array.isArray(block.items)) {
    let changed = false;
    return {
      ...block,
      items: block.items.map((item) => {
        if (changed || !item || typeof item !== 'object') return item;
        const next = { ...(item as Record<string, unknown>) };
        for (const key of ['text', 'answer', 'description']) {
          if (typeof next[key] === 'string' && accentableSentence(next[key])) {
            next[key] = accentFirstSentence(next[key]);
            changed = true;
            break;
          }
        }
        return next;
      }),
    };
  }
  return block;
}

function accentableSentence(text: string): boolean {
  const sentence = firstPlainSentence(text);
  return sentence.length >= 20 && !/\*\*[^*]+\*\*|==[^=]+==/u.test(sentence);
}

function accentFirstSentence(text: string): string {
  const sentence = firstPlainSentence(text);
  if (!sentence) return text;
  return text.replace(sentence, `**${sentence.replace(/[.!?]\s*$/u, '')}**${sentence.match(/[.!?]\s*$/u)?.[0] || '.'}`);
}

function firstPlainSentence(text: string): string {
  for (const match of text.matchAll(/\*\*[^*]+\*\*|==[^=]+==|\[[^\]]+\]\([^)]+\)|[^.!?]{20,220}[.!?]/gu)) {
    const sentence = match[0].trim();
    if (!sentence || /^\*\*[^*]+\*\*$|^==[^=]+==$|^\[[^\]]+\]\([^)]+\)$/u.test(sentence)) continue;
    if (/\*\*|==|\[[^\]]+\]\([^)]+\)/u.test(sentence)) continue;
    if (insideOpenMarkup(text.slice(0, match.index || 0), '**') || insideOpenMarkup(text.slice(0, match.index || 0), '==')) continue;
    return sentence;
  }
  const words = text.trim().split(/\s+/).filter((word) => !/[=*\][()]/u.test(word)).slice(0, 6).join(' ');
  return /\*\*|==|\[|\]/u.test(words) ? '' : words;
}

function insideOpenMarkup(prefix: string, marker: string): boolean {
  return prefix.split(marker).length % 2 === 0;
}

function findTrimCandidate(blocks: DraftBlock[], requiredTypes = new Set<string>()): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block || requiredTypes.has(block.type) || ['lead', 'related', 'sources', 'visual_slot'].includes(block.type)) continue;
    if (block.type === 'callout' || block.type === 'quote') return index;
  }
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block || requiredTypes.has(block.type) || ['lead', 'related', 'sources', 'visual_slot', 'faq', 'cta'].includes(block.type)) continue;
    return index;
  }
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block || ['lead', 'related', 'sources', 'visual_slot'].includes(block.type)) continue;
    return index;
  }
  return -1;
}

function canRemoveForWordLimit(block: DraftBlock | undefined, requiredTypes = new Set<string>()): boolean {
  return Boolean(block && !requiredTypes.has(block.type) && !['lead', 'related', 'sources', 'visual_slot', 'faq', 'cta'].includes(block.type));
}

function trimBlock(block: DraftBlock): DraftBlock | null {
  if (Array.isArray(block.items) && block.items.length > 8) return { ...block, items: block.items.slice(0, -1) };
  if (Array.isArray(block.paragraphs) && block.paragraphs.length > 0) {
    const paragraphs = [...block.paragraphs];
    const original = String(paragraphs.at(-1) || '');
    const last = removeLastSentence(original);
    if (last === original.trim()) return null;
    if (last.trim()) return { ...block, paragraphs: [...paragraphs.slice(0, -1), last] };
    if (paragraphs.length > 1) return { ...block, paragraphs: paragraphs.slice(0, -1) };
  }
  if (typeof block.text === 'string') {
    const text = removeLastSentence(block.text);
    if (text === block.text.trim()) return null;
    if (text.trim()) return { ...block, text };
  }
  return null;
}

function removeLastSentence(text: string): string {
  return text.replace(/\s*[^.!?]{20,220}[.!?]\s*$/u, '').trim();
}

function trimExtraContentSections(blocks: DraftBlock[]): DraftBlock[] {
  const contentIndexes = blocks.map((block, index) => ({ block, index })).filter(({ block }) => CONTENT_SECTION_TYPES.has(block.type));
  let extra = contentIndexes.length - MAX_CONTENT_SECTIONS;
  if (extra <= 0) return blocks;

  const removable = [...contentIndexes]
    .reverse()
    .filter(({ block }) => isWeakContentSection(block))
    .map(({ index }) => index);

  const removeIndexes = new Set<number>();
  for (const index of removable) {
    if (extra <= 0) break;
    removeIndexes.add(index);
    extra -= 1;
  }

  return blocks.filter((_block, index) => !removeIndexes.has(index));
}

function isWeakContentSection(block: DraftBlock): boolean {
  const text = collectText(block);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < 80) return true;
  if (block.type === 'quote' || block.type === 'callout' || block.type === 'stats') return true;
  return false;
}

function collectText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectText).join('\n');
  if (value && typeof value === 'object') return Object.values(value).map(collectText).join('\n');
  return '';
}

function countWords(blocks: DraftBlock[]): number {
  return blocks.filter((block) => block.type !== 'visual_slot').reduce((sum, block) => sum + collectText(block).trim().split(/\s+/).filter(Boolean).length, 0);
}
