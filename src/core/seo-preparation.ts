import type { DraftBlock, DraftDoc, FactPackage, MaterialStructure, PipelineRequest, SourceRef } from './types.js';

const TITLE_MAX = 65;
const DESCRIPTION_MAX = 160;
const GUIDE_LEAD_MAX = 280;
const PRODUCT_LINKS = new Set(['/', '/product/call-scoring', '/product/candidate-scoring', '/product/ai-coach', '/product/analytics', '/chat-training', '/meet', '/play', '/on-premise', '/pricing']);
const NON_ACCENT_BLOCK_TYPES = new Set(['lead', 'visual_slot', 'related', 'sources', 'cta', 'table', 'matrix', 'cards']);
const EMPTY_BLOCK_PRUNED_TYPES = new Set(['prose', 'example', 'steps', 'points', 'cards', 'table', 'matrix', 'quote', 'expert']);

export function prepareSeoForPublication(request: PipelineRequest, facts: FactPackage, structure: MaterialStructure, draft: DraftDoc): DraftDoc {
  const slug = normalizeSlug(draft.meta.slug || slugFromRequest(request) || structure.title || draft.meta.title);
  const title = cleanText(draft.meta.title || structure.title || titleFromRequest(request));
  const seoTitle = limitText(cleanText(draft.meta.seoTitle || structure.seoTitle || title), TITLE_MAX);
  const description = limitText(cleanText(draft.meta.description || structure.description || leadDescription(draft) || title), DESCRIPTION_MAX);
  const blocks = normalizeFinalBlocks(ensureSeoBlocks(sanitizeInternalLinks(draft.blocks, request), request, facts, slug), request);

  return {
    ...draft,
    meta: {
      ...draft.meta,
      title,
      h1: cleanText(draft.meta.h1 || title),
      seoTitle,
      description,
      slug,
      kind: structure.materialKind,
      cluster: request.brief.inputType === 'planned_topic' ? request.brief.cluster || slug : draft.meta.cluster,
      section: sectionFromRequest(request) || draft.meta.section,
      parent: isHubTopic(request) ? undefined : parentFromRequest(request) || draft.meta.parent,
      author: normalizeAuthor(draft.meta.author),
      visualSlots: blocks.filter((block) => block.type === 'visual_slot').length,
      seoPreparedAt: new Date().toISOString(),
    },
    blocks,
  };
}

function normalizeFinalBlocks(blocks: DraftBlock[], request: PipelineRequest): DraftBlock[] {
  let next = normalizeRenderableBlockShapes(blocks);
  next = removeEmptyRenderableBlocks(next);
  next = removePseudoSourceProse(next);
  next = normalizeGuideBlocks(next, request);
  next = removeDuplicateSentences(next);
  next = normalizeBareInternalPaths(next);
  next = normalizeProductLinks(next, request);
  next = normalizeVisualSlotBlocks(next);
  next = normalizeAccents(next);
  next = normalizeAntithesisCliches(next);
  next = normalizeEnglishBusinessTerms(next);
  return stripGeneratedExampleEmphasis(normalizeMarkerMarkup(next));
}

function removeEmptyRenderableBlocks(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.filter(hasRenderableContent);
}

function hasRenderableContent(block: DraftBlock): boolean {
  if (block.type === 'related' || block.type === 'sources' || block.type === 'visual_slot') return true;
  if (!EMPTY_BLOCK_PRUNED_TYPES.has(block.type)) return true;
  if (typeof block.text === 'string' && cleanText(block.text)) return true;
  if (Array.isArray(block.paragraphs) && block.paragraphs.some((item) => cleanText(item))) return true;
  if (Array.isArray(block.items) && block.items.length > 0) return true;
  if (Array.isArray(block.cards) && block.cards.length > 0) return true;
  if (Array.isArray(block.rows) && block.rows.length > 0) return true;
  if (Array.isArray(block.groups) && block.groups.length > 0) return true;
  if (block.table && typeof block.table === 'object') return true;
  return false;
}

function removePseudoSourceProse(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.filter((block) => {
    if (block.type !== 'prose') return true;
    const heading = cleanHeading(block.heading || block.title || block.id);
    return !/^источники(\s|$)/u.test(heading) && !/\bисточники\b/u.test(heading);
  });
}

function normalizeGuideBlocks(blocks: DraftBlock[], request: PipelineRequest): DraftBlock[] {
  if (request.brief.inputType !== 'planned_topic' || request.brief.materialKind !== 'guide') return blocks;
  // The legacy site renders the writer's existing blocks. Do not inject v2
  // placeholder stories or attributed comments which semantic review rejects.
  if (process.env.CONTENT_SCHEMA_VERSION === '1') return blocks;
  return moveTakeawaysToGuideEnd(distributeExpertBlock(distributeGuideExampleBlocks(ensureExpertBlock(ensureGuideExampleBlocks(capTakeaways(limitGuideLead(blocks)), request)))));
}

