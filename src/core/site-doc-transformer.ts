import type { DraftBlock, DraftDoc, PipelineRequest } from './types.js';

export interface SiteDoc {
  meta: Record<string, unknown>;
  blocks: DraftBlock[];
}

export function toSiteDoc(request: PipelineRequest, draft: DraftDoc, options: { model?: string } = {}): SiteDoc {
  const today = new Date().toISOString().slice(0, 10);
  const slug = normalizeSlug(draft.meta.slug || slugFromRequest(request));
  const section = sectionFromRequest(request) || 'tehnika';

  return {
    meta: {
      ...draft.meta,
      kind: kindForSite(request, draft),
      slug,
      h1: draft.meta.h1 || draft.meta.title || titleFromRequest(request),
      seoTitle: draft.meta.seoTitle || draft.meta.title || titleFromRequest(request),
      description: draft.meta.description || '',
      updatedAt: today,
      publishedAt: today,
      author: draft.meta.author || { name: 'Команда Lexis Voice', kind: 'organization' },
      // Кластер заявки — канон редакционного вопроса. При пустом значении
      // сохраняем подготовленный кластер черновика или slug.
      cluster: (request.brief.inputType === 'planned_topic' ? request.brief.cluster : undefined) || draft.meta.cluster || slug,
      section,
      provenance: {
        requestId: request.id,
        model: options.model || 'unknown',
        generatedAt: new Date().toISOString(),
      },
    },
    blocks: ensureGuideRequiredBlocks(draft.blocks.map((block) => normalizeBlockForSite(block, request)).filter((block) => Boolean(block.type)), request),
  };
}

function normalizeBlockForSite(block: DraftBlock, request: PipelineRequest): DraftBlock {
  if (block.type === 'lead') return { ...block, text: block.text || asString(block.lead) };
  if (block.type === 'section') return { ...block, type: 'prose', heading: block.heading || block.title, paragraphs: block.paragraphs || textToParagraphs(block.text) };
  if (block.type === 'prose') return { ...block, heading: block.heading || block.title, paragraphs: block.paragraphs || textToParagraphs(block.text) };
  if (block.type === 'steps') return { ...block, steps: block.steps || block.items || [] };
  if (block.type === 'cards') return { ...block, cards: block.cards || normalizeCards(block.items || []) };
  if (block.type === 'table') return { ...block, head: block.head || block.columns || [], rows: block.rows || [] };
  if (block.type === 'matrix') return { ...block, type: 'table', head: block.head || block.columns || [], rows: block.rows || [] };
  if (block.type === 'callout') return { ...block, title: block.title || block.heading };
  if (block.type === 'faq') return { ...block, items: normalizeFaqItems(block.items || []) };
  if (block.type === 'cta') return normalizeCtaBlock(block);
  if (block.type === 'fork') return normalizeForkBlock(block, request);
  if (block.type === 'visual_slot') return block;
  return block;
}



function ensureGuideRequiredBlocks(blocks: DraftBlock[], request: PipelineRequest): DraftBlock[] {
  if (request.brief.inputType !== 'planned_topic' || request.brief.materialKind === 'compare') return blocks;
  return orderGuideTailBlocks(blocks);
}

function orderGuideTailBlocks(blocks: DraftBlock[]): DraftBlock[] {
  const tailTypes = new Set(['takeaways', 'faq', 'related', 'sources', 'cta', 'promo']);
  const body = blocks.filter((block) => !tailTypes.has(block.type));
  const tail = blocks.filter((block) => tailTypes.has(block.type));
  const rank: Record<string, number> = { takeaways: 1, faq: 2, related: 3, sources: 4, promo: 5, cta: 6 };
  tail.sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
  return [...body, ...tail];
}

function firstTakeaway(block: DraftBlock): string {
  const text = firstUsefulText(block).replace(/[*_=]/g, '').trim();
  if (!text) return '';
  return text.split(/[.!?]/)[0].trim().slice(0, 180);
}

function firstUsefulText(block: DraftBlock): string {
  if (typeof block.text === 'string' && block.text.trim().length > 0) return block.text.trim();
  if (Array.isArray(block.paragraphs)) {
    const found = block.paragraphs.map((paragraph) => String(paragraph).trim()).find(Boolean);
    if (found) return found;
  }
  if (Array.isArray(block.items)) {
    const found = block.items.map((item) => typeof item === 'string' ? item : item && typeof item === 'object' ? String((item as { text?: unknown; description?: unknown }).text || (item as { description?: unknown }).description || '') : '').find(Boolean);
    if (found) return found;
  }
  return '';
}

