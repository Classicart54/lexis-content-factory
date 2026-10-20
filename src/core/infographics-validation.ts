import type { DraftDoc, FactPackage, InfographicSpec, ValidationIssue } from './types.js';

const VISUAL_KINDS = new Set(['pipeline', 'checklist', 'bars', 'split']);
const MAX_LABEL_WORDS = 8;

export function validateInfographics(facts: FactPackage, draft: DraftDoc, specs: InfographicSpec[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const blockIds = new Set(draft.blocks.map((block) => block.id));
  const claimIds = new Set(facts.claims.map((claim) => claim.id));
  const pipelineSlots = specs.filter((spec) => spec.kind === 'visual_slot' && spec.visualKind === 'pipeline');

  if (pipelineSlots.length > 1) {
    issues.push({
      code: 'visual_too_many_pipelines',
      severity: 'error',
      owner: 'structure',
      message: `Guide visual slots contain ${pipelineSlots.length} pipeline schemes. Pipeline must not be the default infographic; keep one real sequence or use split/checklist/bars.`,
    });
  }

  for (const spec of specs) {
    if (spec.sourceBlockId && !blockIds.has(spec.sourceBlockId)) {
      issues.push({ code: 'visual_unknown_block', severity: 'error', owner: 'writer', message: `Visual ${spec.id} references unknown block ${spec.sourceBlockId}.` });
    }

    for (const claimId of spec.sourceClaimIds) {
      if (!claimIds.has(claimId)) {
        issues.push({ code: 'visual_unknown_claim', severity: 'error', owner: 'facts', message: `Visual ${spec.id} references unknown claim ${claimId}.` });
      }
    }

    if (spec.status === 'derivable' && isEmptyData(spec.data)) {
      issues.push({ code: 'visual_empty_data', severity: 'error', owner: 'writer', message: `Visual ${spec.id} is derivable but has empty data.` });
    }

    if (spec.kind === 'visual_slot') {
      issues.push(...validateVisualSlotShape(spec));
    }

    if (spec.kind === 'visual_slot' && spec.renderMode !== 'custom_visual_slot') {
      issues.push({ code: 'visual_slot_bad_mode', severity: 'error', owner: 'structure', message: `Visual slot ${spec.id} must use custom_visual_slot render mode.` });
    }

    if (spec.kind === 'visual_slot' && spec.visualSlot) {
      if (spec.visualSlot.placement === 'after_block' && spec.visualSlot.afterBlockId !== spec.sourceBlockId) {
        issues.push({ code: 'visual_slot_bad_placement', severity: 'error', owner: 'structure', message: `Visual slot ${spec.id} must be placed after its source block.` });
      }
    }

    if (spec.status === 'needs_data' && (!spec.missingData || spec.missingData.length === 0)) {
      issues.push({ code: 'visual_missing_data_reason', severity: 'warning', owner: 'writer', message: `Visual ${spec.id} needs data but does not explain what is missing.` });
    }
  }

  return issues;
}

export function removeWeakVisualSlots(specs: InfographicSpec[], issues: ValidationIssue[]): InfographicSpec[] {
  if (!issues.some((issue) => issue.code === 'visual_checklist_no_contrast' || issue.code === 'visual_too_many_pipelines')) return specs;

  let pipelineSlotSeen = false;
  return specs.filter((spec) => {
    if (spec.kind !== 'visual_slot') return true;
    if (spec.visualKind === 'checklist' && hasChecklistWithoutContrast(spec)) return false;
    if (spec.visualKind === 'pipeline') {
      if (pipelineSlotSeen) return false;
      pipelineSlotSeen = true;
    }
    return true;
  });
}

function validateVisualSlotShape(spec: InfographicSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!spec.visualKind || !VISUAL_KINDS.has(spec.visualKind)) {
    issues.push({ code: 'visual_unknown_kind', severity: 'error', owner: 'structure', message: `Visual slot ${spec.id} must use visualKind pipeline, checklist, bars or split.` });
    return issues;
  }

  if (spec.visualKind === 'split') {
    const sides = Array.isArray(spec.sides) ? spec.sides : [];
    if (sides.length !== 2) issues.push({ code: 'visual_split_bad_sides', severity: 'error', owner: 'structure', message: `Split visual ${spec.id} must contain exactly two sides.` });
    for (const side of sides) {
      if (wordCount((side as { title?: unknown })?.title) > MAX_LABEL_WORDS) {
        issues.push({ code: 'visual_label_too_long', severity: 'error', owner: 'writer', message: `Visual ${spec.id} has a label longer than ${MAX_LABEL_WORDS} words.` });
      }
    }
    return issues;
  }

  const items = Array.isArray(spec.items) ? spec.items : Array.isArray((spec.data as { items?: unknown[] })?.items) ? (spec.data as { items: unknown[] }).items : [];
  const min = spec.visualKind === 'pipeline' ? 3 : 2;
  const max = spec.visualKind === 'pipeline' ? 5 : 6;
  if (items.length < min || items.length > max) {
    issues.push({ code: 'visual_bad_item_count', severity: 'error', owner: 'structure', message: `Visual ${spec.id} kind ${spec.visualKind} must contain ${min}-${max} items; got ${items.length}.` });
  }

  for (const item of items) {
    const record = item as { title?: unknown; text?: unknown; label?: unknown; tag?: unknown; ok?: unknown; value?: unknown };
    const label = record.title || record.text || record.label;
    if (spec.visualKind === 'pipeline' && (wordCount(record.title) < 2 || wordCount(record.title) > 4)) {
      issues.push({ code: 'visual_pipeline_title_length', severity: 'error', owner: 'writer', message: `Pipeline visual ${spec.id} item titles must contain 2-4 words.` });
    }
    if (spec.visualKind === 'pipeline' && wordCount((item as { note?: unknown }).note) > 10) {
      issues.push({ code: 'visual_pipeline_note_too_long', severity: 'error', owner: 'writer', message: `Pipeline visual ${spec.id} item notes must contain 10 words or less.` });
    }
    if (wordCount(label) > MAX_LABEL_WORDS || wordCount(record.tag) > MAX_LABEL_WORDS) {
      issues.push({ code: 'visual_label_too_long', severity: 'error', owner: 'writer', message: `Visual ${spec.id} has a label longer than ${MAX_LABEL_WORDS} words.` });
    }
    if (/\[object Object\]/iu.test(String(label || record.tag || ''))) {
      issues.push({ code: 'visual_object_label', severity: 'error', owner: 'writer', message: `Visual ${spec.id} contains object rendered as label.` });
    }
    if (spec.visualKind === 'checklist' && typeof record.ok !== 'boolean') {
      issues.push({ code: 'visual_checklist_bad_item', severity: 'error', owner: 'structure', message: `Checklist visual ${spec.id} items must contain boolean ok.` });
    }
    if (spec.visualKind === 'bars' && (typeof record.value !== 'number' || record.value < 0 || record.value > 100)) {
      issues.push({ code: 'visual_bars_bad_value', severity: 'error', owner: 'structure', message: `Bars visual ${spec.id} items must contain value from 0 to 100.` });
    }
  }

  if (spec.visualKind === 'checklist') {
    if (hasChecklistWithoutContrast(spec, items)) {
      issues.push({ code: 'visual_checklist_no_contrast', severity: 'error', owner: 'structure', message: `Checklist visual ${spec.id} uses the same ok status for every item. This is a list with icons, not a pass/fail scheme.` });
    }
  }

  const tags = items.map((item) => (item as { tag?: unknown }).tag).filter(Boolean).map(String);
  if (spec.visualKind === 'pipeline' && tags.length > 1 && new Set(tags).size === 1) {
    issues.push({ code: 'visual_repeated_tag', severity: 'error', owner: 'writer', message: `Pipeline visual ${spec.id} must not repeat the same tag on every item.` });
  }

  return issues;
}

function hasChecklistWithoutContrast(spec: InfographicSpec, knownItems?: unknown[]): boolean {
  const items = knownItems || (Array.isArray(spec.items) ? spec.items : Array.isArray((spec.data as { items?: unknown[] })?.items) ? (spec.data as { items: unknown[] }).items : []);
  const marks = items.map((item) => (item as { ok?: unknown }).ok).filter((value) => typeof value === 'boolean');
  return marks.length === items.length && marks.length > 1 && new Set(marks).size === 1;
}

function isEmptyData(data: unknown): boolean {
  if (!data) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'object') return Object.keys(data).length === 0;
  return false;
}

function wordCount(value: unknown): number {
  if (typeof value !== 'string') return 0;
  return value.trim().split(/\s+/).filter(Boolean).length;
}