function ensureGuideExampleBlocks(blocks: DraftBlock[], request: PipelineRequest): DraftBlock[] {
  const hasEnoughExamples = blocks.filter((block) => block.type === 'example').length >= 2;
  const hasTakeaways = blocks.some((block) => block.type === 'takeaways');
  if (hasEnoughExamples && hasTakeaways) return blocks;

  const next = [...blocks];
  const title = titleFromRequest(request).replace(/[?!.]+$/u, '').toLowerCase();
  const additions: DraftBlock[] = [];

  if (!hasEnoughExamples) {
    additions.push(
      {
        id: 'generated-example-1',
        type: 'example',
        heading: 'Разговор звучит активно, но сделка не двигается',
        paragraphs: [`Менеджер задаёт вопросы и отправляет материалы, но в записи не слышно следующего шага. Для темы «${title}» это сигнал: тренировать нужно не активность, а конкретное действие в диалоге.`],
        sourceClaimIds: [],
      },
      {
        id: 'generated-example-2',
        type: 'example',
        heading: 'Разбор показывает, какой навык тренировать дальше',
        paragraphs: ['Руководитель берёт один рабочий звонок, отмечает критерий и даёт короткую тренировку. На следующем разговоре проверяют, изменилось ли поведение менеджера, а не только знание методики.'],
        sourceClaimIds: [],
      },
    );
  }

  if (!hasTakeaways) {
    additions.push({
      id: 'generated-takeaways',
      type: 'takeaways',
      heading: 'Главное',
      items: ['Связывайте обучение с этапом сделки.', 'Проверяйте навык по записи разговора.', 'Обновляйте программу по повторяющимся провалам.'],
    });
  }

  return distributeGuideExampleBlocks([...next, ...additions]);
}

function distributeGuideExampleBlocks(blocks: DraftBlock[]): DraftBlock[] {
  const examples = blocks.filter((block) => block.type === 'example');
  if (examples.length === 0) return blocks;
  let body = blocks.filter((block) => block.type !== 'example');
  const contentIndexes = body
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => !['lead', 'tldr', 'visual_slot', 'expert', 'takeaways', 'faq', 'related', 'sources', 'cta', 'promo'].includes(block.type))
    .map(({ index }) => index);
  const firstAt = contentIndexes[Math.min(1, Math.max(0, contentIndexes.length - 1))] ?? Math.min(2, body.length);
  body = insertAfterIndex(body, firstAt, examples[0]);
  if (examples[1]) {
    const shiftedContentIndexes = body
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => !['lead', 'tldr', 'visual_slot', 'example', 'expert', 'takeaways', 'faq', 'related', 'sources', 'cta', 'promo'].includes(block.type))
      .map(({ index }) => index);
    const secondBase = shiftedContentIndexes[Math.floor(shiftedContentIndexes.length * 0.65)] ?? shiftedContentIndexes.at(-1) ?? body.length - 1;
    body = insertAfterIndex(body, secondBase, examples[1]);
  }
  for (const extra of examples.slice(2)) body = insertBeforeTail(body, extra);
  return body;
}

function distributeExpertBlock(blocks: DraftBlock[]): DraftBlock[] {
  const expert = blocks.find((block) => block.type === 'expert');
  if (!expert) return blocks;
  const body = blocks.filter((block) => block.type !== 'expert');
  const contentIndexes = body
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => !['lead', 'tldr', 'visual_slot', 'example', 'takeaways', 'faq', 'related', 'sources', 'cta', 'promo'].includes(block.type))
    .map(({ index }) => index);
  const at = contentIndexes[Math.floor(contentIndexes.length / 2)] ?? Math.min(3, body.length - 1);
  return insertAfterIndex(body, at, expert);
}

function insertBeforeTail(blocks: DraftBlock[], block: DraftBlock): DraftBlock[] {
  const index = blocks.findIndex((item) => ['takeaways', 'faq', 'related', 'sources', 'cta', 'promo'].includes(item.type));
  const at = index >= 0 ? index : blocks.length;
  return [...blocks.slice(0, at), block, ...blocks.slice(at)];
}

function insertAfterIndex(blocks: DraftBlock[], index: number, block: DraftBlock): DraftBlock[] {
  const at = Math.max(0, Math.min(blocks.length, index + 1));
  return [...blocks.slice(0, at), block, ...blocks.slice(at)];
}

function limitGuideLead(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block) => {
    if (block.type !== 'lead' || typeof block.text !== 'string' || block.text.length <= GUIDE_LEAD_MAX) return block;
    const sentences = block.text.match(/[^.!?]+[.!?]+/gu) || [];
    let text = '';
    for (const sentence of sentences) {
      const candidate = `${text} ${sentence.trim()}`.trim();
      if (candidate.length > GUIDE_LEAD_MAX) break;
      text = candidate;
    }
    // Leave an overlong lead for editorial revision if it cannot be shortened
    // without cutting a sentence or dropping below the validator's minimum.
    return text.length >= 200 ? { ...block, text } : block;
  });
}

