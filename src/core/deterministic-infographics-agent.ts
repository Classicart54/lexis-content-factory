import type { DraftBlock, DraftDoc, FactPackage, InfographicSpec, PipelineRequest } from './types.js';

export function runDeterministicInfographicsAgent(_request: PipelineRequest, facts: FactPackage, draft: DraftDoc): InfographicSpec[] {
  const specs: InfographicSpec[] = [];
  let emittedPipelineSlot = false;

  for (const block of draft.blocks) {
    if ((block.type === 'table' || block.type === 'matrix') && hasRows(block, 3)) {
      specs.push(makeTableSpec(block));
    }

    if (block.type === 'steps' && itemCount(block) >= 3) {
      specs.push(makeStepsSpec(block));
      const slot = visualSlotFromSteps(block, emittedPipelineSlot);
      if (slot) {
        specs.push(slot);
        emittedPipelineSlot = true;
      }
    }

    if (block.type === 'fork') {
      specs.push(makeForkSpec(block));
      specs.push(makeVisualSlotSpec(block, 'split', { sides: normalizeSplitSides(block) }, 'Два сценария'));
    }

    if (block.type === 'cards' && itemCount(block) >= 3) {
      specs.push(makeCardsSpec(block));
    }

    if (block.type === 'points' && itemCount(block) >= 4) {
      specs.push(makePointsSpec(block));
      const checklistItems = normalizeChecklistItems(block.items || []);
      if (hasMixedChecklistMarks(checklistItems)) {
        specs.push(makeVisualSlotSpec(block, 'checklist', { items: checklistItems }, 'Проверка подхода'));
      }
    }

    if (block.type === 'stats') {
      const statSpec = makeStatsSpec(block, facts);
      specs.push(statSpec);
      const barsItems = normalizeBarsItems(arrayValue(block.items || block.stats));
      if (statSpec.status === 'derivable' && barsItems.length >= 2) {
        specs.push(makeVisualSlotSpec(block, 'bars', { items: barsItems }, 'Сравнение величин'));
      }
    }
  }

  return dedupeSpecs(specs);
}

function visualSlotFromSteps(block: DraftBlock, alreadyEmitted: boolean): InfographicSpec | null {
  if (alreadyEmitted) return null;
  const text = `${block.heading || ''} ${block.title || ''} ${JSON.stringify(block.items || block.steps || [])}`.toLowerCase();
  if (!/этап|шаг|последователь|сначала|затем|после|цикл|процесс|алгоритм|воронк/.test(text)) return null;
  const items = normalizePipelineItems(arrayValue(block.items || block.steps));
  if (items.length < 3) return null;
  return makeVisualSlotSpec(block, 'pipeline', { items }, 'Порядок действий');
}

function makeTableSpec(block: DraftBlock): InfographicSpec {
  return {
    id: `visual-${block.id}-compare`,
    title: `Инфографика из блока: ${block.heading || block.title || block.id}`,
    kind: 'hero_compare',
    status: 'derivable',
    sourceBlockId: block.id,
    renderMode: 'template',
    blockType: 'comparison',
    data: pickData(block, ['head', 'rows', 'columns', 'groups', 'items']),
    sourceClaimIds: block.sourceClaimIds || [],
  };
}

function makeStepsSpec(block: DraftBlock): InfographicSpec {
  return {
    id: `visual-${block.id}-steps`,
    title: `Процесс: ${block.heading || block.title || block.id}`,
    kind: 'howto_steps',
    status: 'derivable',
    sourceBlockId: block.id,
    renderMode: 'template',
    blockType: 'steps',
    data: { items: block.items || block.steps || [] },
    sourceClaimIds: block.sourceClaimIds || [],
  };
}

function makeForkSpec(block: DraftBlock): InfographicSpec {
  return {
    id: `visual-${block.id}-fork`,
    title: `Развилка: ${block.heading || block.title || block.id}`,
    kind: 'decision_fork',
    status: 'derivable',
    sourceBlockId: block.id,
    renderMode: 'template',
    blockType: 'fork',
    data: pickData(block, ['options', 'neither', 'items']),
    sourceClaimIds: block.sourceClaimIds || [],
  };
}

function makeCardsSpec(block: DraftBlock): InfographicSpec {
  return {
    id: `visual-${block.id}-cards`,
    title: `Карточки: ${block.heading || block.title || block.id}`,
    kind: 'cards_grid',
    status: 'derivable',
    sourceBlockId: block.id,
    renderMode: 'template',
    blockType: 'cards',
    data: { items: block.items || block.cards || [] },
    sourceClaimIds: block.sourceClaimIds || [],
  };
}

function makePointsSpec(block: DraftBlock): InfographicSpec {
  return {
    id: `visual-${block.id}-points`,
    title: `Критерии: ${block.heading || block.title || block.id}`,
    kind: 'criteria_points',
    status: 'derivable',
    sourceBlockId: block.id,
    renderMode: 'template',
    blockType: 'cards',
    data: { items: block.items || [] },
    sourceClaimIds: block.sourceClaimIds || [],
  };
}

function makeStatsSpec(block: DraftBlock, facts: FactPackage): InfographicSpec {
  const claimIds = block.sourceClaimIds || [];
  const claims = facts.claims.filter((claim) => claimIds.includes(claim.id));
  const hasNumbers = JSON.stringify(block).match(/\d/);

  return {
    id: `visual-${block.id}-stats`,
    title: `Цифры: ${block.heading || block.title || block.id}`,
    kind: 'stats_strip',
    status: hasNumbers && claims.length > 0 ? 'derivable' : 'needs_data',
    sourceBlockId: block.id,
    renderMode: 'template',
    blockType: 'stat',
    data: pickData(block, ['items', 'stats', 'text']),
    sourceClaimIds: claimIds,
    missingData: hasNumbers ? [] : ['No numeric data found in stats block.'],
  };
}

