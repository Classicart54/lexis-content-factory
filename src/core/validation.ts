import type { DraftBlock, DraftDoc, FactPackage, MaterialStructure, PipelineRequest, ValidationIssue, ValidationReport } from './types.js';

const MIN_WORDS = 1200;
const MAX_WORDS = 2000;
const MIN_FAQ_ITEMS = 8;
const MIN_ACCENTS = 4;
const WORDS_PER_ACCENT = 250;
const MAX_CONTENT_SECTIONS = 8;
const MAX_NOT_X_BUT_Y_IN_BODY = 2;
const PRODUCT_LINKS = new Set(['/', '/product/call-scoring', '/product/candidate-scoring', '/product/ai-coach', '/product/analytics', '/chat-training', '/meet', '/play', '/on-premise', '/pricing']);
const CONTENT_SECTION_TYPES = new Set(['tldr', 'prose', 'points', 'steps', 'table', 'stats', 'matrix', 'cards', 'fork', 'verdict', 'quote', 'callout']);
const VISUAL_SLOT_KINDS = new Set(['pipeline', 'checklist', 'bars', 'split']);

export function validateMaterial(request: PipelineRequest, facts: FactPackage, structure: MaterialStructure, draft: DraftDoc): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (!facts.topicOccupied && request.brief.inputType === 'planned_topic') {
    issues.push({ code: 'topic_not_checked', severity: 'error', owner: 'facts', message: 'Topic occupancy check is missing or negative.' });
  }

  if (facts.sources.length === 0) {
    issues.push({ code: 'no_sources', severity: 'error', owner: 'facts', message: 'Fact package must contain at least one source.' });
  }

  for (const claim of facts.claims) {
    if (claim.allowedInFinal && claim.sourceIds.length === 0) {
      issues.push({ code: 'claim_without_source', severity: 'error', owner: 'facts', message: `Claim ${claim.id} is allowed in final text but has no sources.` });
    }
  }

  if (draft.meta.seoTitle.length > 65) {
    issues.push({ code: 'seo_title_too_long', severity: 'error', owner: 'writer', message: 'seoTitle must be 65 characters or less.', path: 'meta.seoTitle' });
  }

  if (!draft.meta.seoTitle.trim()) {
    issues.push({ code: 'seo_title_missing', severity: 'error', owner: 'writer', message: 'seoTitle is mandatory for publication.', path: 'meta.seoTitle' });
  }

  if (draft.meta.description.length > 160) {
    issues.push({ code: 'description_too_long', severity: 'error', owner: 'writer', message: 'description must be 160 characters or less.', path: 'meta.description' });
  }

  if (!draft.meta.description.trim()) {
    issues.push({ code: 'description_missing', severity: 'error', owner: 'writer', message: 'description is mandatory for publication.', path: 'meta.description' });
  }

  if (!draft.meta.slug.trim()) {
    issues.push({ code: 'slug_missing', severity: 'error', owner: 'structure', message: 'slug is mandatory for publication.', path: 'meta.slug' });
  }

  if (request.brief.inputType === 'planned_topic' && !draft.meta.cluster) {
    issues.push({ code: 'cluster_missing', severity: 'error', owner: 'structure', message: 'planned_topic material must keep SEO cluster in meta.cluster.', path: 'meta.cluster' });
  }

  const leadBlocks = draft.blocks.filter((block) => block.type === 'lead');
  if (leadBlocks.length !== 1 || draft.blocks[0]?.type !== 'lead') {
    issues.push({ code: 'invalid_lead_position', severity: 'error', owner: 'structure', message: 'The first and only first block must be lead.' });
  }

  const leadText = leadBlocks[0]?.text || '';
  if (leadText.length < 200 || leadText.length > 450) {
    issues.push({ code: 'lead_length', severity: 'error', owner: 'writer', message: 'Lead must be 200-450 characters.', path: 'blocks[0].text' });
  }

  if (countNotXButYPatterns(leadText) > 0) {
    issues.push({ code: 'lead_not_x_but_y', severity: 'error', owner: 'writer', message: 'Lead must not start its answer through a не X, а Y contrast. Say what the subject is directly.', path: 'blocks[0].text' });
  }

  const wordCount = countWords(draft.blocks);
  if (wordCount < MIN_WORDS) {
    issues.push({ code: 'word_count_low', severity: 'error', owner: 'writer', message: `Material must contain at least ${MIN_WORDS} words; got ${wordCount}.` });
  }

  if (wordCount > MAX_WORDS) {
    issues.push({ code: 'word_count_high', severity: 'error', owner: 'writer', message: `Material must contain ${MAX_WORDS} words or less; got ${wordCount}.` });
  }

  const visibleText = draft.blocks.filter((block) => block.type !== 'lead' && block.type !== 'sources' && block.type !== 'related' && block.type !== 'visual_slot').map(collectText).join('\n');
  const notXButYCount = countNotXButYPatterns(visibleText);
  if (notXButYCount > MAX_NOT_X_BUT_Y_IN_BODY) {
    issues.push({ code: 'too_many_not_x_but_y', severity: 'error', owner: 'writer', message: `Use не X, а Y contrast no more than ${MAX_NOT_X_BUT_Y_IN_BODY} times outside the lead; got ${notXButYCount}. Examples: ${sampleNotXButYPatterns(visibleText).join(' | ')}` });
  }

  const requiredAccents = Math.max(MIN_ACCENTS, Math.ceil(wordCount / WORDS_PER_ACCENT));
  const accents = countAccents(visibleText);
  if (accents < requiredAccents) {
    issues.push({ code: 'not_enough_accents', severity: 'error', owner: 'writer', message: `Material must contain at least one **bold** or ==marker== accent per ${WORDS_PER_ACCENT} words, minimum ${MIN_ACCENTS}; got ${accents}, need ${requiredAccents}.` });
  }

  if (/выдач|seo|сео|кластер|ключев(ой|ые) запрос|поисков(ый|ая|ой)/iu.test(visibleText)) {
    issues.push({ code: 'service_seo_language', severity: 'error', owner: 'writer', message: 'Final text must not mention search results, SEO, clusters or keyword planning.' });
  }

  if (request.brief.inputType === 'planned_topic' && /Boundary:.*холодные звонки/iu.test(request.brief.knownFacts) && /холодн/iu.test(visibleText)) {
    issues.push({ code: 'boundary_topic_leak', severity: 'error', owner: 'writer', message: `Material leaks adjacent cold-calling topic despite explicit Boundary; keep cold calls for separate pages. Examples: ${sampleMatches(visibleText, /[^.!?]{0,80}холодн[^.!?]{0,80}/giu).join(' | ')}` });
  }

  const productText = draft.blocks.filter((block) => !['lead', 'visual_slot', 'related', 'faq', 'sources', 'cta'].includes(block.type)).map(collectText).join('\n');
  const productLinks = collectMarkdownLinks(productText).filter((link) => PRODUCT_LINKS.has(link.href));
  if (request.brief.inputType === 'planned_topic' && hasProductLinksInBrief(request) && (productLinks.length < 2 || productLinks.length > 4)) {
    issues.push({ code: 'product_links_count', severity: 'error', owner: 'writer', message: `Material must contain 2-4 contextual product links; got ${productLinks.length}.` });
  }

  if (productLinks.some((link) => /^подробнее$/iu.test(link.text.trim()))) {
    issues.push({ code: 'product_link_weak_anchor', severity: 'error', owner: 'writer', message: 'Product links must use a meaningful task phrase, not подробнее.' });
  }

  const productLinkPositions = collectProductLinkPositions(draft.blocks);
  if (productLinkPositions.length >= 2 && productLinkPositions.every((position) => position.normalized >= 0.66)) {
    issues.push({ code: 'product_links_grouped_at_end', severity: 'error', owner: 'writer', message: 'Product links must be woven into relevant paragraphs, not grouped near the end of the material.' });
  }

  const contentSections = draft.blocks.filter((block) => CONTENT_SECTION_TYPES.has(block.type));
  if (contentSections.length > MAX_CONTENT_SECTIONS) {
    issues.push({ code: 'too_many_content_sections', severity: 'error', owner: 'writer', message: `Material must have 6-8 content sections before FAQ; got ${contentSections.length}.` });
  }

  issues.push(...validateRenderableBlocks(request, draft));
  issues.push(...validateGuideEditorialRules(request, draft));

  if (request.brief.inputType === 'planned_topic' && request.brief.materialKind === 'compare') {
    if (!draft.blocks.some((block) => block.type === 'fork')) {
      issues.push({ code: 'compare_without_fork', severity: 'error', owner: 'structure', message: 'Compare material must contain a fork block.' });
    }

    if (!draft.blocks.some((block) => block.type === 'table')) {
      issues.push({ code: 'compare_without_table', severity: 'error', owner: 'structure', message: 'Compare material should contain a table block.' });
    }
  }

  const faq = draft.blocks.find((block) => block.type === 'faq');
  if (!faq) {
    issues.push({ code: 'faq_missing', severity: 'error', owner: 'structure', message: 'FAQ block is mandatory.' });
  } else if (!Array.isArray(faq.items) || faq.items.length < MIN_FAQ_ITEMS) {
    issues.push({ code: 'faq_too_short', severity: 'error', owner: 'writer', message: `FAQ must contain at least ${MIN_FAQ_ITEMS} questions.` });
  } else if (!String(faq.heading || faq.title || '').trim()) {
    issues.push({ code: 'faq_heading_missing', severity: 'error', owner: 'writer', message: 'FAQ block must have a visible heading.' });
  }

  const claimIds = new Set(facts.claims.map((claim) => claim.id));
  for (const block of draft.blocks) {
    for (const claimId of block.sourceClaimIds || []) {
      if (!claimIds.has(claimId)) {
        issues.push({ code: 'unknown_claim_reference', severity: 'error', owner: 'writer', message: `Block ${block.id} references unknown claim ${claimId}.` });
      }
    }
  }

  for (const block of draft.blocks) {
    if (block.type === 'sources' || block.type === 'related') continue;
    const blockText = collectText(block);
    if (containsExternalLink(blockText)) {
      issues.push({ code: 'external_body_link', severity: 'error', owner: 'writer', message: `Block ${block.id} contains an external link in final body text.` });
    }

    if (containsBareInternalPath(blockText)) {
      issues.push({ code: 'bare_internal_path', severity: 'error', owner: 'writer', message: `Block ${block.id} contains a bare internal path. Use [text](/path) syntax or related items.` });
    }

    if ((block.type === 'table' || block.type === 'matrix') && !hasStructuredRows(block)) {
      issues.push({ code: 'table_without_rows', severity: 'error', owner: 'writer', message: `Block ${block.id} is ${block.type} but has no structured rows/items.`, path: `blocks.${block.id}` });
    }
  }

  for (const requiredBlock of structure.requiredBlocks) {
    if (!hasRequiredBlock(draft.blocks, requiredBlock)) {
      issues.push({ code: 'missing_required_block', severity: 'error', owner: 'writer', message: `Required block ${requiredBlock} is missing from draft.`, path: `blocks.${requiredBlock}` });
    }
  }

  const related = draft.blocks.find((block) => block.type === 'related');
  if (!related) {
    issues.push({ code: 'related_missing', severity: 'error', owner: 'structure', message: 'Related block is mandatory for internal linking.' });
  } else if (!Array.isArray(related.items) || related.items.length < 2) {
    issues.push({ code: 'related_too_short', severity: 'error', owner: 'writer', message: 'Related block must contain at least 2 internal links.', path: 'blocks.related' });
  } else if (related.items.some((item) => !relatedHref(item))) {
    issues.push({ code: 'related_invalid_item', severity: 'error', owner: 'writer', message: 'Related block items must be strings or objects with href.', path: 'blocks.related.items' });
  }

  const selfHref = `/${request.brief.inputType === 'planned_topic' && request.brief.materialKind === 'compare' ? 'compare' : 'guides'}/${draft.meta.slug}`;
  if (related?.items?.some((item) => relatedHref(item) === selfHref)) {
    issues.push({ code: 'related_self_link', severity: 'error', owner: 'writer', message: 'Related block must not link to the same material.', path: 'blocks.related' });
  }

  const sources = draft.blocks.find((block) => block.type === 'sources');
  if (facts.sources.length > 0 && !sources) {
    issues.push({ code: 'sources_missing', severity: 'error', owner: 'writer', message: 'Sources block is mandatory when fact package contains external sources.' });
  } else if (sources && (!Array.isArray(sources.items) || sources.items.length === 0)) {
    issues.push({ code: 'sources_empty', severity: 'error', owner: 'writer', message: 'Sources block must contain items with title, url and snapshot.' });
  } else if (sources?.items?.some((item) => !isCompleteSourceItem(item))) {
    issues.push({ code: 'sources_incomplete', severity: 'error', owner: 'writer', message: 'Each source item must contain title, url and YYYY-MM-DD snapshot.', path: 'blocks.sources.items' });
  }

  return {
    requestId: request.id,
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
    checkedAt: new Date().toISOString(),
  };
}

