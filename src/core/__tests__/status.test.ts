import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTransition, canTransition, nextRevisionStatus } from '../status.js';

test('allows documented automatic transitions', () => {
  assert.equal(canTransition('brief_draft', 'needs_facts'), true);
  assert.equal(canTransition('machine_review', 'llm_review'), true);
  assert.equal(canTransition('approved', 'published'), true);
  assert.equal(canTransition('approved', 'needs_writer_revision'), true);
});

test('rejects skipping deterministic validation before review', () => {
  assert.equal(canTransition('ready_for_assembly', 'llm_review'), false);
  assert.throws(() => assertTransition('ready_for_assembly', 'llm_review'), /Illegal pipeline transition/);
});

test('routes validation issues to the owning agent', () => {
  assert.equal(nextRevisionStatus([{ code: 'missing_source', severity: 'error', owner: 'facts', message: 'Missing source.' }]), 'needs_facts');
  assert.equal(nextRevisionStatus([{ code: 'bad_block', severity: 'error', owner: 'structure', message: 'Bad block.' }]), 'needs_structure_revision');
  assert.equal(nextRevisionStatus([{ code: 'short_text', severity: 'error', owner: 'writer', message: 'Short text.' }]), 'needs_writer_revision');
  assert.equal(nextRevisionStatus([{ code: 'note', severity: 'warning', owner: 'writer', message: 'Warning only.' }]), 'llm_review');
});
test('publication autofix can re-run machine validation', () => {
  // ⚠️ При 422 от Content API автофикс правит артефакт и прогоняет машинную
  // приёмку заново, не гоняя writer. Без этого перехода прогон падал с
  // «Illegal pipeline transition: approved -> machine_review».
  assert.equal(canTransition('approved', 'machine_review'), true);
  assert.equal(canTransition('approved', 'published'), true);
});
