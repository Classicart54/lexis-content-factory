import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSeoForPublication } from '../seo-preparation.js';
import type { DraftDoc, FactPackage, MaterialStructure, PipelineRequest } from '../types.js';

test('orchestrator SEO preparation normalizes meta and adds related and sources blocks', () => {
  const prepared = prepareSeoForPublication(sampleRequest(), sampleFacts(), sampleStructure(), sampleDraft());

  assert.equal(prepared.meta.slug, 'tehniki-prodazh');
  assert.equal(prepared.meta.cluster, 'техники продаж');
  assert.equal(prepared.meta.section, 'tehnika');
  assert.equal(prepared.meta.kind, 'guide');
  assert.ok(prepared.meta.seoTitle.length <= 65);
  assert.ok(prepared.meta.description.length <= 160);
  assert.deepEqual(prepared.meta.author, { name: 'Команда Lexis Voice', kind: 'organization' });

  const related = prepared.blocks.find((block) => block.type === 'related');
  const sources = prepared.blocks.find((block) => block.type === 'sources');
  assert.deepEqual(related?.items, [{ href: '/guides' }, { href: '/cases' }]);
  assert.deepEqual(sources?.items, [{ title: 'Official source', url: 'https://example.com/report', snapshot: '2026-08-09' }]);
});

test('orchestrator SEO preparation never assigns parent to hub topics', () => {
  const request = sampleRequest();
  assert.equal(request.brief.inputType, 'planned_topic');
  request.brief.knownFacts = `${request.brief.knownFacts}\nParent: sales`;
  const prepared = prepareSeoForPublication(request, sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    meta: { ...sampleDraft().meta, parent: 'sales' },
  });

  assert.equal(prepared.meta.parent, undefined);
});