function validateGuideEditorialRules(request: PipelineRequest, draft: DraftDoc): ValidationIssue[] {
  if (request.brief.inputType !== 'planned_topic' || request.brief.materialKind !== 'guide') return [];
  const issues: ValidationIssue[] = [];

  for (const block of draft.blocks) {
    if (block.type === 'example' && /^пример\s*[:—-]/iu.test(String(block.heading || block.title || '').trim())) {
      issues.push({ code: 'example_heading_duplicates_label', severity: 'error', owner: 'writer', message: `Example heading "${block.heading || block.title}" duplicates the block label. Remove "Пример:" from the heading and keep the story-specific title.`, path: `blocks.${block.id}.heading` });
    }
  }

  const visibleText = draft.blocks.filter((block) => block.type !== 'sources' && block.type !== 'related' && block.type !== 'visual_slot').map(collectText).join('\n');
  if (/\b(?:North America|B2B SaaS|benchmark|quota attainment|ramp-up)\b/iu.test(visibleText)) {
    issues.push({ code: 'english_business_terms', severity: 'error', owner: 'writer', message: 'Guide text contains avoidable English business terms. Use ordinary Russian wording except product names and fixed terms.' });
  }

  const cta = draft.blocks.find((block) => block.type === 'cta');
  if (cta) {
    const ctaText = collectText(cta);
    const primaryHref = String((cta as { primary?: { href?: unknown } }).primary?.href || '');
    if (/book-a-demo|booking|demo|демо/i.test(`${primaryHref} ${ctaText}`)) {
      issues.push({ code: 'guide_cta_book_demo', severity: 'error', owner: 'writer', message: 'Guide CTA must lead to a relevant product page, not directly to demo booking.', path: `blocks.${cta.id}` });
    }
    if (countWordsInValue(cta) > 30) {
      issues.push({ code: 'cta_text_too_long', severity: 'error', owner: 'writer', message: 'Guide CTA text must be short: no more than 30 words.', path: `blocks.${cta.id}` });
    }
  }

  return issues;
}

