import assert from 'node:assert/strict';
import test from 'node:test';
import type { DraftDoc } from '../types.js';
import { cleanupContrasts, cleanupDraftStyle } from '../style-cleanup.js';

test('style cleanup preserves clauses and simplifies additive wording', () => {
  assert.equal(cleanupContrasts('Техники работают не как рейтинг, а как инструменты для разных ситуаций.'), 'Техники работают не как рейтинг, а как инструменты для разных ситуаций.');
  assert.equal(cleanupContrasts('Это не просто теория, а способ выбрать действие.'), 'Это не просто теория, а способ выбрать действие.');
  assert.equal(cleanupContrasts('Метод помогает не только задать вопрос, но и услышать ответ.'), 'Метод помогает задать вопрос и услышать ответ.');
});

test('style cleanup keeps ids and links unchanged', () => {
  const doc: DraftDoc = {
    meta: { title: 'Title', seoTitle: 'Title', description: 'Description', slug: 'title', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Это не просто обзор, а карта техник для разных ситуаций.', sourceClaimIds: ['F1'] },
      { id: 'related', type: 'related', items: [{ href: '/guides/ne-prosto-a' }] },
    ],
  };

  const cleaned = cleanupDraftStyle(doc);
  assert.equal(cleaned.blocks[0]?.text, 'Это не просто обзор, а карта техник для разных ситуаций.');
  assert.deepEqual(cleaned.blocks[1]?.items, [{ href: '/guides/ne-prosto-a' }]);
});

test('does not erase a negative condition or join unrelated sentence fragments', () => {
  const text = 'Если клиент не готов к покупке, а менеджер предлагает закрытие, оцените этап сделки.';
  assert.equal(cleanupContrasts(text), text);
});
