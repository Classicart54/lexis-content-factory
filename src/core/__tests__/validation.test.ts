import assert from 'node:assert/strict';
import test from 'node:test';
import type { DraftDoc, FactPackage, MaterialStructure, PipelineRequest } from '../types.js';
import { validateMaterial } from '../validation.js';

test('validator catches missing sources, short article and malformed lead', () => {
  const request = sampleRequest();
  const facts: FactPackage = {
    requestId: request.id,
    topicOccupied: true,
    sources: [],
    claims: [{ id: 'F1', claim: 'Unsupported claim.', sourceIds: [], allowedInFinal: true }],
    gaps: [],
    createdAt: new Date().toISOString(),
  };
  const structure = sampleStructure(request.id, ['lead', 'section', 'faq']);
  const draft: DraftDoc = {
    meta: { title: 'Title', seoTitle: 'Title', description: 'Description', slug: 'title', cluster: 'voice ai', author: 'Lexis Voice' },
    blocks: [{ id: 'lead', type: 'lead', text: 'Too short.', sourceClaimIds: ['F1'] }],
  };

  const report = validateMaterial(request, facts, structure, draft);
  const codes = report.issues.map((issue) => issue.code);

  assert.equal(report.ok, false);
  assert.ok(codes.includes('no_sources'));
  assert.ok(codes.includes('claim_without_source'));
  assert.ok(codes.includes('lead_length'));
  assert.ok(codes.includes('word_count_low'));
  assert.ok(codes.includes('faq_missing'));
});

