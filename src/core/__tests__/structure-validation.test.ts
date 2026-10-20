import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStructure } from '../structure-validation.js';
import type { FactPackage, MaterialStructure, PipelineRequest } from '../types.js';

test('structure validation accepts a complete guide structure', () => {
  const request = sampleRequest('guide');
  const facts = sampleFacts(request.id);
  const structure: MaterialStructure = {
    requestId: request.id,
    materialKind: 'guide',
    title: 'Guide title',
    seoTitle: 'Guide title',
    description: 'Short description.',
    requiredBlocks: ['lead', 'prose', 'faq', 'cta'],
    thesis: 'One clear thesis.',
    sections: [
      { id: 'lead', blockType: 'lead', purpose: 'Answer the question.', requiredClaimIds: ['F1'], targetWords: 80 },
      { id: 'context', blockType: 'prose', title: 'Почему это важно?', purpose: 'Explain context.', requiredClaimIds: ['F1', 'F2'], targetWords: 220 },
      { id: 'criteria', blockType: 'points', title: 'Какие критерии проверить?', purpose: 'Explain criteria.', requiredClaimIds: ['F1'], targetWords: 180 },
      { id: 'process', blockType: 'steps', title: 'Как это внедрить?', purpose: 'Explain process.', requiredClaimIds: ['F1'], targetWords: 240 },
      { id: 'data', blockType: 'table', title: 'Что сравнить перед запуском?', purpose: 'Show data.', requiredClaimIds: ['F2'], targetWords: 160 },
      { id: 'limits', blockType: 'prose', title: 'Когда подход не подходит?', purpose: 'Explain limits.', requiredClaimIds: ['F2'], targetWords: 220 },
      { id: 'verdict', blockType: 'verdict', title: 'Что выбрать в итоге?', purpose: 'Summarize thesis.', requiredClaimIds: ['F1', 'F2'], targetWords: 160 },
      { id: 'faq', blockType: 'faq', purpose: 'Plan FAQ.', requiredClaimIds: ['F1'], targetWords: 300, plannedQuestions: Array.from({ length: 8 }, (_, index) => `Вопрос ${index + 1}?`) },
      { id: 'cta', blockType: 'cta', purpose: 'Topic-specific next action.', requiredClaimIds: [], targetWords: 80 },
    ],
    plannedCta: { purpose: 'Topic-specific next action.' },
    createdAt: new Date().toISOString(),
  };

  assert.deepEqual(validateStructure(request, facts, structure), []);
});

test('structure validation rejects malformed compare structure', () => {
  const request = sampleRequest('compare');
  const facts = sampleFacts(request.id);
  const structure: MaterialStructure = {
    requestId: request.id,
    materialKind: 'compare',
    title: 'Compare title',
    seoTitle: 'Compare title',
    description: 'Short description.',
    requiredBlocks: ['lead', 'table', 'fork', 'verdict', 'faq', 'cta'],
    sections: [
      { id: 'intro', blockType: 'prose', title: 'Intro', purpose: 'Wrong first block.', requiredClaimIds: ['F-UNKNOWN'], targetWords: 100 },
      { id: 'lead', blockType: 'lead', purpose: 'Late lead.', requiredClaimIds: [], targetWords: 80 },
      { id: 'faq', blockType: 'faq', purpose: 'Too few questions.', requiredClaimIds: ['F1'], targetWords: 100, plannedQuestions: ['Один вопрос?'] },
    ],
    missingFacts: ['Need competitor pricing source.'],
    createdAt: new Date().toISOString(),
  };

  const codes = validateStructure(request, facts, structure).map((issue) => issue.code);

  assert.ok(codes.includes('structure_invalid_lead'));
  assert.ok(codes.includes('structure_unknown_fact'));
  assert.ok(codes.includes('structure_missing_required_block'));
  assert.ok(codes.includes('structure_target_words_low'));
  assert.ok(codes.includes('structure_faq_too_short'));
  assert.ok(codes.includes('structure_compare_block_missing'));
  assert.ok(codes.includes('structure_missing_facts'));
});

function sampleRequest(kind: 'guide' | 'compare'): PipelineRequest {
  const now = new Date().toISOString();
  return {
    id: 'A-TEST',
    status: 'structuring',
    brief: {
      inputType: 'planned_topic',
      title: 'Test topic',
      cluster: 'voice ai',
      materialKind: kind,
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

function sampleFacts(requestId: string): FactPackage {
  const now = new Date().toISOString();
  return {
    requestId,
    topicOccupied: true,
    createdAt: now,
    gaps: [],
    sources: [{ id: 'S1', url: 'https://example.com', title: 'Source', publisher: 'Example', retrievedAt: now, snapshotText: 'Quote with enough detail for the claim.', reliability: 'expert' }],
    claims: [
      { id: 'F1', claim: 'Claim one.', sourceIds: ['S1'], allowedInFinal: true, quote: 'Quote with enough detail for the claim.', confidence: 'high' },
      { id: 'F2', claim: 'Claim two.', sourceIds: ['S1'], allowedInFinal: true, quote: 'Quote with enough detail for the claim.', confidence: 'high' },
    ],
  };
}