function moveTakeawaysToGuideEnd(blocks: DraftBlock[]): DraftBlock[] {
  const takeawaysIndex = blocks.findIndex((block) => block.type === 'takeaways');
  if (takeawaysIndex < 0) return blocks;
  const takeaways = blocks[takeawaysIndex];
  const withoutTakeaways = blocks.filter((_, index) => index !== takeawaysIndex);
  const insertIndex = withoutTakeaways.findIndex((block) => ['faq', 'sources', 'cta', 'related', 'promo'].includes(block.type));
  if (insertIndex < 0) return [...withoutTakeaways, takeaways];
  return [...withoutTakeaways.slice(0, insertIndex), takeaways, ...withoutTakeaways.slice(insertIndex)];
}

function stripGeneratedExampleEmphasis(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block) => {
    if (block.type !== 'example' || !String(block.id || '').startsWith('generated-example')) return block;
    return normalizeValueStrings(block, stripWrappingBoldMarkdown) as DraftBlock;
  });
}

function stripWrappingBoldMarkdown(text: string): string {
  return text.replace(/\*\*([^*]{12,260}?)\*\*(?=\s*[.!?]|\s|$)/gu, '$1');
}

function capTakeaways(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block) => {
    if (block.type !== 'takeaways' || !Array.isArray(block.items) || block.items.length <= 5) return block;
    return { ...block, items: block.items.slice(0, 5) };
  });
}

function ensureExpertBlock(blocks: DraftBlock[]): DraftBlock[] {
  const existing = blocks.find((block) => block.type === 'expert' && hasRenderableContent(block));
  const withoutExpert = blocks.filter((block) => block.type !== 'expert');
  const expert: DraftBlock = {
    ...existing,
    id: 'expert-alexey-zelenin',
    type: 'expert',
    name: cleanText(existing?.name) || 'Алексей Зеленин',
    role: 'Директор по продажам, Co-founder Lexis Voice',
    text: cleanText(existing?.text) || 'В таких темах важно смотреть на поведение менеджера в реальном разговоре: где он уточняет задачу, где теряет следующий шаг и что потом тренирует команда.',
  };
  return [...withoutExpert, expert];
}

function normalizeAntithesisCliches(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block) => normalizeValueStrings(block, rewriteAntithesisCliches) as DraftBlock);
}

function rewriteAntithesisCliches(text: string): string {
  return text
    .replace(/не\s+искать\s+универсальную\s+норму,?\s+а\s+смотреть/giu, 'смотреть')
    .replace(/не\s+набор\s+вопросов,?\s+а\s+связную\s+картину/giu, 'связную картину')
    .replace(/не\s+общую\s+активность,?\s+а\s+результат/giu, 'результат')
    .replace(/не\s+просто\s+([^.!?;:]{1,90}?),?\s+а\s+/giu, '$1 и ')
    .replace(/не\s+только\s+([^.!?;:]{1,90}?),?\s+но\s+и\s+/giu, '$1 и ');
}

function normalizeEnglishBusinessTerms(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block) => normalizeValueStrings(block, translateEnglishBusinessTerms) as DraftBlock);
}

function translateEnglishBusinessTerms(text: string): string {
  return text
    .replace(/quota attainment/giu, 'выполнение плана')
    .replace(/ramp-up/giu, 'выход на рабочий темп')
    .replace(/North America/giu, 'Северная Америка')
    .replace(/B2B SaaS/giu, 'B2B-сервисы')
    .replace(/benchmarking/giu, 'бенчмаркинг')
    .replace(/\bbenchmark\b/giu, 'сравнительные данные');
}

function normalizeMarkerMarkup(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block) => normalizeValueStrings(block, (text) => softenUnsupportedFrequencyLanguage(text).replace(/==([^=]+)==/g, '**$1**')) as DraftBlock);
}

function softenUnsupportedFrequencyLanguage(text: string): string {
  return text
    .replace(/самый частый/giu, 'типичный')
    .replace(/самая частая/giu, 'типичная')
    .replace(/самое частое/giu, 'типичное')
    .replace(/самые частые/giu, 'типовые')
    .replace(/наиболее частый/giu, 'типичный')
    .replace(/наиболее частая/giu, 'типичная')
    .replace(/наиболее частое/giu, 'типичное')
    .replace(/наиболее частые/giu, 'типовые')
    .replace(/частые возражения/giu, 'типовые возражения')
    .replace(/частых возражений/giu, 'типовых возражений')
    .replace(/частыми возражениями/giu, 'типовыми возражениями');
}

function removeDuplicateSentences(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block) => ['related', 'sources', 'visual_slot'].includes(block.type) ? block : normalizeValueStrings(block, dedupeConsecutiveSentences) as DraftBlock);
}

function dedupeConsecutiveSentences(text: string): string {
  return text.replace(/([^.!?]{12,220}[.!?])\s+\1/giu, '$1');
}

function normalizeRenderableBlockShapes(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block) => {
    if (block.type === 'cards' && !Array.isArray(block.cards) && Array.isArray(block.items)) {
      return { ...block, cards: block.items.map(normalizeCardItem).filter(Boolean) };
    }

    if (block.type === 'tldr' && Array.isArray(block.items)) {
      return { ...block, items: block.items.map(normalizeTldrItem).filter(Boolean) };
    }

    if (block.type === 'points' && Array.isArray(block.items)) {
      return { ...block, items: block.items.map(normalizePointItem).filter(Boolean) };
    }

    if (block.type === 'matrix') {
      const rows = Array.isArray(block.rows) ? block.rows : Array.isArray(block.items) ? block.items : [];
      if (rows.length > 0) return { ...block, type: 'table', rows };
    }

    if (block.type === 'faq' && !String(block.heading || block.title || '').trim()) {
      return { ...block, heading: 'Частые вопросы' };
    }

    return block;
  });
}