function hasRequiredBlock(blocks: DraftBlock[], requiredBlock: string): boolean {
  if (blocks.some((block) => block.type === requiredBlock)) return true;
  if (requiredBlock === 'steps') {
    return blocks.some((block) => block.type === 'visual_slot' && /steps|sequence|process|pipeline|flow/i.test(String(block.sourceBlockId || block.id || block.visualKind || block.visual || '')));
  }
  return false;
}

function isCompleteSourceItem(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const source = item as { title?: unknown; url?: unknown; snapshot?: unknown };
  return Boolean(source.title) && typeof source.url === 'string' && /^https?:\/\//i.test(source.url) && typeof source.snapshot === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.snapshot);
}

function validateRenderableBlocks(request: PipelineRequest, draft: DraftDoc): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const blocks = draft.blocks;
  const pipelineVisualSlots = blocks.filter((block) => block.type === 'visual_slot' && String(block.visualKind || block.visual || '') === 'pipeline');

  if (request.brief.inputType === 'planned_topic' && request.brief.materialKind === 'guide' && pipelineVisualSlots.length > 1) {
    issues.push({
      code: 'visual_slot_too_many_pipelines',
      severity: 'error',
      owner: 'structure',
      message: `Guide contains ${pipelineVisualSlots.length} pipeline visual slots. Pipeline must not be the default infographic; keep one real sequence or use split/checklist/bars.`,
    });
  }

  blocks.forEach((block, index) => {
    issues.push(...validateHeadingMarkup(block));

    if (request.brief.inputType === 'planned_topic' && request.brief.materialKind === 'guide' && block.type === 'matrix') {
      issues.push({ code: 'guide_matrix_forbidden', severity: 'error', owner: 'structure', message: `Guide block ${block.id} must not use matrix; use table or prose/cards with renderable fields.` });
    }

    if (block.type === 'cards' && !hasRenderableCards(block)) {
      issues.push({ code: 'cards_not_renderable', severity: 'error', owner: 'writer', message: `Block cards "${block.heading || block.title || block.id}" will not render: use cards[{title,text}], not items.`, path: `blocks.${block.id}.cards` });
    }

    if (block.type === 'matrix' && !hasRenderableMatrix(block)) {
      issues.push({ code: 'matrix_not_renderable', severity: 'error', owner: 'writer', message: `Block matrix "${block.heading || block.title || block.id}" will not render: use columns and groups[].rows[].`, path: `blocks.${block.id}.groups` });
    }

    if (block.type === 'visual_slot') {
      issues.push(...validateRenderableVisualSlot(block, index, blocks));
    }
  });

  for (let index = 0; index < blocks.length - 2; index += 1) {
    if (blocks[index]?.type === 'cards' && blocks[index + 1]?.type === 'cards' && blocks[index + 2]?.type === 'cards') {
      issues.push({ code: 'too_many_cards_in_a_row', severity: 'error', owner: 'structure', message: 'Do not place three cards blocks in a row; alternate block forms.' });
      break;
    }
  }

  return issues;
}