test('orchestrator SEO preparation replaces grouped writer related block with flat hrefs', () => {
  const prepared = prepareSeoForPublication(sampleRequest(), sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      {
        id: 'related',
        type: 'related',
        heading: 'Что читать дальше?',
        items: [
          { group: 'Понять технику', links: [{ text: 'Вопросы', href: '/guides/vopros-v-prodazhah' }] },
          { group: 'Потренировать', links: [{ text: 'Тренажёр', href: '/play' }] },
        ],
      },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  const related = prepared.blocks.find((block) => block.type === 'related');
  assert.equal(related?.id, 'seo-related');
  assert.deepEqual(related?.items, [{ href: '/guides' }, { href: '/cases' }]);
});

test('orchestrator SEO preparation strips markdown links outside allowed internal links', () => {
  const prepared = prepareSeoForPublication(sampleRequest(), sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      {
        id: 'body',
        type: 'prose',
        paragraphs: ['Читайте [разбор B2B](/guides/tehniki-prodazh-b2b), а затем [кейсы](/cases).'],
      },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  assert.deepEqual(prepared.blocks.find((block) => block.id === 'body')?.paragraphs, ['Читайте разбор B2B, а затем [кейсы](/cases).']);
});

test('orchestrator SEO preparation parses space separated internal links', () => {
  const request = sampleRequest();
  assert.equal(request.brief.inputType, 'planned_topic');
  request.brief.internalLinks = '/ /play /product/call-scoring /tech';

  const prepared = prepareSeoForPublication(request, sampleFacts(), sampleStructure(), sampleDraft());
  assert.deepEqual(prepared.blocks.find((block) => block.type === 'related')?.items, [{ href: '/' }, { href: '/play' }, { href: '/product/call-scoring' }, { href: '/tech' }]);
});

test('orchestrator SEO preparation replaces writer sourceId groups with full source records', () => {
  const prepared = prepareSeoForPublication(sampleRequest(), sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      {
        id: 'sources',
        type: 'sources',
        groups: [{ title: 'Группа', items: [{ sourceId: 'S1', title: 'Short title only' }] }],
      },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  const sources = prepared.blocks.find((block) => block.type === 'sources');
  assert.equal(sources?.id, 'seo-sources');
  assert.deepEqual(sources?.items, [{ title: 'Official source', url: 'https://example.com/report', snapshot: '2026-08-09' }]);
});

test('orchestrator SEO preparation does not break benchmarking in source titles', () => {
  const facts = sampleFacts();
  facts.sources = [
    {
      id: 'S1',
      url: 'https://example.com/benchmarking',
      title: 'Benchmarking LLM Realistic Selling Skill',
      retrievedAt: '2026-08-09T00:00:00.000Z',
      reliability: 'expert',
    },
  ];

  const prepared = prepareSeoForPublication(sampleRequest(), facts, sampleStructure(), sampleDraft());
  const sources = prepared.blocks.find((block) => block.type === 'sources');

  assert.equal((sources?.items?.[0] as { title?: string } | undefined)?.title, 'бенчмаркинг LLM Realistic Selling Skill');
});

test('orchestrator SEO preparation normalizes common render and validation blockers', () => {
  const request = sampleRequest();
  assert.equal(request.brief.inputType, 'planned_topic');
  request.brief.internalLinks = '/ /play /product/call-scoring /tech /cases';

  const prepared = prepareSeoForPublication(request, sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      { id: 'section', type: 'prose', heading: 'Этапы продаж', paragraphs: ['Сначала посмотрите /play, затем [разбор звонков](/product/call-scoring).'] },
      { id: 'visual', type: 'visual_slot', title: 'Этапы продаж', visualKind: 'pipeline', items: [{ title: 'Контакт' }, { title: 'Потребность' }, { title: 'Сделка' }] },
      { id: 'cards', type: 'cards', items: [{ title: 'Контакт', description: 'Первый разговор с клиентом.' }] },
      { id: 'matrix', type: 'matrix', rows: [{ name: 'Переход', value: 'Есть следующий шаг' }] },
      { id: 'faq', type: 'faq', items: [] },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  const section = prepared.blocks.find((block) => block.id === 'section');
  assert.deepEqual(section?.paragraphs, ['Сначала посмотрите [/play](/play), затем [разбор звонков](/product/call-scoring).']);
  assert.equal(prepared.blocks.find((block) => block.id === 'visual')?.title, 'Схема действий');
  assert.deepEqual(prepared.blocks.find((block) => block.id === 'cards')?.cards, [{ title: 'Контакт', description: 'Первый разговор с клиентом.', text: 'Первый разговор с клиентом.' }]);
  assert.equal(prepared.blocks.find((block) => block.id === 'matrix')?.type, 'table');
  assert.equal(prepared.blocks.find((block) => block.id === 'faq')?.heading, 'Частые вопросы');
});

test('orchestrator SEO preparation redistributes existing late product links even without product links in brief', () => {
  const request = sampleRequest();
  assert.equal(request.brief.inputType, 'planned_topic');
  request.brief.internalLinks = '/guides /cases /tech';

  const prepared = prepareSeoForPublication(request, sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      { id: 'summary', type: 'tldr', items: ['Клиент сомневается, менеджер уточняет причину.'] },
      { id: 'early', type: 'prose', paragraphs: ['Сначала нужно понять задачу клиента и контекст сделки.'] },
      { id: 'middle', type: 'prose', paragraphs: ['Затем менеджер уточняет ограничения, критерии выбора и следующий шаг.'] },
      { id: 'late-one', type: 'prose', paragraphs: ['Ошибки удобно искать через [разбор звонков](/product/call-scoring).'] },
      { id: 'late-two', type: 'steps', items: [{ title: 'Тренировка', text: 'Команде помогает [персональная тренировка](/product/ai-coach).' }] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: [] },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  const positions = productLinkPositions(prepared.blocks);
  assert.ok(positions.length >= 2);
  assert.ok(!positions.every((position) => position >= 0.66));
});

test('orchestrator SEO preparation caps product links after redistribution', () => {
  const request = sampleRequest();
  assert.equal(request.brief.inputType, 'planned_topic');
  request.brief.internalLinks = '/guides /cases /tech';

  const prepared = prepareSeoForPublication(request, sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      { id: 'early', type: 'prose', paragraphs: ['Ранний контекст уже ведет в [главный продукт](/) и [тренажер](/play).'] },
      { id: 'middle', type: 'prose', paragraphs: ['Средний блок ведет в [аналитику](/product/analytics).'] },
      { id: 'late-one', type: 'prose', paragraphs: ['Поздний блок ведет в [разбор звонков](/product/call-scoring).'] },
      { id: 'late-two', type: 'steps', items: [{ title: 'Тренировка', text: 'Команде помогает [персональная тренировка](/product/ai-coach).' }] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: [] },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  const links = JSON.stringify(prepared.blocks).match(/\[([^\]]+)]\((\/|\/product\/[^)]+|\/play)\)/g) || [];
  assert.equal(links.length, 4);
});

test('orchestrator SEO preparation removes consecutive duplicate sentences', () => {
  const request = sampleRequest();
  assert.equal(request.brief.inputType, 'planned_topic');
  request.brief.internalLinks = '/guides /cases';
  const prepared = prepareSeoForPublication(request, sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      { id: 'body', type: 'prose', paragraphs: ['Это удобно проверить в [кейсе Lexis Voice](/cases). Это удобно проверить в [кейсе Lexis Voice](/cases). Дальше идет новый смысл.'] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: [] },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  assert.deepEqual(prepared.blocks.find((block) => block.id === 'body')?.paragraphs, ['Это удобно проверить в [кейсе Lexis Voice](/cases). Дальше идет новый смысл.']);
});

test('orchestrator SEO preparation converts marker markup to bold markdown', () => {
  const prepared = prepareSeoForPublication(sampleRequest(), sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      { id: 'body', type: 'prose', paragraphs: ['==Главный вывод== должен остаться выделением без marker-артефакта.'] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: [] },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  assert.deepEqual(prepared.blocks.find((block) => block.id === 'body')?.paragraphs, ['**Главный вывод** должен остаться выделением без marker-артефакта.']);
});

test('orchestrator SEO preparation softens unsupported frequency wording', () => {
  const prepared = prepareSeoForPublication(sampleRequest(), sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      { id: 'body', type: 'prose', heading: 'Самые частые возражения', paragraphs: ['Разберите частые возражения без обещания статистики.'] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: [] },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  const body = prepared.blocks.find((block) => block.id === 'body');
  assert.equal(body?.heading, 'типовые возражения');
  assert.deepEqual(body?.paragraphs, ['**Разберите типовые возражения без обещания статистики**.']);
});

test('orchestrator SEO preparation softens unsupported superlative wording', () => {
  const prepared = prepareSeoForPublication(sampleRequest(), sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      { id: 'body', type: 'cards', cards: [{ title: 'Провал', text: 'Самый частый провал SPIN — сразу предлагать решение.' }] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: [] },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  const body = prepared.blocks.find((block) => block.id === 'body');
  assert.deepEqual(body?.cards, [{ title: 'Провал', text: 'типичный провал SPIN — сразу предлагать решение.' }]);
});

test('orchestrator SEO preparation rewrites generic product anchors', () => {
  const request = sampleRequest();
  assert.equal(request.brief.inputType, 'planned_topic');
  request.brief.internalLinks = '/ /play /product/call-scoring /cases';
  const prepared = prepareSeoForPublication(request, sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      { id: 'body', type: 'prose', paragraphs: ['Это удобно проверить в [инструментах Lexis Voice](/play).'] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: [] },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  assert.deepEqual(prepared.blocks.find((block) => block.id === 'body')?.paragraphs, ['Это удобно проверить в [потренировать с ИИ-клиентом](/play). Реальные звонки можно [разбирать по чек-листу](/product/call-scoring).']);
});

test('orchestrator SEO preparation does not invent product fallback when brief has only root product link left', () => {
  const request = sampleRequest();
  assert.equal(request.brief.inputType, 'planned_topic');
  request.brief.internalLinks = '/ /cases';
  const prepared = prepareSeoForPublication(request, sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      { id: 'body', type: 'prose', paragraphs: ['Текст без продуктовой ссылки.'] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: [] },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  assert.equal(JSON.stringify(prepared.blocks).includes('](/play)'), false);
});

test('orchestrator SEO preparation syncs visualSlots meta with renderable visual blocks', () => {
  const prepared = prepareSeoForPublication(sampleRequest(), sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    meta: { ...sampleDraft().meta, visualSlots: 3 },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      { id: 'weak-visual', type: 'visual_slot', visualKind: 'pipeline', items: [{ title: 'Один' }] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: [] },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  assert.equal(prepared.blocks.filter((block) => block.type === 'visual_slot').length, 0);
  assert.equal(prepared.meta.visualSlots, 0);
});

test('orchestrator SEO preparation distributes guide examples and expert through the article body', () => {
  const prepared = prepareSeoForPublication(sampleRequest(), sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      { id: 'one', type: 'prose', paragraphs: ['Первый смысловой раздел показывает задачу клиента и контекст сделки.'] },
      { id: 'two', type: 'prose', paragraphs: ['Второй смысловой раздел показывает навык менеджера в разговоре.'] },
      { id: 'three', type: 'prose', paragraphs: ['Третий смысловой раздел показывает проверку навыка по записи.'] },
      { id: 'four', type: 'prose', paragraphs: ['Четвертый смысловой раздел показывает следующий шаг руководителя.'] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: [] },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  const types = prepared.blocks.map((block) => block.type);
  const exampleIndexes = prepared.blocks.map((block, index) => block.type === 'example' ? index : -1).filter((index) => index >= 0);
  const expertIndex = types.indexOf('expert');
  const faqIndex = types.indexOf('faq');

  assert.equal(exampleIndexes.length, 2);
  assert.ok(exampleIndexes[0] > types.indexOf('one'));
  assert.ok(exampleIndexes[1] > exampleIndexes[0]);
  assert.ok(exampleIndexes[1] < faqIndex);
  assert.ok(expertIndex > 0 && expertIndex < faqIndex);
});

test('orchestrator SEO preparation strips bold markdown from generated guide examples', () => {
  const prepared = prepareSeoForPublication(sampleRequest(), sampleFacts(), sampleStructure(), {
    ...sampleDraft(),
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      { id: 'one', type: 'prose', paragraphs: ['Первый смысловой раздел показывает задачу клиента.'] },
      { id: 'two', type: 'prose', paragraphs: ['Второй смысловой раздел показывает навык менеджера.'] },
      {
        id: 'generated-example-1',
        type: 'example',
        paragraphs: ['**Менеджер задаёт вопросы и отправляет материалы, но в записи не слышно следующего шага**. Дальше нужен разбор.'],
      },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: [] },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  });

  const example = prepared.blocks.find((block) => block.id === 'generated-example-1');
  assert.deepEqual(example?.paragraphs, ['Менеджер задаёт вопросы и отправляет материалы, но в записи не слышно следующего шага. Дальше нужен разбор.']);
});

function sampleRequest(): PipelineRequest {
  const now = new Date().toISOString();
  return {
    id: 'A-TEST',
    status: 'assembling',
    brief: {
      inputType: 'planned_topic',
      title: 'Техники продаж',
      cluster: 'техники продаж',
      materialKind: 'guide',
      goal: 'Explain topic.',
      knownFacts: 'Slug: tehniki-prodazh\nURL: /guides/tehniki-prodazh\nRole: hub\nSection: tehnika',
      forbiddenMentions: 'none',
      internalLinks: '/guides\n/cases\n/guides/tehniki-prodazh',
    },
    createdAt: now,
    updatedAt: now,
    createdBy: { source: 'system' },
    notes: [],
  };
}

function sampleFacts(): FactPackage {
  return {
    requestId: 'A-TEST',
    topicOccupied: true,
    sources: [{ id: 'S1', url: 'https://example.com/report', title: 'Official source', retrievedAt: '2026-08-09T12:00:00.000Z', reliability: 'official' }],
    claims: [{ id: 'F1', claim: 'Claim.', sourceIds: ['S1'], allowedInFinal: true }],
    gaps: [],
    createdAt: '2026-08-09T12:00:00.000Z',
  };
}

function sampleStructure(): MaterialStructure {
  return {
    requestId: 'A-TEST',
    materialKind: 'guide',
    title: 'Техники продаж: полный разбор для отдела продаж',
    seoTitle: 'Техники продаж: полный разбор для отдела продаж с длинным хвостом',
    description: 'Очень длинное описание материала о техниках продаж, которое специально должно быть аккуратно укорочено до лимита сайта без ручного участия редактора и без отдельного агента.',
    sections: [],
    requiredBlocks: ['lead', 'faq'],
    createdAt: '2026-08-09T12:00:00.000Z',
  };
}

function sampleDraft(): DraftDoc {
  return {
    meta: { title: 'Техники продаж', seoTitle: '', description: '', slug: '', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про техники продаж и практику применения в отделе.' },
      { id: 'faq', type: 'faq', items: [] },
      { id: 'cta', type: 'cta', title: 'CTA' },
    ],
  };
}

function productLinkPositions(blocks: DraftDoc['blocks']): number[] {
  const productLinks = new Set(['/', '/product/call-scoring', '/product/candidate-scoring', '/product/ai-coach', '/product/analytics', '/chat-training', '/meet', '/play', '/on-premise', '/pricing']);
  const bodyBlocks = blocks.map((block, index) => ({ block, index })).filter(({ block }) => !['lead', 'visual_slot', 'related', 'faq', 'sources', 'cta'].includes(block.type));
  const denominator = Math.max(1, bodyBlocks.length - 1);
  return bodyBlocks.flatMap(({ block }, bodyIndex) => {
    const text = JSON.stringify(block);
    const hasProductLink = [...text.matchAll(/\[([^\]]+)]\((\/[^)]*)\)/g)].some((match) => productLinks.has(match[2] || ''));
    return hasProductLink ? [bodyIndex / denominator] : [];
  });
}

test('legacy preparation preserves complete lead and does not inject generic v2 editorial blocks', () => {
  const previous = process.env.CONTENT_SCHEMA_VERSION;
  process.env.CONTENT_SCHEMA_VERSION = '1';
  try {
    const draft = sampleDraft();
    const lead = draft.blocks.find((b) => b.type === 'lead');
    assert.ok(lead);
    lead.text = 'Карта этапов помогает проверить следующий шаг сделки и найти конкретный момент, на котором разговор перестал продвигаться. Условие перехода проверяют по словам клиента и договорённости о следующем действии, сохраняя контекст разговора. Для каждой записи руководитель отмечает подтверждённую потребность, открытые вопросы и результат обсуждения.';
    const before = lead.text;
    const prepared = prepareSeoForPublication(sampleRequest(), sampleFacts(), sampleStructure(), draft);
    assert.equal(prepared.blocks.find((b) => b.type === 'lead')?.text, before);
    assert.equal(prepared.blocks.some((b) => String(b.id).startsWith('generated-example') || b.type === 'expert' || b.type === 'takeaways'), false);
  } finally {
    if (previous === undefined) delete process.env.CONTENT_SCHEMA_VERSION;
    else process.env.CONTENT_SCHEMA_VERSION = previous;
  }
});