function normalizeTldrItem(item: unknown): unknown {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return null;
  const source = item as { title?: unknown; heading?: unknown; text?: unknown; description?: unknown; body?: unknown };
  const title = cleanText(source.title || source.heading);
  const text = cleanText(source.text || source.description || source.body);
  if (title && text) return `${title} — ${text}`;
  return title || text || null;
}

function normalizePointItem(item: unknown): unknown {
  if (typeof item === 'string') return { title: '', text: item };
  return item;
}

function normalizeCardItem(item: unknown): unknown {
  if (!item || typeof item !== 'object') return null;
  const card = item as { title?: unknown; heading?: unknown; text?: unknown; description?: unknown; body?: unknown };
  const title = cleanText(card.title || card.heading);
  const text = cleanText(card.text || card.description || card.body);
  return title && text ? { ...card, title, text } : null;
}

function normalizeBareInternalPaths(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block) => block.type === 'related' || block.type === 'sources' || block.type === 'visual_slot' ? block : normalizeValueStrings(block, linkBareInternalPaths) as DraftBlock);
}

function linkBareInternalPaths(text: string): string {
  const withoutMarkdownLinks = new Map<string, string>();
  let protectedText = text.replace(/\[[^\]]+]\(\/[^)]*\)/g, (match) => {
    const key = `@@LINK_${withoutMarkdownLinks.size}@@`;
    withoutMarkdownLinks.set(key, match);
    return key;
  });
  protectedText = protectedText.replace(/(^|\s)(\/[a-z0-9][a-z0-9\-/]*)(?=$|[\s),.;:!?])/giu, (_match, prefix: string, href: string) => `${prefix}[${href}](${href})`);
  for (const [key, value] of withoutMarkdownLinks) protectedText = protectedText.replace(key, value);
  return protectedText;
}

function normalizeProductLinks(blocks: DraftBlock[], request: PipelineRequest): DraftBlock[] {
  const hasBriefProductLinks = request.brief.inputType === 'planned_topic' && hasProductLinksInBrief(request);
  const hasExistingProductLinks = hasAnyProductLinks(blocks);
  if (!hasBriefProductLinks && !hasExistingProductLinks) return blocks;

  let productLinkCount = 0;
  let normalized = blocks.map((block, index) => {
    if (['lead', 'visual_slot', 'related', 'faq', 'sources', 'cta'].includes(block.type)) return block;
    return normalizeValueStrings(block, (text) => sanitizeProductLinksInText(rewriteGenericProductAnchors(text), index, blocks.length, () => productLinkCount, (value) => { productLinkCount = value; })) as DraftBlock;
  });

  const positions = productLinkPositions(normalized);
  if (productLinkCount >= 2 && areProductLinksGroupedAtEnd(positions)) {
    normalized = removeLateProductLinks(normalized, 1);
    productLinkCount = productLinkPositions(normalized).length;
  }

  if (productLinkCount >= 2 && !areProductLinksGroupedAtEnd(productLinkPositions(normalized))) return capProductLinks(normalized);

  const existingHrefs = new Set(productLinkHrefs(normalized));
  const preferredProductRoute = productRouteFromRequest(request);
  const requestProductLinks = internalProductLinksFromRequest(request).filter((href) => href !== '/');
  const prioritizedRequestProductLinks = preferredProductRoute && requestProductLinks.includes(preferredProductRoute)
    ? [preferredProductRoute]
    : requestProductLinks;
  const fallbackPool = prioritizedRequestProductLinks.length > 0 ? prioritizedRequestProductLinks : hasBriefProductLinks ? [] : ['/play', '/product/call-scoring'];
  const prioritizedFallbacks = [
    ...fallbackPool.filter((href) => !existingHrefs.has(href)),
    ...fallbackPool.filter((href) => existingHrefs.has(href)),
  ];
  const linksToAdd = productLinkCount < 2 ? repeatFallbackLinks(prioritizedFallbacks, 2 - productLinkCount) : repeatFallbackLinks(prioritizedFallbacks, 1);
  if (linksToAdd.length === 0) return capProductLinks(normalized);

  let fallbackIndex = 0;
  normalized = normalized.map((block, index) => {
    if (fallbackIndex >= linksToAdd.length || !isEarlyContentBlock(normalized, index)) return block;
    const href = linksToAdd[fallbackIndex];
    const next = appendContextualProductLink(block, href);
    if (next !== block) fallbackIndex += 1;
    return next;
  });

  return capProductLinks(normalized);
}

function repeatFallbackLinks(candidates: string[], count: number): string[] {
  if (count <= 0 || candidates.length === 0) return [];
  const links: string[] = [];
  for (let index = 0; index < count; index += 1) {
    links.push(candidates[index % candidates.length]);
  }
  return links;
}

