import { prepareSeoForPublication } from './seo-preparation.js';
import type { DraftDoc, FactPackage, MaterialStructure, PipelineRequest, ValidationIssue } from './types.js';

const AUTOFIXABLE_CODES = [
  /^visual_/,
  /visual/,
  /^weak_product_link$/,
  /^weak_product_link_placement$/,
  /^misplaced_product_link$/,
  /^missing_relevant_product_link$/,
  /^unsupported_internal_link$/,
  /^weak_related_links$/,
  /^weak_related_block$/,
  /^irrelevant_related_product_links$/,
  /^related_/,
  /^product_links_/,
  /^product_link_/,
  /^empty_content_block$/,
  /^empty_.*_block$/,
  /^missing_block_content$/,
  /^visual_source_block_empty$/,
  /^broken_visual_labels$/,
  /^duplicated_sentence$/,
  /^markup_artifacts_in_body$/,
  /^unsupported_frequency_claim$/,
  /^unsupported_superlative$/,
  /^unsupported_.*generalization$/,
  /^unsupported_.*grouping$/,
  /^unsupported_product_.*claim$/,
  /^unsupported_b2g_definition$/,
];

export function canAutofixReviewIssues(issues: ValidationIssue[]): boolean {
  const errors = issues.filter((issue) => issue.severity === 'error');
  return errors.length > 0 && errors.every((issue) => isBrokenVisualSlotIssue(issue) || AUTOFIXABLE_CODES.some((pattern) => pattern.test(issue.code)));
}

export function applyReviewAutofixes(request: PipelineRequest, facts: FactPackage, structure: MaterialStructure, draft: DraftDoc, issues: ValidationIssue[]): DraftDoc {
  const removeIndexes = new Set(
    issues
      .filter((issue) =>
        issue.code.startsWith('visual_') ||
        issue.code.includes('visual_slot') ||
        isBrokenVisualSlotIssue(issue) ||
        issue.code === 'empty_content_block' ||
        /^empty_.*_block$/.test(issue.code) ||
        issue.code === 'missing_block_content' ||
        issue.code === 'visual_source_block_empty' ||
        issue.code === 'broken_visual_labels'
      )
      .map((issue) => blockIndexFromPath(issue.path))
      .filter((index): index is number => typeof index === 'number'),
  );

  const unsupportedIndexes = new Set(
    issues
      .filter((issue) => /^unsupported_(product_.*claim|b2g_definition|.*generalization|.*grouping)$/.test(issue.code))
      .map((issue) => blockIndexFromPath(issue.path))
      .filter((index): index is number => typeof index === 'number'),
  );

  const withoutWeakVisuals = {
    ...draft,
    blocks: draft.blocks.filter((block, index) => {
      if (removeIndexes.has(index) && block.type === 'visual_slot') return false;
      if (removeIndexes.has(index) && isEmptyContentBlock(block)) return false;
      if (unsupportedIndexes.has(index) && isOptionalUnsupportedBlock(block)) return false;
      if (issues.some((issue) => issue.code.includes('visual')) && isWeakChecklistVisual(block)) return false;
      return true;
    }).map((block, index) => unsupportedIndexes.has(index) ? removeUnsupportedSentences(block) : block),
  };

  return prepareSeoForPublication(request, facts, structure, withoutWeakVisuals);
}

function isBrokenVisualSlotIssue(issue: ValidationIssue): boolean {
  return issue.code === 'broken_text' && /visualSlot|visual_slot|visual/i.test(`${issue.path || ''} ${issue.message}`);
}

function isOptionalUnsupportedBlock(block: DraftDoc['blocks'][number]): boolean {
  return block.type === 'faq' || block.type === 'cta';
}

function removeUnsupportedSentences(block: DraftDoc['blocks'][number]): DraftDoc['blocks'][number] {
  return normalizeBlockStrings(block, (text) => text
    .replace(/[^.!?]*(?:Lexis Voice|B2G|государствен)[^.!?]*(?:задач|участник|следующ|государствен|B2G)[^.!?]*[.!?]/giu, '')
    .replace(/\s{2,}/g, ' ')
    .trim());
}

function normalizeBlockStrings(block: DraftDoc['blocks'][number], transform: (text: string) => string): DraftDoc['blocks'][number] {
  return normalizeValueStrings(block, transform) as DraftDoc['blocks'][number];
}

function normalizeValueStrings(value: unknown, transform: (text: string) => string): unknown {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map((item) => normalizeValueStrings(item, transform));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeValueStrings(item, transform)]));
  return value;
}

function isEmptyContentBlock(block: DraftDoc['blocks'][number]): boolean {
  if (['lead', 'faq', 'related', 'sources', 'cta', 'visual_slot'].includes(block.type)) return false;
  const fields = [block.text, block.paragraphs, block.items, block.cards, block.rows, block.groups];
  return fields.every((field) => {
    if (Array.isArray(field)) return field.length === 0;
    return !String(field || '').trim();
  });
}

function isWeakChecklistVisual(block: DraftDoc['blocks'][number]): boolean {
  if (block.type !== 'visual_slot') return false;
  const kind = String(block.visualKind || block.visual || '');
  if (kind !== 'checklist') return false;
  const items = Array.isArray(block.items) ? block.items : [];
  return items.length > 0 && items.every((item) => Boolean(item && typeof item === 'object' && (item as { ok?: unknown }).ok === true));
}

function blockIndexFromPath(path: string | undefined): number | null {
  const value = path?.match(/blocks\[(\d+)]/)?.[1];
  return value ? Number(value) : null;
}
