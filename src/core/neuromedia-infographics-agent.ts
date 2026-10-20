import { runDeterministicInfographicsAgent } from './deterministic-infographics-agent.js';
import { NeuromediaClient } from './neuromedia-client.js';
import type { DraftBlock, DraftDoc, FactPackage, InfographicSpec, PipelineRequest } from './types.js';

interface InfographicsAgentJson {
  visuals?: InfographicSpec[];
  patches?: Array<{ blockId?: string; what?: string; owner?: string }>;
  missingData?: Array<{ visualKind?: string; need?: string }> | string[];
}

export class NeuromediaInfographicsAgent {
  constructor(private readonly client: NeuromediaClient) {}

  async run(request: PipelineRequest, facts: FactPackage, draft: DraftDoc): Promise<InfographicSpec[]> {
    const baseline = runDeterministicInfographicsAgent(request, facts, draft);
    const result = await this.client.createJsonCompletion<InfographicsAgentJson>({
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [
            'You are the infographic agent for Lexis Voice content pipeline.',
            'Role: visual editor and data-contract editor. You do not write article prose and do not create images.',
            'Return only valid JSON.',
            'Your job is to choose useful visual_slot blocks from already written data blocks. The website renders the visual; you only choose the form and fill a minimal data schema.',
            'Allowed visualKind values are exactly: pipeline, checklist, bars, split. Any other value will not render.',
            'The visual must explain logic, not restyle prose. If removing shapes/arrows/scale/order and leaving only words preserves the same meaning, skip the visual.',
            'Use pipeline for order, checklist for norm/pass-fail, bars for magnitude, split for a real two-way fork.',
            'For guides, do not create hero either/or visuals from a normal overview list of complementary techniques. Forks are only for real mutually exclusive choices.',
            'Design for a narrow article column: pipeline items 3-5, checklist/bars items 2-6, split sides exactly 2. Pipeline title must be 2-4 words, note up to 10 words. Other labels 2-4 words, never more than 8 words.',
            'Do not set tag when every pipeline item has the same tag. Repeating SPIN four times is noise.',
            'A row of text cards is also a table. The scheme must be made by relationship: line, arrows, scale, split or checks.',
            'Avoid wide matrices, five-column layouts, paragraph-heavy cells and visuals that merely duplicate an existing table.',
            'Use only sourceBlockId data and existing FactPackage claim ids. Never add numbers, product capabilities, competitor comparisons, prices, dates or promises that are not present in the source data.',
            'Prefer 1-3 custom visual slots for the most important structured ideas. Do not turn every block into a visual.',
            'Every visual_slot must have kind visual_slot, visualKind, renderMode custom_visual_slot, sourceBlockId, sourceClaimIds and data. For pipeline/checklist/bars put data.items and items. For split put data.sides and sides.',
            'Allowed visual kinds: visual_slot only for new slots. Legacy template visuals may appear in baseline, but final custom slots must use visualKind pipeline/checklist/bars/split.',
            'Allowed render modes: template, custom_visual_slot.',
            'Allowed blockType values: stat, steps, comparison, timeline, cards, fork, slot.',
            'Final JSON shape: {"visuals":[InfographicSpec],"patches":[],"missingData":[]}.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: buildInfographicsPrompt(request, facts, draft, baseline),
        },
      ],
    });

    return normalizeSpecs(result.visuals || baseline, facts, draft, baseline);
  }
}

function buildInfographicsPrompt(request: PipelineRequest, facts: FactPackage, draft: DraftDoc, baseline: InfographicSpec[]): string {
  return [
    'Brief:',
    JSON.stringify(request.brief, null, 2),
    'Allowed claim ids:',
    JSON.stringify(facts.claims.map((claim) => ({ id: claim.id, claim: claim.claim, allowedInFinal: claim.allowedInFinal, confidence: claim.confidence })), null, 2),
    'Draft blocks summary:',
    JSON.stringify(draft.blocks.map(summarizeBlock), null, 2),
    'Baseline deterministic visual specs. You may keep, remove or improve them, but do not reference unknown blocks or claims:',
    JSON.stringify(baseline, null, 2),
  ].join('\n\n');
}

function summarizeBlock(block: DraftBlock): Record<string, unknown> {
  return {
    id: block.id,
    type: block.type,
    title: block.heading || block.title,
    sourceClaimIds: block.sourceClaimIds || [],
    dataKeys: Object.keys(block).filter((key) => !['text', 'paragraphs'].includes(key)),
    rowCount: Array.isArray(block.rows) ? block.rows.length : undefined,
    itemCount: Array.isArray(block.items) ? block.items.length : undefined,
    sample: sampleBlockData(block),
  };
}