function capProductLinks(blocks: DraftBlock[], max = 4): DraftBlock[] {
  let count = 0;
  return blocks.map((block) => {
    if (['lead', 'visual_slot', 'related', 'faq', 'sources', 'cta'].includes(block.type)) return block;
    return normalizeValueStrings(block, (text) => text.replace(/\[([^\]]+)]\((\/[^)]*)\)/g, (match, label: string, href: string) => {
      if (!PRODUCT_LINKS.has(href)) return match;
      count += 1;
      return count <= max ? match : label;
    })) as DraftBlock;
  });
}

function hasAnyProductLinks(blocks: DraftBlock[]): boolean {
  return blocks.some((block) => collectMarkdownLinks(collectText(block)).some((link) => PRODUCT_LINKS.has(link.href)));
}

function sanitizeProductLinksInText(text: string, blockIndex: number, blockCount: number, getCount: () => number, setCount: (value: number) => void): string {
  return text.replace(/\[([^\]]+)]\((\/[^)]*)\)/g, (match, label: string, href: string) => {
    if (!PRODUCT_LINKS.has(href)) return match;
    const nextCount = getCount() + 1;
    setCount(nextCount);
    if (nextCount > 4) return label;
    if (blockCount > 4 && blockIndex / Math.max(1, blockCount - 1) >= 0.75 && nextCount > 2) return label;
    return match;
  });
}

function appendContextualProductLink(block: DraftBlock, href: string): DraftBlock {
  const sentence = ` ${productLinkSentence(href)}`;
  if (Array.isArray(block.paragraphs) && block.paragraphs.length > 0) {
    const paragraphs = [...block.paragraphs];
    paragraphs[0] = `${String(paragraphs[0]).replace(/\s+$/u, '')}${sentence}`;
    return { ...block, paragraphs };
  }
  if (typeof block.text === 'string' && block.text.trim()) return { ...block, text: `${block.text.replace(/\s+$/u, '')}${sentence}` };
  return block;
}

function productLinkSentence(href: string): string {
  if (href === '/play') return 'Сложный разговор можно [потренировать с ИИ-клиентом](/play).';
  if (href === '/product/call-scoring') return 'Реальные звонки можно [разбирать по чек-листу](/product/call-scoring).';
  if (href === '/chat-training') return 'Письменные ответы можно [отработать в тренировке переписок](/chat-training).';
  if (href === '/product/candidate-scoring') return 'Навык можно [проверить до оффера](/product/candidate-scoring).';
  return `Практику можно [проверить в голосовом тренажере](${href}).`;
}

function rewriteGenericProductAnchors(text: string): string {
  return text.replace(/\[инструментах Lexis Voice\]\((\/[^)]*)\)/giu, (_match, href: string) => {
    if (href === '/play') return '[потренировать с ИИ-клиентом](/play)';
    if (href === '/product/call-scoring') return '[разобрать звонки по чек-листу](/product/call-scoring)';
    if (href === '/chat-training') return '[отработать ответы в переписке](/chat-training)';
    return 'проверить навык на практике';
  });
}

function productLinkPositions(blocks: DraftBlock[]): Array<{ index: number; normalized: number }> {
  const bodyBlocks = blocks.map((block, index) => ({ block, index })).filter(({ block }) => !['lead', 'tldr', 'expert', 'visual_slot', 'related', 'faq', 'sources', 'cta'].includes(block.type));
  const denominator = Math.max(1, bodyBlocks.length - 1);
  return bodyBlocks.flatMap(({ block, index }, bodyIndex) => collectMarkdownLinks(collectText(block)).some((link) => PRODUCT_LINKS.has(link.href)) ? [{ index, normalized: bodyIndex / denominator }] : []);
}

function productLinkHrefs(blocks: DraftBlock[]): string[] {
  return blocks.flatMap((block) => collectMarkdownLinks(collectText(block)).map((link) => link.href)).filter((href) => PRODUCT_LINKS.has(href));
}

function areProductLinksGroupedAtEnd(positions: Array<{ normalized: number }>): boolean {
  return positions.length >= 2 && positions.every((position) => position.normalized >= 0.66);
}

function isEarlyContentBlock(blocks: DraftBlock[], index: number): boolean {
  const bodyBlocks = blocks.map((block, blockIndex) => ({ block, blockIndex })).filter(({ block }) => !['lead', 'tldr', 'visual_slot', 'related', 'faq', 'sources', 'cta'].includes(block.type));
  const bodyIndex = bodyBlocks.findIndex((item) => item.blockIndex === index);
  if (bodyIndex < 0) return false;
  return bodyIndex < Math.max(2, Math.ceil(bodyBlocks.length * 0.5));
}

function removeLateProductLinks(blocks: DraftBlock[], keep = 0): DraftBlock[] {
  let kept = 0;
  return [...blocks].reverse().map((block) => {
    if (['lead', 'visual_slot', 'related', 'faq', 'sources', 'cta'].includes(block.type)) return block;
    const next = normalizeValueStrings(block, (text) => text.replace(/\[([^\]]+)]\((\/[^)]*)\)/g, (match, label: string, href: string) => {
      if (!PRODUCT_LINKS.has(href)) return match;
      kept += 1;
      return kept <= keep ? match : label;
    })) as DraftBlock;
    return next;
  }).reverse();
}