test('validator accepts a basic sourced material', () => {
  const request = sampleRequest();
  const facts: FactPackage = {
    requestId: request.id,
    topicOccupied: true,
    sources: [{ id: 'S1', url: 'https://example.com', title: 'Source', retrievedAt: new Date().toISOString(), reliability: 'official' }],
    claims: [{ id: 'F1', claim: 'Supported claim.', sourceIds: ['S1'], allowedInFinal: true }],
    gaps: [],
    createdAt: new Date().toISOString(),
  };
  const structure = sampleStructure(request.id, ['lead', 'section', 'faq']);
  const draft: DraftDoc = {
    meta: { title: 'Title', seoTitle: 'Title', description: 'Description', slug: 'title', cluster: 'voice ai', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Голосовой ИИ полезен только тогда, когда материал опирается на проверенные факты, понятную структуру и заранее заданные правила качества. Этот черновик показывает, как конвейер должен доводить тему до готового JSON без ручного согласования.', sourceClaimIds: ['F1'] },
      { id: 'section', type: 'section', text: `**Проверяемая фактура** помогает не превращать материал в общие советы. ==Главный вывод== должен быть виден при быстром чтении, поэтому текст получает несколько аккуратных акцентов. **Второй акцент** фиксирует важную мысль, а ==маркер== показывает, что читатель должен унести с собой. **Третий акцент** страхует длинный материал, а ==второй маркер== держит норму одно выделение на 250 слов. ${Array.from({ length: 1220 }, () => 'слово').join(' ')}`, sourceClaimIds: ['F1'] },
      { id: 'related', type: 'related', items: [{ href: '/guides' }, { href: '/cases' }] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', text: 'FAQ text', items: Array.from({ length: 8 }, (_, index) => ({ question: `Q${index}?`, answer: 'Длинный ответ с фактом, ограничением и понятным следующим шагом для читателя материала.' })), sourceClaimIds: ['F1'] },
      { id: 'sources', type: 'sources', items: [{ title: 'Source', url: 'https://example.com', snapshot: new Date().toISOString().slice(0, 10) }] },
    ],
  };

  const report = validateMaterial(request, facts, structure, draft);
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
});

test('validator rejects overlong material, missing accents and incomplete sources', () => {
  const request = sampleRequest();
  const facts: FactPackage = {
    requestId: request.id,
    topicOccupied: true,
    sources: [{ id: 'S1', url: 'https://example.com', title: 'Source', retrievedAt: new Date().toISOString(), reliability: 'official' }],
    claims: [{ id: 'F1', claim: 'Supported claim.', sourceIds: ['S1'], allowedInFinal: true }],
    gaps: [],
    createdAt: new Date().toISOString(),
  };
  const structure = sampleStructure(request.id, ['lead', 'section', 'faq']);
  const draft: DraftDoc = {
    meta: { title: 'Title', seoTitle: 'Title', description: 'Description', slug: 'title', cluster: 'voice ai', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Голосовой ИИ полезен только тогда, когда материал опирается на проверенные факты, понятную структуру и заранее заданные правила качества. Этот черновик показывает, как конвейер должен доводить тему до готового JSON без ручного согласования.', sourceClaimIds: ['F1'] },
      { id: 'section', type: 'section', text: Array.from({ length: 2100 }, () => 'слово').join(' '), sourceClaimIds: ['F1'] },
      { id: 'related', type: 'related', items: [{ href: '/guides' }, { href: '/cases' }] },
      { id: 'faq', type: 'faq', items: Array.from({ length: 8 }, (_, index) => ({ question: `Q${index}?`, answer: 'Длинный ответ с фактом, ограничением и понятным следующим шагом для читателя материала.' })), sourceClaimIds: ['F1'] },
      { id: 'sources', type: 'sources', items: [{ sourceId: 'S1', title: 'Source' }] },
    ],
  };

  const codes = validateMaterial(request, facts, structure, draft).issues.map((issue) => issue.code);
  assert.ok(codes.includes('word_count_high'));
  assert.ok(codes.includes('not_enough_accents'));
  assert.ok(codes.includes('sources_incomplete'));
});

test('validator rejects not X but Y contrast in lead and excessive body use', () => {
  const request = sampleRequest();
  const facts: FactPackage = {
    requestId: request.id,
    topicOccupied: true,
    sources: [{ id: 'S1', url: 'https://example.com', title: 'Source', retrievedAt: new Date().toISOString(), reliability: 'official' }],
    claims: [{ id: 'F1', claim: 'Supported claim.', sourceIds: ['S1'], allowedInFinal: true }],
    gaps: [],
    createdAt: new Date().toISOString(),
  };
  const structure = sampleStructure(request.id, ['lead', 'section', 'faq']);
  const repeatedContrast = 'Это не рейтинг методик, а рабочий набор для выбора приема. Это не просто теория, а способ разложить разговор. Это не только список, но и карта ситуаций.';
  const draft: DraftDoc = {
    meta: { title: 'Title', seoTitle: 'Title', description: 'Description', slug: 'title', cluster: 'voice ai', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Техники продаж работают не как рейтинг универсальных приемов, а как набор инструментов для разных ситуаций разговора. Материал помогает выбрать подход под задачу менеджера, этап сделки и уровень готовности клиента к следующему шагу.', sourceClaimIds: ['F1'] },
      { id: 'section', type: 'section', text: `**Проверяемая фактура** помогает держать статью полезной. ==Главный вывод== виден при быстром чтении. **Второй акцент** фиксирует мысль, а ==маркер== держит норму. **Третий акцент** добавлен для машинной проверки. ${repeatedContrast} ${Array.from({ length: 1220 }, () => 'слово').join(' ')}`, sourceClaimIds: ['F1'] },
      { id: 'related', type: 'related', items: [{ href: '/guides' }, { href: '/cases' }] },
      { id: 'faq', type: 'faq', items: Array.from({ length: 8 }, (_, index) => ({ question: `Q${index}?`, answer: 'Длинный ответ с фактом, ограничением и понятным следующим шагом для читателя материала.' })), sourceClaimIds: ['F1'] },
      { id: 'sources', type: 'sources', items: [{ title: 'Source', url: 'https://example.com', snapshot: new Date().toISOString().slice(0, 10) }] },
    ],
  };

  const codes = validateMaterial(request, facts, structure, draft).issues.map((issue) => issue.code);
  assert.ok(codes.includes('lead_not_x_but_y'));
  assert.ok(codes.includes('too_many_not_x_but_y'));
});

test('validator requires contextual product links when product map is available', () => {
  const request = sampleRequest();
  assert.equal(request.brief.inputType, 'planned_topic');
  request.brief.internalLinks = '/ /product/call-scoring /play /cases';
  const facts: FactPackage = {
    requestId: request.id,
    topicOccupied: true,
    sources: [{ id: 'S1', url: 'https://example.com', title: 'Source', retrievedAt: new Date().toISOString(), reliability: 'official' }],
    claims: [{ id: 'F1', claim: 'Supported claim.', sourceIds: ['S1'], allowedInFinal: true }],
    gaps: [],
    createdAt: new Date().toISOString(),
  };
  const structure = sampleStructure(request.id, ['lead', 'section', 'faq']);
  const draft: DraftDoc = {
    meta: { title: 'Title', seoTitle: 'Title', description: 'Description', slug: 'title', cluster: 'voice ai', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Голосовой ИИ полезен тогда, когда материал опирается на проверенные факты, понятную структуру и заранее заданные правила качества. Этот черновик показывает, как конвейер доводит тему до готового JSON без ручного согласования.', sourceClaimIds: ['F1'] },
      { id: 'section', type: 'section', text: `**Проверяемая фактура** помогает держать статью полезной. ==Главный вывод== виден при быстром чтении. **Второй акцент** фиксирует мысль, а ==маркер== держит норму. [подробнее](/play) ${Array.from({ length: 1220 }, () => 'слово').join(' ')}`, sourceClaimIds: ['F1'] },
      { id: 'related', type: 'related', items: [{ href: '/guides' }, { href: '/cases' }] },
      { id: 'faq', type: 'faq', items: Array.from({ length: 8 }, (_, index) => ({ question: `Q${index}?`, answer: 'Длинный ответ с фактом, ограничением и понятным следующим шагом для читателя материала.' })), sourceClaimIds: ['F1'] },
      { id: 'sources', type: 'sources', items: [{ title: 'Source', url: 'https://example.com', snapshot: new Date().toISOString().slice(0, 10) }] },
    ],
  };

  const codes = validateMaterial(request, facts, structure, draft).issues.map((issue) => issue.code);
  assert.ok(codes.includes('product_links_count'));
  assert.ok(codes.includes('product_link_weak_anchor'));
});

test('validator rejects blocks that will not render visible content', () => {
  const request = sampleRequest();
  const facts = sampleSourcedFacts(request.id);
  const structure = sampleStructure(request.id, ['lead', 'cards', 'faq']);
  const draft: DraftDoc = {
    meta: { title: 'Title', seoTitle: 'Title', description: 'Description', slug: 'title', cluster: 'voice ai', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Голосовой ИИ полезен тогда, когда материал опирается на проверенные факты, понятную структуру и заранее заданные правила качества. Этот черновик показывает, как конвейер доводит тему до готового JSON без ручного согласования.', sourceClaimIds: ['F1'] },
      { id: 'cards-1', type: 'cards', heading: 'Диагностика потребности', items: [{ title: 'Пусто', text: 'Не отрисуется' }], sourceClaimIds: ['F1'] },
      { id: 'cards-2', type: 'cards', heading: 'Второй блок', items: [{ title: 'Пусто', text: 'Не отрисуется' }], sourceClaimIds: ['F1'] },
      { id: 'cards-3', type: 'cards', heading: 'Третий блок', items: [{ title: 'Пусто', text: 'Не отрисуется' }], sourceClaimIds: ['F1'] },
      { id: 'matrix', type: 'matrix', heading: 'Матрица', columns: ['A', 'B'], rows: [['A', 'B']], sourceClaimIds: ['F1'] },
      { id: 'visual', type: 'visual_slot', title: 'Развилка', visualKind: 'split', sides: [{ title: 'Один' }, { title: 'Два', items: [] }], sourceClaimIds: ['F1'] },
      { id: 'section', type: 'section', heading: '**Плохой** заголовок с ==двумя== __акцентами__', text: `**Проверяемая фактура** помогает держать статью полезной. ==Главный вывод== виден при быстром чтении. **Второй акцент** фиксирует мысль, а ==маркер== держит норму. ${Array.from({ length: 1220 }, () => 'слово').join(' ')}`, sourceClaimIds: ['F1'] },
      { id: 'related', type: 'related', items: [{ href: '/guides' }, { href: '/cases' }] },
      { id: 'faq', type: 'faq', items: Array.from({ length: 8 }, (_, index) => ({ question: `Q${index}?`, answer: 'Длинный ответ с фактом, ограничением и понятным следующим шагом для читателя материала.' })), sourceClaimIds: ['F1'] },
      { id: 'sources', type: 'sources', items: [{ title: 'Source', url: 'https://example.com', snapshot: new Date().toISOString().slice(0, 10) }] },
    ],
  };

  const codes = validateMaterial(request, facts, structure, draft).issues.map((issue) => issue.code);
  assert.ok(codes.includes('cards_not_renderable'));
  assert.ok(codes.includes('too_many_cards_in_a_row'));
  assert.ok(codes.includes('guide_matrix_forbidden'));
  assert.ok(codes.includes('matrix_not_renderable'));
  assert.ok(codes.includes('visual_split_not_renderable'));
  assert.ok(codes.includes('faq_heading_missing'));
  assert.ok(codes.includes('heading_bold_markup'));
  assert.ok(codes.includes('heading_too_many_accents'));
});

test('validator rejects visual duplicate heading and product links grouped at the end', () => {
  const request = sampleRequest();
  assert.equal(request.brief.inputType, 'planned_topic');
  request.brief.internalLinks = '/ /product/call-scoring /product/analytics /product/ai-coach /cases';
  const facts = sampleSourcedFacts(request.id);
  const structure = sampleStructure(request.id, ['lead', 'section', 'faq']);
  const draft: DraftDoc = {
    meta: { title: 'Title', seoTitle: 'Title', description: 'Description', slug: 'title', cluster: 'voice ai', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Голосовой ИИ полезен тогда, когда материал опирается на проверенные факты, понятную структуру и заранее заданные правила качества. Этот черновик показывает, как конвейер доводит тему до готового JSON без ручного согласования.', sourceClaimIds: ['F1'] },
      { id: 'early', type: 'section', heading: 'Как выбрать технику', text: `**Проверяемая фактура** помогает держать статью полезной. ==Главный вывод== виден при быстром чтении. **Второй акцент** фиксирует мысль, а ==маркер== держит норму. ${Array.from({ length: 900 }, () => 'слово').join(' ')}`, sourceClaimIds: ['F1'] },
      { id: 'visual', type: 'visual_slot', title: 'Как выбрать технику', visualKind: 'pipeline', items: [{ title: 'Шаг один' }, { title: 'Шаг два' }, { title: 'Шаг три' }], sourceClaimIds: ['F1'] },
      { id: 'middle', type: 'section', heading: 'Средний раздел', text: Array.from({ length: 320 }, () => 'слово').join(' '), sourceClaimIds: ['F1'] },
      { id: 'late-a', type: 'section', heading: 'Поздний раздел', text: '[разбор реальных звонков](/product/call-scoring) помогает сверить технику с практикой.', sourceClaimIds: ['F1'] },
      { id: 'late-b', type: 'section', heading: 'Последний раздел', text: '[видно, у кого просел этап](/product/analytics), а затем полезны [персональные тренировки](/product/ai-coach).', sourceClaimIds: ['F1'] },
      { id: 'related', type: 'related', items: [{ href: '/guides' }, { href: '/cases' }] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: Array.from({ length: 8 }, (_, index) => ({ question: `Q${index}?`, answer: 'Длинный ответ с фактом, ограничением и понятным следующим шагом для читателя материала.' })), sourceClaimIds: ['F1'] },
      { id: 'sources', type: 'sources', items: [{ title: 'Source', url: 'https://example.com', snapshot: new Date().toISOString().slice(0, 10) }] },
    ],
  };

  const codes = validateMaterial(request, facts, structure, draft).issues.map((issue) => issue.code);
  assert.ok(codes.includes('visual_slot_duplicate_heading'));
  assert.ok(codes.includes('product_links_grouped_at_end'));
});

test('validator rejects decorative checklist and timeline overuse in guides', () => {
  const request = sampleRequest();
  const facts = sampleSourcedFacts(request.id);
  const structure = sampleStructure(request.id, ['lead', 'section', 'faq']);
  const draft: DraftDoc = {
    meta: { title: 'Title', seoTitle: 'Title', description: 'Description', slug: 'title', cluster: 'voice ai', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Голосовой ИИ полезен тогда, когда материал опирается на проверенные факты, понятную структуру и заранее заданные правила качества. Этот черновик показывает, как конвейер доводит тему до готового JSON без ручного согласования.', sourceClaimIds: ['F1'] },
      { id: 'section', type: 'section', heading: 'Ранний раздел', text: `**Проверяемая фактура** помогает держать статью полезной. ==Главный вывод== виден при быстром чтении. **Второй акцент** фиксирует мысль, а ==маркер== держит норму. ${Array.from({ length: 1220 }, () => 'слово').join(' ')}`, sourceClaimIds: ['F1'] },
      { id: 'visual-a', type: 'visual_slot', title: 'Первая схема', visualKind: 'pipeline', items: [{ title: 'Шаг один' }, { title: 'Шаг два' }, { title: 'Шаг три' }], sourceClaimIds: ['F1'] },
      { id: 'visual-b', type: 'visual_slot', title: 'Вторая схема', visualKind: 'pipeline', items: [{ title: 'Шаг один' }, { title: 'Шаг два' }, { title: 'Шаг три' }], sourceClaimIds: ['F1'] },
      { id: 'visual-c', type: 'visual_slot', title: 'Проверка нормы', visualKind: 'checklist', items: [{ text: 'Названа причина', ok: true }, { text: 'Задан вопрос', ok: true }], sourceClaimIds: ['F1'] },
      { id: 'related', type: 'related', items: [{ href: '/guides' }, { href: '/cases' }] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: Array.from({ length: 8 }, (_, index) => ({ question: `Q${index}?`, answer: 'Длинный ответ с фактом, ограничением и понятным следующим шагом для читателя материала.' })), sourceClaimIds: ['F1'] },
      { id: 'sources', type: 'sources', items: [{ title: 'Source', url: 'https://example.com', snapshot: new Date().toISOString().slice(0, 10) }] },
    ],
  };

  const codes = validateMaterial(request, facts, structure, draft).issues.map((issue) => issue.code);
  assert.ok(codes.includes('visual_slot_too_many_pipelines'));
  assert.ok(codes.includes('visual_slot_checklist_no_contrast'));
});

test('validator treats root product link as an early product link', () => {
  const request = sampleRequest();
  assert.equal(request.brief.inputType, 'planned_topic');
  request.brief.internalLinks = '/ /product/call-scoring /product/analytics /product/ai-coach /cases';
  const facts = sampleSourcedFacts(request.id);
  const structure = sampleStructure(request.id, ['lead', 'section', 'faq']);
  const draft: DraftDoc = {
    meta: { title: 'Title', seoTitle: 'Title', description: 'Description', slug: 'title', cluster: 'voice ai', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Голосовой ИИ полезен тогда, когда материал опирается на проверенные факты, понятную структуру и заранее заданные правила качества. Этот черновик показывает, как конвейер доводит тему до готового JSON без ручного согласования.', sourceClaimIds: ['F1'] },
      { id: 'early', type: 'section', heading: 'Ранний раздел', text: `**Проверяемая фактура** помогает держать статью полезной. Это удобно проверить в [инструментах Lexis Voice](/). ==Главный вывод== виден при быстром чтении. **Второй акцент** фиксирует мысль, а ==маркер== держит норму. ${Array.from({ length: 900 }, () => 'слово').join(' ')}`, sourceClaimIds: ['F1'] },
      { id: 'middle', type: 'section', heading: 'Средний раздел', text: Array.from({ length: 320 }, () => 'слово').join(' '), sourceClaimIds: ['F1'] },
      { id: 'late-a', type: 'section', heading: 'Поздний раздел', text: '[разбор реальных звонков](/product/call-scoring) помогает сверить технику с практикой.', sourceClaimIds: ['F1'] },
      { id: 'late-b', type: 'section', heading: 'Последний раздел', text: '[видно, у кого просел этап](/product/analytics), а затем полезны [персональные тренировки](/product/ai-coach).', sourceClaimIds: ['F1'] },
      { id: 'related', type: 'related', items: [{ href: '/guides' }, { href: '/cases' }] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: Array.from({ length: 8 }, (_, index) => ({ question: `Q${index}?`, answer: 'Длинный ответ с фактом, ограничением и понятным следующим шагом для читателя материала.' })), sourceClaimIds: ['F1'] },
      { id: 'sources', type: 'sources', items: [{ title: 'Source', url: 'https://example.com', snapshot: new Date().toISOString().slice(0, 10) }] },
    ],
  };

  const codes = validateMaterial(request, facts, structure, draft).issues.map((issue) => issue.code);
  assert.ok(!codes.includes('product_links_grouped_at_end'));
});

function sampleRequest(): PipelineRequest {
  const now = new Date().toISOString();
  return {
    id: 'A-TEST',
    status: 'machine_review',
    brief: {
      inputType: 'planned_topic',
      title: 'Test topic',
      cluster: 'voice ai',
      materialKind: 'guide',
      goal: 'Explain pipeline.',
      knownFacts: 'none',
      forbiddenMentions: 'none',
      internalLinks: '/blog',
    },
    createdAt: now,
    updatedAt: now,
    createdBy: { source: 'system' },
    notes: [],
  };
}

function sampleSourcedFacts(requestId: string): FactPackage {
  return {
    requestId,
    topicOccupied: true,
    sources: [{ id: 'S1', url: 'https://example.com', title: 'Source', retrievedAt: new Date().toISOString(), reliability: 'official' }],
    claims: [{ id: 'F1', claim: 'Supported claim.', sourceIds: ['S1'], allowedInFinal: true }],
    gaps: [],
    createdAt: new Date().toISOString(),
  };
}

function sampleStructure(requestId: string, requiredBlocks: string[]): MaterialStructure {
  return {
    requestId,
    materialKind: 'guide',
    title: 'Title',
    seoTitle: 'Title',
    description: 'Description',
    sections: [],
    requiredBlocks,
    createdAt: new Date().toISOString(),
  };
}
