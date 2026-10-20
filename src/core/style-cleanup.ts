import type { DraftBlock, DraftDoc } from './types.js';

const SKIP_KEYS = new Set(['id', 'type', 'sourceClaimIds', 'url', 'href', 'snapshot', 'sourceId', 'sourceBlockId', 'renderMode', 'visualKind', 'blockType']);

export function cleanupDraftStyle(doc: DraftDoc): DraftDoc {
  return {
    ...doc,
    meta: { ...doc.meta },
    blocks: doc.blocks.map((block) => cleanupValue(block) as DraftBlock),
  };
}

function cleanupValue(value: unknown, key?: string): unknown {
  if (typeof value === 'string') return SKIP_KEYS.has(key || '') ? value : cleanupContrasts(value);
  if (Array.isArray(value)) return value.map((item) => cleanupValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, cleanupValue(childValue, childKey)]));
  }
  return value;
}

export function cleanupContrasts(text: string): string {
  return text
    .replace(/(^|[\s(«"„])не\s+только\s+([^.!?;:]{1,90}?)\s*,?\s+но\s+и\s+/giu, '$1$2 и ')
    .replace(/(^|[\s(«"„])не\s+просто\s+[^.!?;:]{1,90}?\s*,?\s+а\s+/giu, '$1')
    .replace(/(^|[\s(«"„])не\s+[^.!?;:]{1,90}?\s*,?\s+а\s+/giu, '$1');
}