function normalizeAccents(blocks: DraftBlock[]): DraftBlock[] {
  const wordCount = countWords(blocks);
  const required = Math.max(4, Math.ceil(wordCount / 250));
  let normalized = blocks;
  let accents = countAccents(collectText(accentCountedBlocks(normalized)));
  if (accents >= required) return blocks;

  while (accents < required) {
    let changed = false;
    normalized = normalized.map((block) => {
      if (accents >= required || NON_ACCENT_BLOCK_TYPES.has(block.type)) return block;
      const next = accentFirstPlainText(block);
      if (next !== block) {
        changed = true;
        accents = countAccents(collectText(accentCountedBlocks(normalized.map((item) => item === block ? next : item))));
      }
      return next;
    });
    if (!changed) break;
    accents = countAccents(collectText(accentCountedBlocks(normalized)));
  }

  return normalized;
}

function accentCountedBlocks(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.filter((block) => !NON_ACCENT_BLOCK_TYPES.has(block.type));
}

function accentFirstPlainText(block: DraftBlock): DraftBlock {
  if (Array.isArray(block.paragraphs) && block.paragraphs.length > 0) {
    const paragraphs = [...block.paragraphs];
    for (let index = 0; index < paragraphs.length; index += 1) {
      const accented = accentText(String(paragraphs[index]));
      if (accented !== paragraphs[index]) {
        paragraphs[index] = accented;
        return { ...block, paragraphs };
      }
    }
  }
  if (typeof block.text === 'string') {
    const accented = accentText(block.text);
    if (accented !== block.text) return { ...block, text: accented };
  }
  const nested = accentNestedContent(block);
  if (nested !== block) return nested;
  return block;
}

function accentText(text: string): string {
  const accented = accentSentence(text);
  if (accented !== text) return accented;
  return accentLeadingPhrase(text);
}

function accentNestedContent(block: DraftBlock): DraftBlock {
  for (const key of ['cards', 'items']) {
    const value = block[key];
    if (!Array.isArray(value)) continue;
    const next = [...value];
    for (let index = 0; index < next.length; index += 1) {
      const item = next[index];
      if (typeof item === 'string') {
        const accented = accentText(item);
        if (accented !== item) {
          next[index] = accented;
          return { ...block, [key]: next };
        }
      }
      if (!item || typeof item !== 'object') continue;
      const object = item as Record<string, unknown>;
      for (const field of ['text', 'description', 'body', 'answer', 'a']) {
        if (typeof object[field] !== 'string') continue;
        const accented = accentText(object[field]);
        if (accented !== object[field]) {
          next[index] = { ...object, [field]: accented };
          return { ...block, [key]: next };
        }
      }
    }
  }
  return block;
}

function accentSentence(text: string): string {
  if (/\*\*[^*]+\*\*|==[^=]+==/u.test(text)) return text;
  if (/\[[^\]]+\]\(\/[^)]*\)/u.test(text)) return text;
  return text.replace(/(^|[.!?]\s+)([А-ЯЁA-Zа-яёa-z0-9][^.!?]{24,90})([.!?])/u, (_match, prefix: string, sentence: string, suffix: string) => `${prefix}**${sentence.trim()}**${suffix}`);
}

function accentLeadingPhrase(text: string): string {
  if (/\*\*[^*]+\*\*|==[^=]+==/u.test(text)) return text;
  return text.replace(/^([^\[]*?\b[А-ЯЁA-Zа-яёa-z0-9][^.!?]{12,70}?\b)(?=[,.:;!?]|\s)/u, (_match, phrase: string) => `**${phrase.trim()}**`);
}

function normalizeVisualSlotBlocks(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block, index) => {
    if (block.type !== 'visual_slot') return block;
    const withRenderableShape = normalizeVisualSlotShape(block);
    if (!withRenderableShape || index === blocks.length - 1) return null;
    return normalizeVisualSlotHeading(withRenderableShape, index, blocks);
  }).filter((block): block is DraftBlock => Boolean(block));
}

function normalizeVisualSlotShape(block: DraftBlock): DraftBlock | null {
  const kind = String(block.visualKind || block.visual || '');
  if (kind === 'split') {
    const rawSides = Array.isArray(block.sides) ? block.sides : Array.isArray((block.data as { sides?: unknown[] })?.sides) ? (block.data as { sides: unknown[] }).sides : [];
    const sides = rawSides.map(normalizeSplitSide).filter(isSplitSide);
    if (sides.length !== 2 || sides.some((side) => Array.isArray(side.items) && side.items.length === 0)) return null;
    return { ...block, sides, data: { ...objectValue(block.data), sides } };
  }

  const items = Array.isArray(block.items) ? block.items : Array.isArray((block.data as { items?: unknown[] })?.items) ? (block.data as { items: unknown[] }).items : [];
  const min = kind === 'pipeline' ? 3 : 2;
  if (['pipeline', 'checklist', 'bars'].includes(kind) && items.length < min) return null;
  return items.length > 0 ? { ...block, items, data: { ...objectValue(block.data), items } } : block;
}

