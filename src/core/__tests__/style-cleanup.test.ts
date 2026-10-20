import assert from 'node:assert/strict';
import test from 'node:test';
import type { DraftDoc } from '../types.js';
import { cleanupContrasts, cleanupDraftStyle } from '../style-cleanup.js';

test('style cleanup rewrites not X but Y contrasts into direct statements', () => {
  assert.equal(cleanupContrasts('Техники работают не как рейтинг, а как инструменты для разных ситуаций.'), 'Техники работают как инструменты для разных ситуаций.');
  assert.equal(cleanupContrasts('Это не просто теория, а способ выбрать действие.'), 'Это способ выбрать действие.');
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
  assert.equal(cleaned.blocks[0]?.text, 'Это карта техник для разных ситуаций.');
  assert.deepEqual(cleaned.blocks[1]?.items, [{ href: '/guides/ne-prosto-a' }]);
});
