import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReviewReport, summarizeBlockForReview } from '../neuromedia-reviewer-agent.js';
import type { DraftBlock, PipelineRequest } from '../types.js';

test('review normalization rejects approval when errors are present', () => {
  const report = normalizeReviewReport(sampleRequest(), {
    approved: true,
    issues: [{ code: 'Bad Code!', severity: 'critical' as 'error', owner: 'unknown' as 'writer', message: 'Blocking issue.' }],
    summary: 'Looks approved but has an error.',
  });

  assert.equal(report.approved, false);
  assert.equal(report.issues[0]?.code, 'review_issue_1');
  assert.equal(report.issues[0]?.severity, 'error');
  assert.equal(report.issues[0]?.owner, 'writer');
});

test('review normalization upgrades broken FAQ wording warnings to errors', () => {
  const report = normalizeReviewReport(sampleRequest(), {
    approved: true,
    issues: [{ code: 'faq_wording_error', severity: 'warning', owner: 'writer', message: 'Фраза грамматически сломана: «Если задавать их пачкой и анкету».', path: 'blocks[11].items[1].a' }],
    summary: 'Approved with a warning.',
  });

  assert.equal(report.approved, false);
  assert.equal(report.issues[0]?.severity, 'error');
});

test('review normalization keeps related href-only comments as warnings', () => {
  const report = normalizeReviewReport(sampleRequest(), {
    approved: false,
    issues: [{ code: 'review_issue_1', severity: 'error', owner: 'system', message: 'В блоке «Читайте также» элементы содержат только href без видимого текста/названия.', path: 'blocks[9].items' }],
    summary: 'Related issue.',
  });

  assert.equal(report.approved, false);
  assert.equal(report.issues[0]?.severity, 'warning');
});

test('review summary exposes renderable cards content', () => {
  const block: DraftBlock = {
    id: 'cards',
    type: 'cards',
    heading: 'Renderable cards',
    cards: [{ title: 'Card title', text: 'Card text that renders on the site.' }],
    sourceClaimIds: ['F1'],
  };

  const summary = summarizeBlockForReview(block, 3);

  assert.deepEqual(summary.cards, [{ title: 'Card title', text: 'Card text that renders on the site.' }]);
});

function sampleRequest(): PipelineRequest {
  const now = new Date().toISOString();
  return {
    id: 'A-TEST',
    status: 'llm_review',
    brief: {
      inputType: 'planned_topic',
      title: 'Test topic',
      cluster: 'test',
      materialKind: 'guide',
      goal: 'Test review.',
      knownFacts: 'none',
      forbiddenMentions: 'none',
      internalLinks: '/',
    },
    createdAt: now,
    updatedAt: now,
    createdBy: { source: 'system' },
    notes: [],
  };
}