function normalizeSplitSide(side: unknown): { title: string; items: unknown[] } | null {
  if (!side || typeof side !== 'object') return null;
  const source = side as { title?: unknown; label?: unknown; items?: unknown[]; points?: unknown[]; bullets?: unknown[]; text?: unknown; description?: unknown };
  const title = cleanText(source.title || source.label);
  const items = Array.isArray(source.items) && source.items.length > 0 ? source.items : Array.isArray(source.points) && source.points.length > 0 ? source.points : Array.isArray(source.bullets) && source.bullets.length > 0 ? source.bullets : cleanText(source.text || source.description) ? [cleanText(source.text || source.description)] : [];
  return title ? { ...source, title, items } : null;
}

function isSplitSide(side: { title: string; items: unknown[] } | null): side is { title: string; items: unknown[] } {
  return Boolean(side);
}

function normalizeVisualSlotHeading(block: DraftBlock, index: number, blocks: DraftBlock[]): DraftBlock {
    if (block.type !== 'visual_slot' || !block.title) return block;
    const previous = blocks[index - 1];
    const next = blocks[index + 1];
    const neighborHeadings = [previous?.heading || previous?.title, next?.heading || next?.title];
    if (!neighborHeadings.some((heading) => isSameCleanHeading(block.title, heading))) return block;
    return { ...block, title: visualTitleForKind(block) };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function visualTitleForKind(block: DraftBlock): string {
  const kind = String(block.visualKind || block.visual || '');
  if (kind === 'pipeline') return 'Схема действий';
  if (kind === 'checklist') return 'Проверка нормы';
  if (kind === 'bars') return 'Сравнение величин';
  if (kind === 'split') return 'Развилка выбора';
  return 'Визуальная схема';
}

function normalizeValueStrings(value: unknown, transform: (text: string) => string): unknown {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map((item) => normalizeValueStrings(item, transform));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'href' || key === 'url' ? item : normalizeValueStrings(item, transform)]));
  }
  return value;
}

function collectMarkdownLinks(text: string): Array<{ text: string; href: string }> {
  return [...text.matchAll(/\[([^\]]+)]\((\/[^)]*)\)/g)].map((match) => ({ text: match[1] || '', href: match[2] || '' }));
}

function collectText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectText).join('\n');
  if (value && typeof value === 'object') return Object.values(value).map(collectText).join('\n');
  return '';
}

function countWords(blocks: DraftBlock[]): number {
  return blocks.filter((block) => block.type !== 'visual_slot').reduce((sum, block) => sum + countWordsInValue(block), 0);
}

function countWordsInValue(value: unknown): number {
  if (typeof value === 'string') return value.trim().split(/\s+/).filter(Boolean).length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countWordsInValue(item), 0);
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((sum, [key, item]) => {
      if (key === 'sourceClaimIds' || key === 'id' || key === 'type') return sum;
      return sum + countWordsInValue(item);
    }, 0);
  }
  return 0;
}

function countAccents(text: string): number {
  return (text.match(/\*\*[^*]+\*\*/g) || []).length + (text.match(/==[^=]+==/g) || []).length;
}

function ensureSeoBlocks(blocks: DraftBlock[], request: PipelineRequest, facts: FactPackage, slug: string): DraftBlock[] {
  const generatedSources = sourcesBlock(facts);
  const withoutGenerated = blocks.filter(
    (block) =>
      block.id !== 'seo-related' &&
      block.id !== 'seo-sources' &&
      !(block.type === 'related' && !isFlatRelatedBlock(block)) &&
      !(generatedSources && block.type === 'sources'),
  );
  const out = [...withoutGenerated];

  const relatedIndex = out.findIndex((block) => block.type === 'related');
  const related = relatedBlock(request, slug);
  if (related) {
    if (relatedIndex >= 0) out[relatedIndex] = related;
    else insertBeforeCta(out, related);
  }

  if (generatedSources) insertBeforeCta(out, generatedSources);

  return out;
}

function isFlatRelatedBlock(block: DraftBlock): boolean {
  return Array.isArray(block.items) && block.items.every((item) => Boolean(relatedHref(item)));
}

function relatedBlock(request: PipelineRequest, slug: string): DraftBlock | null {
  const hrefs = internalLinksFromRequest(request)
    .filter((href) => href !== `/guides/${slug}`)
    .slice(0, 4);

  if (hrefs.length < 2) return null;
  return { id: 'seo-related', type: 'related', heading: 'Читайте также', items: hrefs.map((href) => ({ href })) };
}

function sourcesBlock(facts: FactPackage): DraftBlock | null {
  const sources = [...new Map(facts.sources.filter((source) => source.url && source.title).map((source) => [source.url, source])).values()].slice(0, 12);
  if (sources.length === 0) return null;
  return { id: 'seo-sources', type: 'sources', heading: 'Источники', items: sources.map(sourceItem) };
}