function makeVisualSlotSpec(block: DraftBlock, visualKind: NonNullable<InfographicSpec['visualKind']>, shapeData: { items?: unknown[]; sides?: unknown[] }, title: string): InfographicSpec {
  const data = shapeData.sides ? { sides: shapeData.sides } : { items: shapeData.items || [] };
  return {
    id: `visual-slot-${block.id}`,
    title: block.heading || block.title || title,
    kind: 'visual_slot',
    visualKind,
    status: 'derivable',
    sourceBlockId: block.id,
    renderMode: 'custom_visual_slot',
    blockType: 'slot',
    data,
    items: shapeData.items,
    sides: shapeData.sides,
    sourceClaimIds: block.sourceClaimIds || [],
    visualSlot: {
      placement: 'after_block',
      afterBlockId: block.id,
      brief: `Выбрать форму ${visualKind} и показать одно отношение из блока без новых фактов.`,
      dataContract: [
        'Use only pipeline/checklist/bars/split render contract.',
        'Labels must be short: 2-4 words, never more than 8 words.',
        'Do not add new numbers, claims, competitors, prices or product capabilities.',
      ],
      allowedData: shapeData.sides ? ['sides'] : ['items'],
      forbiddenAdditions: ['new facts', 'new numbers', 'new competitors', 'new product capabilities', 'prices', 'performance promises'],
      visualGoal: 'Show one relationship between elements: order, norm, magnitude or split.',
      tone: 'editorial',
      designFreedom: 'custom_composition',
    },
  };
}

function normalizePipelineItems(items: unknown[]): unknown[] {
  return stripRepeatedTags(items.slice(0, 5).map((item, index) => ({ title: pipelineTitle(field(item, 'title') || field(item, 'text') || item, index), note: shortLabel(field(item, 'note') || field(item, 'description'), 10), tag: shortLabel(field(item, 'tag'), 3) })).filter((item) => item.title));
}

function normalizeChecklistItems(items: unknown[]): unknown[] {
  return items.slice(0, 6).map((item) => {
    const text = shortLabel(field(item, 'text') || field(item, 'title') || item);
    const explicit = field(item, 'ok');
    const ok = typeof explicit === 'boolean' ? explicit : !/ошиб|риск|нельзя|плохо|нет|срыв|теря|опасн|запрет/i.test(text);
    return { text, ok };
  }).filter((item) => item.text);
}

function hasMixedChecklistMarks(items: unknown[]): boolean {
  const marks = items.map((item) => field(item, 'ok')).filter((value) => typeof value === 'boolean');
  return marks.length === items.length && new Set(marks).size > 1;
}

function normalizeBarsItems(items: unknown[]): unknown[] {
  return items.slice(0, 6).map((item) => {
    const rawValue = field(item, 'value') || field(item, 'percent') || field(item, 'score');
    const value = Number(rawValue);
    return { label: shortLabel(field(item, 'label') || field(item, 'title') || item), value: Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)), display: field(item, 'display'), hasValue: Number.isFinite(value) };
  }).filter((item) => item.label && item.hasValue).map(({ hasValue: _hasValue, ...item }) => item);
}

function normalizeSplitSides(block: DraftBlock): unknown[] {
  const options = Array.isArray(block.options) ? block.options : Array.isArray(block.items) ? block.items : [];
  return options.slice(0, 2).map((option, index) => ({ title: shortLabel(field(option, 'title') || field(option, 'label') || `Вариант ${index + 1}`), items: asTextItems(field(option, 'items')).slice(0, 4) }));
}

function asTextItems(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => shortLabel(field(item, 'text') || field(item, 'title') || item, 12)).filter(Boolean);
  return [];
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

function shortLabel(value: unknown, words = 6): string {
  return String(textValue(value) || '').trim().split(/\s+/).filter(Boolean).slice(0, words).join(' ');
}

function pipelineTitle(value: unknown, index: number): string {
  const label = shortLabel(value, 4);
  return label.split(/\s+/).filter(Boolean).length >= 2 ? label : `Шаг ${index + 1}`;
}

function stripRepeatedTags<T extends { tag?: string }>(items: T[]): T[] {
  const tags = items.map((item) => item.tag).filter(Boolean);
  if (tags.length > 1 && new Set(tags).size === 1) return items.map((item) => ({ ...item, tag: undefined }));
  return items;
}

function textValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return record.title || record.text || record.label || record.name || record.q || record.question || '';
}

function hasRows(block: DraftBlock, minRows: number): boolean {
  const rows = block.rows;
  if (Array.isArray(rows)) return rows.length >= minRows;
  const groups = block.groups;
  if (Array.isArray(groups)) {
    return groups.some((group) => Boolean(group && typeof group === 'object' && Array.isArray((group as { rows?: unknown[] }).rows) && (group as { rows: unknown[] }).rows.length >= minRows));
  }
  return itemCount(block) >= minRows;
}

function itemCount(block: DraftBlock): number {
  if (Array.isArray(block.items)) return block.items.length;
  if (Array.isArray(block.steps)) return block.steps.length;
  if (Array.isArray(block.cards)) return block.cards.length;
  return 0;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pickData(block: DraftBlock, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => block[key] !== undefined).map((key) => [key, block[key]]));
}

function dedupeSpecs(specs: InfographicSpec[]): InfographicSpec[] {
  return [...new Map(specs.map((spec) => [spec.id, spec])).values()];
}