function hasRenderableCards(block: DraftBlock): boolean {
  return Array.isArray(block.cards) && block.cards.length > 0 && block.cards.every((card) => Boolean(card && typeof card === 'object' && String((card as { title?: unknown }).title || '').trim() && String((card as { text?: unknown }).text || '').trim()));
}

function hasRenderableMatrix(block: DraftBlock): boolean {
  return Array.isArray(block.columns) && block.columns.length > 0 && Array.isArray(block.groups) && block.groups.some((group) => Boolean(group && typeof group === 'object' && Array.isArray((group as { rows?: unknown[] }).rows) && (group as { rows: unknown[] }).rows.length > 0));
}

function validateRenderableVisualSlot(block: DraftBlock, index: number, blocks: DraftBlock[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const kind = String(block.visualKind || block.visual || '');
  if (!VISUAL_SLOT_KINDS.has(kind)) {
    issues.push({ code: 'visual_slot_unknown_kind', severity: 'error', owner: 'structure', message: `visual_slot ${block.id} will not render: visualKind must be pipeline, checklist, bars or split.` });
    return issues;
  }

  if (index === blocks.length - 1) {
    issues.push({ code: 'visual_slot_last_block', severity: 'error', owner: 'structure', message: `visual_slot ${block.id} must not be the last block in the material.` });
  }

  const previous = blocks[index - 1];
  const next = blocks[index + 1];
  if (block.title && (isSameCleanHeading(block.title, previous?.heading || previous?.title) || isSameCleanHeading(block.title, next?.heading || next?.title))) {
    issues.push({ code: 'visual_slot_duplicate_heading', severity: 'error', owner: 'structure', message: `visual_slot ${block.id} must not duplicate the neighboring section heading.` });
  }

  if (kind === 'split') {
    const sides = Array.isArray(block.sides) ? block.sides : [];
    if (sides.length !== 2 || sides.some((side) => !side || typeof side !== 'object' || !Array.isArray((side as { items?: unknown[] }).items) || (side as { items: unknown[] }).items.length === 0)) {
      issues.push({ code: 'visual_split_not_renderable', severity: 'error', owner: 'writer', message: `visual_slot ${block.id} split will not render useful content: use sides[2]{title,items[]} and every side must have items.` });
    }
    return issues;
  }

  const items = Array.isArray(block.items) ? block.items : Array.isArray((block.data as { items?: unknown[] })?.items) ? (block.data as { items: unknown[] }).items : [];
  const min = kind === 'pipeline' ? 3 : 2;
  if (items.length < min) {
    issues.push({ code: 'visual_slot_not_renderable', severity: 'error', owner: 'writer', message: `visual_slot ${block.id} ${kind} will not render useful content: need at least ${min} items.` });
  }

  if (kind === 'checklist') {
    const marks = items.map((item) => (item as { ok?: unknown })?.ok).filter((value) => typeof value === 'boolean');
    if (marks.length !== items.length) {
      issues.push({ code: 'visual_slot_checklist_bad_item', severity: 'error', owner: 'structure', message: `visual_slot ${block.id} checklist items must contain boolean ok.` });
    } else if (marks.length > 1 && new Set(marks).size === 1) {
      issues.push({ code: 'visual_slot_checklist_no_contrast', severity: 'error', owner: 'structure', message: `visual_slot ${block.id} checklist has the same ok status for every item; this is a list with icons, not a pass/fail scheme.` });
    }
  }
  return issues;
}

function validateHeadingMarkup(block: DraftBlock): ValidationIssue[] {
  const heading = String(block.heading || block.title || '');
  if (!heading) return [];
  const issues: ValidationIssue[] = [];
  if (/\*\*[^*]+\*\*/u.test(heading)) {
    issues.push({ code: 'heading_bold_markup', severity: 'error', owner: 'writer', message: `Heading "${heading}" must not use **bold**; headings are already bold. Use ==marker== or __underline__ rarely.` });
  }
  const accents = (heading.match(/==[^=]+==/g) || []).length + (heading.match(/__[^_]+__/g) || []).length;
  if (accents > 1) {
    issues.push({ code: 'heading_too_many_accents', severity: 'error', owner: 'writer', message: `Heading "${heading}" must contain at most one ==marker== or __underline__ accent.` });
  }
  return issues;
}

function cleanHeading(value: unknown): string {
  return String(value || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\/\/([^/]+)\/\//g, '$1')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/giu, ' ')
    .trim();
}

function isSameCleanHeading(a: unknown, b: unknown): boolean {
  const left = cleanHeading(a);
  const right = cleanHeading(b);
  return Boolean(left && right && left === right);
}

function countAccents(text: string): number {
  return (text.match(/\*\*[^*]+\*\*/g) || []).length + (text.match(/==[^=]+==/g) || []).length;
}

function countNotXButYPatterns(text: string): number {
  const normalized = text.replace(/\s+/g, ' ');
  return (normalized.match(/(^|\s)не\s+(?:только\s+[^.!?;:]{1,90}?\s+но\s+и|(?:просто\s+)?[^.!?;:]{1,90}?\s+а)\s+/giu) || []).length;
}

function sampleNotXButYPatterns(text: string): string[] {
  return sampleMatches(text.replace(/\s+/g, ' '), /(^|\s)не\s+(?:только\s+[^.!?;:]{1,90}?\s+но\s+и|(?:просто\s+)?[^.!?;:]{1,90}?\s+а)\s+[^.!?;:]{0,60}/giu);
}

function sampleMatches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].slice(0, 3).map((match) => match[0].trim());
}