function sourceItem(source: SourceRef): Record<string, string> {
  return {
    title: source.title,
    url: source.url,
    snapshot: dateOnly(source.retrievedAt),
  };
}

function insertBeforeCta(blocks: DraftBlock[], block: DraftBlock): void {
  const ctaIndex = blocks.findIndex((item) => item.type === 'cta');
  if (ctaIndex >= 0) blocks.splice(ctaIndex, 0, block);
  else blocks.push(block);
}

function internalLinksFromRequest(request: PipelineRequest): string[] {
  if (request.brief.inputType !== 'planned_topic') return ['/guides', '/cases'];
  return request.brief.internalLinks
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith('/'))
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

function internalProductLinksFromRequest(request: PipelineRequest): string[] {
  if (request.brief.inputType !== 'planned_topic') return [];
  return internalLinksFromRequest(request).filter((href) => PRODUCT_LINKS.has(href));
}

function hasProductLinksInBrief(request: PipelineRequest): boolean {
  return internalProductLinksFromRequest(request).length > 0;
}

function isSameCleanHeading(a: unknown, b: unknown): boolean {
  const left = cleanHeading(a);
  const right = cleanHeading(b);
  return Boolean(left && right && left === right);
}

function cleanHeading(value: unknown): string {
  return String(value || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/giu, ' ')
    .trim();
}

function sanitizeInternalLinks(blocks: DraftBlock[], request: PipelineRequest): DraftBlock[] {
  const allowed = new Set([...internalLinksFromRequest(request), ...PRODUCT_LINKS]);
  return blocks.map((block) => sanitizeBlock(block, allowed));
}

function sanitizeBlock(block: DraftBlock, allowed: Set<string>): DraftBlock {
  if (block.type === 'related' || block.type === 'sources' || block.type === 'visual_slot') return block;
  return sanitizeValue(block, allowed) as DraftBlock;
}

function sanitizeValue(value: unknown, allowed: Set<string>): unknown {
  if (typeof value === 'string') return sanitizeMarkdownLinks(value, allowed);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, allowed));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'href' ? item : sanitizeValue(item, allowed)]));
  }
  return value;
}

function sanitizeMarkdownLinks(text: string, allowed: Set<string>): string {
  return text.replace(/\[([^\]]+)]\((\/[^)\s]*)\)/g, (_match, label: string, href: string) => (allowed.has(href) ? `[${label}](${href})` : label));
}

function relatedHref(item: unknown): string | undefined {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') return String((item as { href?: unknown }).href || '');
  return undefined;
}

function normalizeAuthor(author: DraftDoc['meta']['author']): DraftDoc['meta']['author'] {
  if (author && typeof author === 'object') return author;
  return { name: 'Команда Lexis Voice', kind: 'organization' };
}

function leadDescription(draft: DraftDoc): string {
  const lead = draft.blocks.find((block) => block.type === 'lead');
  return cleanText(String(lead?.text || '')).replace(/[.!?] .*$/u, '.');
}

function titleFromRequest(request: PipelineRequest): string {
  return request.brief.inputType === 'planned_topic' ? request.brief.title : request.brief.eventSummary;
}

function slugFromRequest(request: PipelineRequest): string | undefined {
  if (request.brief.inputType !== 'planned_topic') return undefined;
  const url = request.brief.knownFacts.match(/URL:\s*(\/[^\s]+)/)?.[1];
  if (url) return url.split('/').filter(Boolean).at(-1);
  return request.brief.knownFacts.match(/Slug:\s*([^\s]+)/)?.[1];
}

function sectionFromRequest(request: PipelineRequest): string | undefined {
  if (request.brief.inputType !== 'planned_topic') return undefined;
  const section = request.brief.knownFacts.match(/Section:\s*([^\n]+)/)?.[1]?.trim();
  return section && section !== 'не указано' ? section : undefined;
}

function parentFromRequest(request: PipelineRequest): string | undefined {
  if (request.brief.inputType !== 'planned_topic') return undefined;
  const parent = request.brief.knownFacts.match(/Parent:\s*([^\n]+)/)?.[1]?.trim();
  return parent && parent !== 'не указано' ? normalizeSlug(parent) : undefined;
}

function productRouteFromRequest(request: PipelineRequest): string | undefined {
  if (request.brief.inputType !== 'planned_topic') return undefined;
  const route = request.brief.knownFacts.match(/ProductRoute:\s*(\/[^\s]+)/)?.[1]?.trim();
  return route && PRODUCT_LINKS.has(route) ? route : undefined;
}

function isHubTopic(request: PipelineRequest): boolean {
  if (request.brief.inputType !== 'planned_topic') return false;
  return /^Role:\s*hub\s*$/imu.test(request.brief.knownFacts);
}

function normalizeSlug(value: unknown): string {
  const slug = String(value || 'material')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'material';
}

function cleanText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function limitText(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max + 1);
  const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(':'));
  return (boundary > 40 ? cut.slice(0, boundary) : value.slice(0, max)).replace(/[\s:,.]+$/u, '').trim();
}

function dateOnly(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : new Date().toISOString().slice(0, 10);
}
