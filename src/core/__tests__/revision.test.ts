import assert from 'node:assert/strict';
import test from 'node:test';
import { createRevisionPacket, revisionNote } from '../revision.js';

test('revision packet routes blocking review issues to the owning agent', () => {
  const packet = createRevisionPacket({
    requestId: 'A-TEST',
    source: 'llm_review',
    issues: [
      { code: 'unsupported_number', severity: 'error', owner: 'facts', message: 'Number has no source.', path: 'blocks[2].text' },
      { code: 'weak_wording', severity: 'warning', owner: 'writer', message: 'Wording is weak.' },
    ],
  });

  assert.ok(packet);
  assert.equal(packet.targetStatus, 'needs_facts');
  assert.equal(packet.targetOwner, 'facts');
  assert.equal(packet.attempt, 1);
  assert.match(revisionNote(packet), /unsupported_number/);
});
