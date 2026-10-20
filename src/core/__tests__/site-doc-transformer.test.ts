import assert from 'node:assert/strict';
import test from 'node:test';
import { toSiteDoc } from '../site-doc-transformer.js';
import type { DraftDoc, PipelineRequest } from '../types.js';

test('site doc transformer prepares guide docs for content API', () => {
  const doc = toSiteDoc(sampleRequest(), sampleDraft(), { model: 'gpt-5.5' });

  assert.equal(doc.meta.kind, 'guide');
  assert.equal(doc.meta.slug, 'tehniki-prodazh');
  assert.equal(doc.meta.section, 'tehnika');
  assert.equal((doc.meta.provenance as { requestId: string; model: string }).requestId, 'A-TEST');
  assert.equal((doc.meta.provenance as { requestId: string; model: string }).model, 'gpt-5.5');
  assert.deepEqual(doc.blocks.find((block) => block.type === 'table')?.head, ['A', 'B']);
  assert.deepEqual(doc.blocks.find((block) => block.type === 'steps')?.steps, [{ title: 'Step', text: 'Do it.' }]);
  assert.deepEqual(doc.blocks.filter((block) => block.type === 'table')[1]?.head, ['Goal', 'Technique']);
});

function sampleRequest(): PipelineRequest {
  const now = new Date().toISOString();
  return {
    id: 'A-TEST',
    status: 'approved',
    brief: {
      inputType: 'planned_topic',
      title: 'Какие бывают техники продаж?',
      cluster: 'техники продаж',
      materialKind: 'guide',
      goal: 'Answer topic.',
      knownFacts: 'Slug: tehniki-prodazh\nURL: /guides/tehniki-prodazh\nSection: tehnika',
      forbiddenMentions: 'none',
      internalLinks: '/',
    },
    createdAt: now,
    updatedAt: now,
    createdBy: { source: 'system' },
    notes: [],
  };
}

function sampleDraft(): DraftDoc {
  return {
    meta: { title: 'Title', seoTitle: 'SEO title', description: 'Description.', slug: 'tehniki-prodazh', author: { name: 'Команда Lexis Voice', kind: 'organization' } },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Lead.' },
      { id: 'table', type: 'table', columns: ['A', 'B'], rows: [['1', '2']] },
      { id: 'matrix', type: 'matrix', head: ['Goal', 'Technique'], rows: [['Attention', 'AIDA']] },
      { id: 'steps', type: 'steps', items: [{ title: 'Step', text: 'Do it.' }] },
    ],
  };
}

test('legacy format preserves examples, takeaways and expert attribution', async () => {
  const { toLegacySiteDoc } = await import('../site-doc-transformer.js');
  const doc = toLegacySiteDoc({ meta: {}, blocks: [
    { id: 'example', type: 'example', heading: 'Ситуация', paragraphs: ['Слова клиента'], items: [{ title: 'Ответ', text: 'Слова менеджера' }] },
    { id: 'takeaways', type: 'takeaways', items: ['Вывод'] },
    { id: 'expert', type: 'expert', name: 'Эксперт', role: 'Роль', text: 'Цитата' },
  ] });
  assert.deepEqual(doc.blocks.map((b) => b.type), ['prose', 'prose', 'quote']);
  assert.deepEqual(doc.blocks[0].paragraphs, ['Слова клиента', 'Ответ: Слова менеджера']);
  assert.equal(doc.blocks[2].author, 'Эксперт');
});
