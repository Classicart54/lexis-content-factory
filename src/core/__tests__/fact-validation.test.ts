import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFactPackage } from '../fact-validation.js';
import type { FactPackage, PipelineRequest } from '../types.js';

test('fact validation accepts sourced claims with quotes', () => {
  const request = sampleRequest();
  const facts: FactPackage = {
    requestId: request.id,
    topicOccupied: true,
    createdAt: new Date().toISOString(),
    angle: 'The useful angle is to separate product promises from external market facts.',
    gaps: [],
    sources: [1, 2, 3].map((index) => ({
      id: `S${index}`,
      url: `https://example.com/source-${index}`,
      title: `Source ${index}`,
      publisher: 'Example',
      retrievedAt: new Date().toISOString(),
      snapshotText: 'Direct quote with enough detail to support the claim.',
      reliability: 'expert',
    })),
    claims: [1, 2, 3].map((index) => ({
      id: `F${index}`,
      claim: `Supported claim ${index}.`,
      sourceIds: [`S${index}`],
      allowedInFinal: true,
      kind: 'method',
      quote: 'Direct quote with enough detail to support the claim.',
      confidence: 'high',
    })),
  };

  assert.deepEqual(validateFactPackage(request, facts), []);
});

test('fact validation rejects claims without quotes and usable sources', () => {
  const request = sampleRequest();
  const facts: FactPackage = {
    requestId: request.id,
    topicOccupied: false,
    createdAt: new Date().toISOString(),
    gaps: ['No reliable source found.'],
    sources: [{ id: 'S1', url: 'example.com?utm_source=chatgpt', title: 'Bad source', retrievedAt: new Date().toISOString(), reliability: 'unknown' }],
    claims: [{ id: 'F1', claim: 'Unsupported claim.', sourceIds: ['S2'], allowedInFinal: true, confidence: 'low' }],
  };

  const codes = validateFactPackage(request, facts).map((issue) => issue.code);

  assert.ok(codes.includes('topic_occupancy_missing'));
  assert.ok(codes.includes('facts_too_few_claims'));
  assert.ok(codes.includes('source_url_invalid'));
  assert.ok(codes.includes('source_tracking_params'));
  assert.ok(codes.includes('source_publisher_missing'));
  assert.ok(codes.includes('source_quote_missing'));
  assert.ok(codes.includes('claim_unknown_source'));
  assert.ok(codes.includes('claim_quote_missing'));
  assert.ok(codes.includes('claim_low_confidence'));
});

function sampleRequest(): PipelineRequest {
  const now = new Date().toISOString();
  return {
    id: 'A-TEST',
    status: 'needs_facts',
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