function sampleBlockData(block: DraftBlock): Record<string, unknown> {
  const sample: Record<string, unknown> = {};
  for (const key of ['head', 'rows', 'columns', 'groups', 'items', 'stats', 'steps', 'options', 'neither']) {
    const value = block[key];
    if (Array.isArray(value)) sample[key] = value.slice(0, 5);
    else if (value !== undefined) sample[key] = value;
  }
  return sample;
}

function normalizeSpecs(specs: InfographicSpec[], facts: FactPackage, draft: DraftDoc, baseline: InfographicSpec[]): InfographicSpec[] {
  const blockIds = new Set(draft.blocks.map((block) => block.id));
  const claimIds = new Set(facts.claims.map((claim) => claim.id));
  const baselineById = new Map(baseline.map((spec) => [spec.id, spec]));

  const normalized = specs
    .map((spec, index) => normalizeSpec(spec, index, draft, claimIds, baselineById))
    .filter((spec) => Boolean(spec.sourceBlockId && blockIds.has(spec.sourceBlockId)))
    .map((spec) => ({ ...spec, sourceClaimIds: spec.sourceClaimIds.filter((claimId) => claimIds.has(claimId)) }));

  const llmSlotBlockIds = new Set(normalized.filter((spec) => spec.kind === 'visual_slot').map((spec) => spec.sourceBlockId));
  const baselineWithoutDuplicateSlots = baseline.filter((spec) => spec.status !== 'skip' && !(spec.kind === 'visual_slot' && llmSlotBlockIds.has(spec.sourceBlockId)));
  const merged = [...baselineWithoutDuplicateSlots, ...normalized];
  return [...new Map(merged.map((spec) => [spec.id, spec])).values()];
}

function normalizeSpec(spec: InfographicSpec, index: number, draft: DraftDoc, claimIds: Set<string>, baselineById: Map<string, InfographicSpec>): InfographicSpec {
  const sourceBlockId = spec.sourceBlockId || baselineById.get(spec.id)?.sourceBlockId || draft.blocks[index]?.id;
  const sourceBlock = draft.blocks.find((block) => block.id === sourceBlockId);
  const sourceClaimIds = normalizeClaimIds(spec.sourceClaimIds, sourceBlock, claimIds);
  const kind = spec.kind || 'visual_slot';
  const renderMode = kind === 'visual_slot' ? 'custom_visual_slot' : spec.renderMode || 'template';
  const blockType = kind === 'visual_slot' ? 'slot' : spec.blockType || inferBlockType(kind);
  const visualKind = kind === 'visual_slot' ? normalizeVisualKind(spec.visualKind, sourceBlock) : undefined;
  const shape = kind === 'visual_slot' ? normalizeVisualShape(visualKind, spec, sourceBlock) : { data: spec.data && !isEmptyData(spec.data) ? spec.data : pickSourceData(sourceBlock) };
  const data = shape.data;
  const status = spec.status || 'derivable';

  return {
    id: spec.id || `visual-${sourceBlockId || index + 1}`,
    title: spec.title || `Визуальный блок: ${sourceBlock?.heading || sourceBlock?.title || sourceBlockId || index + 1}`,
    kind,
    visualKind,
    status: status === 'derivable' && isEmptyData(data) ? 'skip' : status,
    sourceBlockId,
    renderMode,
    visualSlot: kind === 'visual_slot' ? normalizeVisualSlot(spec, sourceBlock) : undefined,
    blockType,
    data,
    items: shape.items,
    sides: shape.sides,
    sourceClaimIds,
    missingData: spec.missingData || [],
  };
}

function normalizeVisualKind(kind: InfographicSpec['visualKind'], sourceBlock: DraftBlock | undefined): InfographicSpec['visualKind'] {
  if (kind === 'pipeline' || kind === 'checklist' || kind === 'bars' || kind === 'split') return kind;
  if (sourceBlock?.type === 'steps') return 'pipeline';
  if (sourceBlock?.type === 'fork') return 'split';
  if (sourceBlock?.type === 'stats') return 'bars';
  return 'checklist';
}

function normalizeVisualShape(visualKind: InfographicSpec['visualKind'], spec: InfographicSpec, sourceBlock: DraftBlock | undefined): { data: unknown; items?: unknown[]; sides?: unknown[] } {
  const dataRecord = spec.data && typeof spec.data === 'object' ? (spec.data as Record<string, unknown>) : {};
  if (visualKind === 'split') {
    const sides = normalizeSides(spec.sides || (dataRecord.sides as unknown[]) || sourceBlock?.options || sourceBlock?.items || []);
    return { data: { sides }, sides };
  }
  const items = normalizeItems(visualKind, spec.items || (dataRecord.items as unknown[]) || sourceBlock?.items || sourceBlock?.steps || sourceBlock?.stats || []);
  return { data: { items }, items };
}

