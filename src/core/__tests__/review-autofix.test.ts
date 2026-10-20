import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReviewAutofixes, canAutofixReviewIssues } from '../review-autofix.js';
import type { DraftDoc, FactPackage, MaterialStructure, PipelineRequest } from '../types.js';

test('review autofix handles unsupported superlative wording without facts reroute', () => {
  assert.equal(canAutofixReviewIssues([
    {
      code: 'unsupported_superlative',
      severity: 'error',
      owner: 'facts',
      message: 'Фраза делает частотный вывод, которого нет в FactPackage.',
      path: 'blocks[6].items[2].text',
    },
  ]), true);
});

test('review autofix handles empty rendered blocks and weak visuals without writer rerun', () => {
  assert.equal(canAutofixReviewIssues([
    { code: 'empty_steps_block', severity: 'error', owner: 'system', message: 'Empty steps block.', path: 'blocks[3]' },
    { code: 'invalid_visual_checklist', severity: 'error', owner: 'writer', message: 'Weak visual.', path: 'blocks[6].visualSlot' },
    { code: 'broken_visual_labels', severity: 'error', owner: 'writer', message: 'Broken visual labels.', path: 'blocks[8].visualSlot.items' },
  ]), true);
});

test('review autofix treats unsupported channel generalization as removable content', () => {
  assert.equal(canAutofixReviewIssues([
    { code: 'unsupported_channel_generalization', severity: 'error', owner: 'facts', message: 'Unsupported channel generalization.', path: 'blocks[10].items[9].a' },
  ]), true);
});

test('review autofix treats unsupported grouping as removable content', () => {
  assert.equal(canAutofixReviewIssues([
    { code: 'unsupported_4_step_grouping', severity: 'error', owner: 'facts', message: 'Unsupported grouping explanation.', path: 'blocks[1].text' },
  ]), true);
});

test('review autofix removes visual slot when broken text points inside visualSlot', () => {
  const issues = [
    { code: 'broken_text', severity: 'error', owner: 'writer', message: 'Подписи в visual_slot обрезаны.', path: 'blocks[2].visualSlot.items' },
  ] as const;
  assert.equal(canAutofixReviewIssues([...issues]), true);

  const fixed = applyReviewAutofixes(sampleRequest(), sampleFacts(), sampleStructure(), sampleDraft(), [...issues]);

  assert.equal(fixed.blocks.some((block) => block.id === 'weak-visual'), false);
});

function sampleRequest(): PipelineRequest {
  const now = new Date().toISOString();
  return {
    id: 'A-TEST',
    status: 'llm_review',
    brief: {
      inputType: 'planned_topic',
      title: 'Как обучать менеджеров B2B-продажам?',
      cluster: 'обучение b2b продажам',
      materialKind: 'guide',
      goal: 'Проверить автофикс visual_slot.',
      knownFacts: 'Slug: obuchenie-b2b-prodazham\nURL: /guides/obuchenie-b2b-prodazham\nSection: b2b',
      forbiddenMentions: 'none',
      internalLinks: '/guides /cases',
    },
    createdAt: now,
    updatedAt: now,
    createdBy: { source: 'system' },
    notes: [],
  };
}

function sampleFacts(): FactPackage {
  const now = new Date().toISOString();
  return {
    requestId: 'A-TEST',
    topicOccupied: true,
    sources: [{ id: 'S1', url: 'https://example.com', title: 'Source', retrievedAt: now, reliability: 'official' }],
    claims: [{ id: 'F1', claim: 'Supported claim.', sourceIds: ['S1'], allowedInFinal: true }],
    gaps: [],
    createdAt: now,
  };
}

function sampleStructure(): MaterialStructure {
  return {
    requestId: 'A-TEST',
    materialKind: 'guide',
    title: 'Title',
    seoTitle: 'Title',
    description: 'Description',
    requiredBlocks: ['lead', 'section', 'faq'],
    sections: [{ id: 'body', blockType: 'prose', purpose: 'Explain.', requiredClaimIds: ['F1'] }],
    createdAt: new Date().toISOString(),
  };
}

function sampleDraft(): DraftDoc {
  return {
    meta: { title: 'Title', seoTitle: 'Title', description: 'Description', slug: 'title', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Лид материала про обучение B2B-продажам и проверку навыков в диалоге.', sourceClaimIds: ['F1'] },
      { id: 'body', type: 'prose', paragraphs: ['Текст раздела со ссылкой на [гайды](/guides).'], sourceClaimIds: ['F1'] },
      { id: 'weak-visual', type: 'visual_slot', visualKind: 'pipeline', items: [{ title: 'Обрезанная подпись' }, { title: 'Второй шаг' }, { title: 'Третий шаг' }], sourceClaimIds: ['F1'] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: [] },
    ],
  };
}
