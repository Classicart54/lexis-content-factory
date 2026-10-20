import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleMaterial } from '../assembler.js';
import type { DraftDoc, InfographicSpec, MaterialStructure, PipelineRequest } from '../types.js';

test('assembler inserts custom visual slots after source blocks', () => {
  const assembled = assembleMaterial(sampleRequest(), sampleStructure(), sampleDraft(), [sampleSlot()]);
  const blockIds = assembled.blocks.map((block) => block.id);

  assert.deepEqual(blockIds, ['lead', 'table', 'block-visual-slot-table', 'faq']);
  assert.equal(assembled.blocks[2]?.type, 'visual_slot');
  assert.equal(assembled.blocks[2]?.visualKind, 'pipeline');
  assert.deepEqual(assembled.blocks[2]?.items, [{ title: 'Шаг один' }, { title: 'Шаг два' }, { title: 'Шаг три' }]);
  assert.equal(assembled.blocks[2]?.brief, undefined);
  assert.equal(assembled.blocks[2]?.dataContract, undefined);
  assert.equal(assembled.blocks[2]?.forbiddenAdditions, undefined);
  assert.equal(assembled.blocks[2]?.sourceBlockId, 'table');
  assert.equal(assembled.meta.visualSlots, 1);
});

function sampleRequest(): PipelineRequest {
  const now = new Date().toISOString();
  return {
    id: 'A-TEST',
    status: 'assembling',
    brief: {
      inputType: 'planned_topic',
      title: 'Test topic',
      cluster: 'test',
      materialKind: 'guide',
      goal: 'Test assembly.',
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

function sampleStructure(): MaterialStructure {
  return {
    requestId: 'A-TEST',
    materialKind: 'guide',
    title: 'Test topic',
    seoTitle: 'Test topic',
    description: 'Description.',
    sections: [],
    requiredBlocks: ['lead', 'faq'],
    createdAt: new Date().toISOString(),
  };
}

function sampleDraft(): DraftDoc {
  return {
    meta: { title: 'Test topic', seoTitle: 'Test topic', description: 'Description.', slug: 'test-topic', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Lead text.' },
      { id: 'table', type: 'table', heading: 'Table', rows: [['A', 'B']] },
      { id: 'faq', type: 'faq', items: [] },
    ],
  };
}

function sampleSlot(): InfographicSpec {
  return {
    id: 'visual-slot-table',
    title: 'Visual slot',
    kind: 'visual_slot',
    visualKind: 'pipeline',
    status: 'derivable',
    sourceBlockId: 'table',
    renderMode: 'custom_visual_slot',
    blockType: 'slot',
    data: { items: [{ title: 'Шаг один' }, { title: 'Шаг два' }, { title: 'Шаг три' }] },
    items: [{ title: 'Шаг один' }, { title: 'Шаг два' }, { title: 'Шаг три' }],
    sourceClaimIds: [],
    visualSlot: {
      placement: 'after_block',
      afterBlockId: 'table',
      brief: 'Draw a custom visual from the table.',
      dataContract: ['Use only table data.', 'Do not add facts.'],
      allowedData: ['rows'],
      forbiddenAdditions: ['new facts'],
      visualGoal: 'Make table easier to scan.',
      tone: 'editorial',
      designFreedom: 'custom_composition',
    },
  };
}