function normalizeItems(visualKind: InfographicSpec['visualKind'], rawItems: unknown): unknown[] {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (visualKind === 'bars') {
    return items.slice(0, 6).map((item, index) => {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const value = Number(record.value || record.percent || record.score || 100 - index * 10);
      return { label: shortWords(record.label || record.title || item, 6), value: Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)), display: record.display };
    }).filter((item) => item.label);
  }
  if (visualKind === 'checklist') {
    return items.slice(0, 6).map((item) => {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return { text: shortWords(record.text || record.title || item, 8), ok: record.ok === false ? false : true };
    }).filter((item) => item.text);
  }
  return stripRepeatedTags(items.slice(0, 5).map((item, index) => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return { title: pipelineTitle(record.title || record.text || item, index), note: shortWords(record.note || record.description, 10), tag: shortWords(record.tag, 3) };
  }).filter((item) => item.title));
}

function normalizeSides(rawSides: unknown): unknown[] {
  const sides = Array.isArray(rawSides) ? rawSides : [];
  return sides.slice(0, 2).map((side, index) => {
    const record = side && typeof side === 'object' ? (side as Record<string, unknown>) : {};
    const rawItems = Array.isArray(record.items) ? record.items : [];
    return { title: shortWords(record.title || record.label || `Вариант ${index + 1}`, 6), items: rawItems.slice(0, 4).map((item) => shortWords(typeof item === 'string' ? item : (item as { text?: unknown; title?: unknown })?.text || (item as { title?: unknown })?.title, 12)).filter(Boolean) };
  });
}

function shortWords(value: unknown, words: number): string {
  return String(textValue(value) || '').trim().split(/\s+/).filter(Boolean).slice(0, words).join(' ');
}

function pipelineTitle(value: unknown, index: number): string {
  const label = shortWords(value, 4);
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

function normalizeVisualSlot(spec: InfographicSpec, sourceBlock: DraftBlock | undefined): NonNullable<InfographicSpec['visualSlot']> {
  const sourceBlockId = spec.sourceBlockId || sourceBlock?.id;
  const slot = spec.visualSlot;
  const allowedData = slot?.allowedData?.length ? slot.allowedData : Object.keys(pickSourceData(sourceBlock));

  return {
    placement: slot?.placement || 'after_block',
    afterBlockId: sourceBlockId,
    brief: slot?.brief || `Собрать кастомную инфографику из блока ${sourceBlock?.heading || sourceBlock?.title || sourceBlockId}: показать структуру идеи без новых фактов.`,
    dataContract: slot?.dataContract?.length
      ? slot.dataContract
      : ['Use only data from sourceBlockId and sourceClaimIds.', 'Do not add new numbers, claims, products, prices, competitors or promises.'],
    allowedData,
    forbiddenAdditions: slot?.forbiddenAdditions?.length ? slot.forbiddenAdditions : ['new facts', 'new numbers', 'new product capabilities', 'prices', 'performance promises'],
    visualGoal: slot?.visualGoal || 'Make the source block easier to scan and remember without changing its meaning.',
    tone: normalizeTone(slot?.tone),
    designFreedom: slot?.designFreedom || 'custom_composition',
  };
}

function normalizeTone(tone: unknown): NonNullable<InfographicSpec['visualSlot']>['tone'] {
  if (tone === 'product' || tone === 'analytical' || tone === 'explainer') return tone;
  return 'editorial';
}

function normalizeClaimIds(claimIds: string[] | undefined, sourceBlock: DraftBlock | undefined, knownClaimIds: Set<string>): string[] {
  const ids = claimIds && claimIds.length > 0 ? claimIds : sourceBlock?.sourceClaimIds || [];
  return [...new Set(ids.filter((claimId) => knownClaimIds.has(claimId)))];
}

function inferBlockType(kind: NonNullable<InfographicSpec['kind']>): InfographicSpec['blockType'] {
  if (kind === 'hero_compare') return 'comparison';
  if (kind === 'howto_steps') return 'steps';
  if (kind === 'decision_fork') return 'fork';
  if (kind === 'stats_strip') return 'stat';
  if (kind === 'visual_slot') return 'slot';
  return 'cards';
}

function pickSourceData(block: DraftBlock | undefined): Record<string, unknown> {
  if (!block) return {};
  return Object.fromEntries(['head', 'rows', 'columns', 'groups', 'items', 'stats', 'steps', 'options', 'neither'].filter((key) => block[key] !== undefined).map((key) => [key, block[key]]));
}

function isEmptyData(value: unknown): boolean {
  if (!value) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}