function normalizeForkBlock(block: DraftBlock, request: PipelineRequest): DraftBlock {
  const options = Array.isArray(block.options) ? block.options : Array.isArray(block.items) ? block.items : [];
  const next: DraftBlock = options.length > 0 ? { ...block, options } : block;
  if (request.brief.inputType !== 'planned_topic' || request.brief.materialKind !== 'compare' || next.neither) return next;
  return {
    ...next,
    neither: {
      title: 'Когда не нужно ни то, ни другое',
      text: 'Если задача не подтверждена пилотом, критерии выбора не согласованы или команда пока не готова менять процесс обучения, лучше сначала описать сценарии, метрики и ограничения, а не выбирать платформу по названию.',
    },
  };
}

function normalizeCards(items: unknown[]): unknown[] {
  return items.map((item) => {
    if (item && typeof item === 'object') {
      const value = item as Record<string, unknown>;
      return { ...value, title: value.title || value.heading, text: value.text || value.description || value.body };
    }
    return { title: String(item || ''), text: '' };
  });
}

function normalizeFaqItems(items: unknown[]): unknown[] {
  return items.map((item) => {
    if (item && typeof item === 'object') {
      const value = item as Record<string, unknown>;
      return { ...value, q: value.q || value.question, a: value.a || value.answer };
    }
    return item;
  });
}

function normalizeCtaBlock(block: DraftBlock): DraftBlock {
  const primary = block.primary && typeof block.primary === 'object'
    ? block.primary
    : { label: 'Разобрать звонки', href: '/product/call-scoring' };
  const next = { ...block, heading: block.heading || block.title || 'Проверьте готовность по звонкам', primary };
  if (typeof next.text === 'string') next.text = next.text.slice(0, 180);
  if (typeof next.title === 'string') next.title = next.title.slice(0, 70);
  if (typeof next.heading === 'string') next.heading = next.heading.slice(0, 70);
  if (next.primary && typeof next.primary === 'object') {
    const value = next.primary as Record<string, unknown>;
    value.label = String(value.label || 'Разобрать звонки').slice(0, 45);
    if (!String(value.href || '').startsWith('/product/')) value.href = '/product/call-scoring';
  }
  return next;
}

function textToParagraphs(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  return text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function kindForSite(request: PipelineRequest, draft: DraftDoc): 'guide' | 'news' | 'compare' {
  // ⚠️ Дверь сайта публикует только guide (blog/news живут в коде сайта).
  // Тема типа post из контент-плана раньше уезжала как news → 422
  // unsupported_kind ПОСЛЕ полной генерации (A-0026). Плановые темы
  // публикуем гайдами: по содержанию они и есть гайды.
  if (request.brief.inputType === 'planned_topic') {
    return request.brief.materialKind === 'compare' ? 'compare' : 'guide';
  }
  const kind = draft.meta.kind;
  if (kind === 'news' || kind === 'compare') return kind;
  return 'guide';
}

function slugFromRequest(request: PipelineRequest): string {
  if (request.brief.inputType === 'planned_topic') {
    const url = request.brief.knownFacts.match(/URL:\s*(\/[^\s]+)/)?.[1];
    if (url) return url.split('/').filter(Boolean).at(-1) || 'material';
    const slug = request.brief.knownFacts.match(/Slug:\s*([^\s]+)/)?.[1];
    if (slug) return slug;
  }
  return titleFromRequest(request);
}

function titleFromRequest(request: PipelineRequest): string {
  return request.brief.inputType === 'planned_topic' ? request.brief.title : request.brief.eventSummary;
}

function sectionFromRequest(request: PipelineRequest): string | undefined {
  if (request.brief.inputType !== 'planned_topic') return undefined;
  const section = request.brief.knownFacts.match(/Section:\s*([^\n]+)/)?.[1]?.trim();
  if (section && section !== 'не указано') return section;
  return undefined;
}

function normalizeSlug(value: unknown): string {
  const slug = String(value || 'material')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'material';
}

/** Preserve article text when the deployed site's renderer predates guide-v2 blocks. */
export function toLegacySiteDoc(doc: SiteDoc): SiteDoc {
  return { ...doc, blocks: doc.blocks.map((block) => {
    if (block.type === 'example') {
      const paragraphs = [...(block.paragraphs || []), ...(block.text ? [block.text] : [])];
      for (const item of block.items || []) {
        if (typeof item === 'string') paragraphs.push(item);
        else if (item && typeof item === 'object') {
          const value = item as Record<string, unknown>;
          paragraphs.push([value.title, value.text || value.description].filter(Boolean).join(': '));
        }
      }
      return { ...block, type: 'prose', heading: block.heading || block.title || 'Пример из практики', paragraphs };
    }
    if (block.type === 'takeaways') return { ...block, type: 'prose', heading: `${block.heading || block.title || 'Выводы'}: ${doc.meta.h1 || doc.meta.title || doc.meta.slug || 'практика продаж'}`, paragraphs: (block.items || []).map((item) => {
      if (typeof item === 'string') return item;
      const value = item as Record<string, unknown>;
      return [value.title, value.text || value.description].filter(Boolean).join(': ');
    }) };
    if (block.type === 'expert') return { ...block, type: 'quote', author: block.name, role: block.role };
    return block;
  }) };
}