function relatedHref(item: unknown): string | undefined {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') return String((item as { href?: unknown }).href || '');
  return undefined;
}

function countWords(blocks: DraftBlock[]): number {
  return blocks.filter((block) => block.type !== 'visual_slot').reduce((sum, block) => sum + countWordsInValue(block), 0);
}

function containsExternalLink(text: string | undefined): boolean {
  if (!text) return false;
  return /https?:\/\//i.test(text);
}

function containsBareInternalPath(text: string | undefined): boolean {
  if (!text) return false;
  return /(^|\s)\/[a-z0-9а-яё][^\s)\],.;:!?]*/iu.test(text.replace(/\[[^\]]+\]\(\/[^)]*\)/g, ''));
}

function collectMarkdownLinks(text: string): Array<{ text: string; href: string }> {
  return [...text.matchAll(/\[([^\]]+)]\((\/[^)]*)\)/g)].map((match) => ({ text: match[1] || '', href: match[2] || '' }));
}

function collectProductLinkPositions(blocks: DraftBlock[]): Array<{ index: number; normalized: number }> {
  const bodyBlocks = blocks.map((block, index) => ({ block, index })).filter(({ block }) => !['lead', 'visual_slot', 'related', 'faq', 'sources', 'cta'].includes(block.type));
  const denominator = Math.max(1, bodyBlocks.length - 1);
  return bodyBlocks.flatMap(({ block, index }, bodyIndex) => collectMarkdownLinks(collectText(block)).some((link) => PRODUCT_LINKS.has(link.href)) ? [{ index, normalized: bodyIndex / denominator }] : []);
}

function hasProductLinksInBrief(request: PipelineRequest): boolean {
  return request.brief.inputType === 'planned_topic' && request.brief.internalLinks.split(/[\s,]+/).some((href) => PRODUCT_LINKS.has(href));
}

function collectText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectText).join('\n');
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => !['href', 'url', 'sourceClaimIds', 'id', 'type'].includes(key))
      .map(([, item]) => collectText(item))
      .join('\n');
  }
  return '';
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

function hasStructuredRows(block: DraftBlock): boolean {
  if (Array.isArray(block.rows) && block.rows.length > 0) return true;
  if (Array.isArray(block.items) && block.items.length > 0) return true;
  if (Array.isArray(block.groups) && block.groups.some((group) => Boolean(group && typeof group === 'object' && Array.isArray((group as { rows?: unknown[] }).rows) && (group as { rows: unknown[] }).rows.length > 0))) return true;
  return false;
}
