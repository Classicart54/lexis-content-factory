import type { DraftBlock, DraftDoc, InfographicSpec, MaterialStructure, PipelineRequest } from './types.js';

export function assembleMaterial(request: PipelineRequest, structure: MaterialStructure, draft: DraftDoc, infographics: InfographicSpec[]): DraftDoc {
  const visualSlots = infographics.filter((spec) => spec.kind === 'visual_slot' && spec.status === 'derivable' && spec.visualSlot);
  const blocks: DraftBlock[] = [];

  for (const block of draft.blocks) {
    blocks.push(block);
    blocks.push(...visualSlots.filter((spec) => shouldInsertAfterBlock(spec, block)).map(makeVisualSlotBlock));
  }

  const beforeCtaIndex = blocks.findIndex((block) => block.type === 'cta');
  const beforeCtaSlots = visualSlots.filter((spec) => spec.visualSlot?.placement === 'before_cta').map(makeVisualSlotBlock);
  if (beforeCtaIndex >= 0) blocks.splice(beforeCtaIndex, 0, ...beforeCtaSlots);
  else blocks.push(...beforeCtaSlots);

  const afterLeadSlots = visualSlots.filter((spec) => spec.visualSlot?.placement === 'after_lead' && !blocks.some((block) => block.id === visualBlockId(spec))).map(makeVisualSlotBlock);
  const leadIndex = blocks.findIndex((block) => block.type === 'lead');
  if (leadIndex >= 0) blocks.splice(leadIndex + 1, 0, ...afterLeadSlots);
  else blocks.unshift(...afterLeadSlots);

  return {
    meta: {
      ...draft.meta,
      kind: structure.materialKind,
      cluster: request.brief.inputType === 'planned_topic' ? request.brief.cluster : undefined,
      assembledAt: new Date().toISOString(),
      visualSlots: visualSlots.length,
    },
    blocks: dedupeBlocks(blocks),
  };
}

function shouldInsertAfterBlock(spec: InfographicSpec, block: DraftBlock): boolean {
  return spec.visualSlot?.placement === 'after_block' && (spec.visualSlot.afterBlockId || spec.sourceBlockId) === block.id;
}

function makeVisualSlotBlock(spec: InfographicSpec): DraftBlock {
  return {
    id: visualBlockId(spec),
    type: 'visual_slot',
    title: spec.title,
    sourceBlockId: spec.sourceBlockId,
    sourceClaimIds: spec.sourceClaimIds,
    visualKind: spec.visualKind,
    visual: spec.visualKind,
    items: spec.items || visualItems(spec),
    sides: spec.sides,
    data: spec.data,
  };
}

function visualItems(spec: InfographicSpec): unknown[] | undefined {
  if (spec.items) return spec.items;
  if (spec.data && typeof spec.data === 'object' && Array.isArray((spec.data as { items?: unknown[] }).items)) return (spec.data as { items: unknown[] }).items;
  return undefined;
}

function visualBlockId(spec: InfographicSpec): string {
  return `block-${spec.id}`;
}

function dedupeBlocks(blocks: DraftBlock[]): DraftBlock[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    if (seen.has(block.id)) return false;
    seen.add(block.id);
    return true;
  });
}
