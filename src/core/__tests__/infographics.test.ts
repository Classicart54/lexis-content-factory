import assert from 'node:assert/strict';
import test from 'node:test';
import { runDeterministicInfographicsAgent } from '../deterministic-infographics-agent.js';
import { removeWeakVisualSlots, validateInfographics } from '../infographics-validation.js';
import type { DraftDoc, FactPackage, InfographicSpec, PipelineRequest } from '../types.js';

test('deterministic infographics creates visual specs and custom visual slots from data blocks', () => {
  const specs = runDeterministicInfographicsAgent(sampleRequest(), sampleFacts(), sampleDraft());
  const kinds = specs.map((spec) => spec.kind);

  assert.ok(kinds.includes('hero_compare'));
  assert.ok(kinds.includes('visual_slot'));
  assert.ok(kinds.includes('howto_steps'));
  assert.ok(kinds.includes('criteria_points'));
  assert.ok(specs.some((spec) => spec.kind === 'visual_slot' && spec.visualSlot?.designFreedom === 'custom_composition'));
  assert.ok(specs.some((spec) => spec.kind === 'visual_slot' && spec.visualKind === 'pipeline'));
  assert.ok(specs.some((spec) => spec.kind === 'visual_slot' && spec.visualKind === 'checklist'));
  assert.equal(JSON.stringify(specs).includes('[object Object]'), false);
  assert.ok(specs.some((spec) => spec.kind === 'visual_slot' && spec.visualSlot?.forbiddenAdditions?.includes('new facts')));
  assert.deepEqual(validateInfographics(sampleFacts(), sampleDraft(), specs), []);
});

test('infographics validation catches invalid references', () => {
  const specs: InfographicSpec[] = [
    {
      id: 'bad-visual',
      title: 'Bad visual',
      kind: 'visual_slot',
      visualKind: 'pipeline',
      status: 'derivable',
      sourceBlockId: 'missing-block',
      renderMode: 'template',
      blockType: 'slot',
      data: {},
      sourceClaimIds: ['F-UNKNOWN'],
    },
  ];

  const codes = validateInfographics(sampleFacts(), sampleDraft(), specs).map((issue) => issue.code);

  assert.ok(codes.includes('visual_unknown_block'));
  assert.ok(codes.includes('visual_unknown_claim'));
  assert.ok(codes.includes('visual_empty_data'));
  assert.ok(codes.includes('visual_slot_bad_mode'));
  assert.ok(codes.includes('visual_bad_item_count'));
});

test('infographics validation requires strict visual slot placement and labels', () => {
  const specs: InfographicSpec[] = [
    {
      id: 'weak-slot',
      title: 'Weak slot',
      kind: 'visual_slot',
      visualKind: 'checklist',
      status: 'derivable',
      sourceBlockId: 'table',
      renderMode: 'custom_visual_slot',
      blockType: 'slot',
      data: { rows: [['One', 'Two']] },
      items: [{ text: 'Слишком длинная подпись которая точно не должна проходить машинную проверку', ok: true }, { text: 'Коротко', ok: true }],
      sourceClaimIds: ['F1'],
      visualSlot: {
        placement: 'after_block',
        afterBlockId: 'steps',
        brief: '',
        dataContract: ['Use data.'],
        designFreedom: 'custom_composition',
      },
    },
  ];

  const codes = validateInfographics(sampleFacts(), sampleDraft(), specs).map((issue) => issue.code);

  assert.ok(codes.includes('visual_slot_bad_placement'));
  assert.ok(codes.includes('visual_label_too_long'));
});

test('infographics validation rejects repeated pipeline tags and long notes', () => {
  const specs: InfographicSpec[] = [
    {
      id: 'bad-pipeline',
      title: 'Bad pipeline',
      kind: 'visual_slot',
      visualKind: 'pipeline',
      status: 'derivable',
      sourceBlockId: 'steps',
      renderMode: 'custom_visual_slot',
      blockType: 'slot',
      data: { items: [] },
      items: [
        { title: 'One', note: 'one two three four five six seven eight nine ten eleven', tag: 'SPIN' },
        { title: 'Two', note: 'short note', tag: 'SPIN' },
        { title: 'Three', note: 'short note', tag: 'SPIN' },
      ],
      sourceClaimIds: ['F1'],
    },
  ];

  const codes = validateInfographics(sampleFacts(), sampleDraft(), specs).map((issue) => issue.code);
  assert.ok(codes.includes('visual_pipeline_title_length'));
  assert.ok(codes.includes('visual_pipeline_note_too_long'));
  assert.ok(codes.includes('visual_repeated_tag'));
});

test('infographics validation rejects checklist without pass/fail contrast and repeated pipelines', () => {
  const specs: InfographicSpec[] = [
    {
      id: 'checklist-all-ok',
      title: 'Checklist',
      kind: 'visual_slot',
      visualKind: 'checklist',
      status: 'derivable',
      sourceBlockId: 'points',
      renderMode: 'custom_visual_slot',
      blockType: 'slot',
      data: { items: [] },
      items: [{ text: 'Норма', ok: true }, { text: 'Тоже норма', ok: true }],
      sourceClaimIds: ['F1'],
    },
    {
      id: 'pipeline-a',
      title: 'Pipeline A',
      kind: 'visual_slot',
      visualKind: 'pipeline',
      status: 'derivable',
      sourceBlockId: 'steps',
      renderMode: 'custom_visual_slot',
      blockType: 'slot',
      data: { items: [] },
      items: [{ title: 'Шаг один' }, { title: 'Шаг два' }, { title: 'Шаг три' }],
      sourceClaimIds: ['F1'],
    },
    {
      id: 'pipeline-b',
      title: 'Pipeline B',
      kind: 'visual_slot',
      visualKind: 'pipeline',
      status: 'derivable',
      sourceBlockId: 'steps',
      renderMode: 'custom_visual_slot',
      blockType: 'slot',
      data: { items: [] },
      items: [{ title: 'Шаг один' }, { title: 'Шаг два' }, { title: 'Шаг три' }],
      sourceClaimIds: ['F1'],
    },
  ];

  const codes = validateInfographics(sampleFacts(), sampleDraft(), specs).map((issue) => issue.code);
  assert.ok(codes.includes('visual_checklist_no_contrast'));
  assert.ok(codes.includes('visual_too_many_pipelines'));
});

test('weak visual slot sanitizer removes decorative checklist and extra pipelines', () => {
  const specs: InfographicSpec[] = [
    weakChecklistSpec(),
    { ...pipelineSpec('pipeline-a'), sourceBlockId: 'steps' },
    { ...pipelineSpec('pipeline-b'), sourceBlockId: 'steps' },
    { ...pipelineSpec('legacy-template'), kind: 'howto_steps', visualKind: undefined, renderMode: 'template', blockType: 'steps' },
  ];
  const issues = validateInfographics(sampleFacts(), sampleDraft(), specs);
  const next = removeWeakVisualSlots(specs, issues);

  assert.equal(next.some((spec) => spec.id === 'checklist-all-ok'), false);
  assert.equal(next.filter((spec) => spec.kind === 'visual_slot' && spec.visualKind === 'pipeline').length, 1);
  assert.equal(next.some((spec) => spec.id === 'legacy-template'), true);
});

test('deterministic infographics removes repeated pipeline tags and normalizes one-word titles', () => {
  const specs = runDeterministicInfographicsAgent(sampleRequest(), sampleFacts(), {
    meta: { title: 'Title', seoTitle: 'Title', description: 'Description', slug: 'title', author: 'Lexis Voice' },
    blocks: [
      { id: 'steps', type: 'steps', heading: 'Этапы процесса', items: [{ title: 'One', tag: 'SPIN' }, { title: 'Two', tag: 'SPIN' }, { title: 'Three', tag: 'SPIN' }], sourceClaimIds: ['F1'] },
    ],
  });
  const slot = specs.find((spec) => spec.kind === 'visual_slot' && spec.visualKind === 'pipeline');
  assert.ok(slot);
  assert.deepEqual(slot.items, [{ title: 'Шаг 1', note: '', tag: undefined }, { title: 'Шаг 2', note: '', tag: undefined }, { title: 'Шаг 3', note: '', tag: undefined }]);
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
      goal: 'Test visuals.',
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

function sampleFacts(): FactPackage {
  const now = new Date().toISOString();
  return {
    requestId: 'A-TEST',
    topicOccupied: true,
    createdAt: now,
    gaps: [],
    sources: [{ id: 'S1', url: 'https://example.com', title: 'Source', publisher: 'Example', retrievedAt: now, reliability: 'expert' }],
    claims: [{ id: 'F1', claim: 'Claim.', sourceIds: ['S1'], allowedInFinal: true, confidence: 'high', quote: 'Quote.' }],
  };
}

function weakChecklistSpec(): InfographicSpec {
  return {
    id: 'checklist-all-ok',
    title: 'Checklist',
    kind: 'visual_slot',
    visualKind: 'checklist',
    status: 'derivable',
    sourceBlockId: 'points',
    renderMode: 'custom_visual_slot',
    blockType: 'slot',
    data: { items: [] },
    items: [{ text: 'Норма', ok: true }, { text: 'Тоже норма', ok: true }],
    sourceClaimIds: ['F1'],
  };
}

function pipelineSpec(id: string): InfographicSpec {
  return {
    id,
    title: id,
    kind: 'visual_slot',
    visualKind: 'pipeline',
    status: 'derivable',
    sourceBlockId: 'steps',
    renderMode: 'custom_visual_slot',
    blockType: 'slot',
    data: { items: [] },
    items: [{ title: 'Шаг один' }, { title: 'Шаг два' }, { title: 'Шаг три' }],
    sourceClaimIds: ['F1'],
  };
}

function sampleDraft(): DraftDoc {
  return {
    meta: { title: 'Title', seoTitle: 'Title', description: 'Description', slug: 'title', author: 'Lexis Voice' },
    blocks: [
      { id: 'table', type: 'table', heading: 'Table', head: ['Критерий', 'A', 'B'], rows: [['One', 'A1', 'B1'], ['Two', 'A2', 'B2'], ['Three', 'A3', 'B3']], sourceClaimIds: ['F1'] },
      { id: 'steps', type: 'steps', heading: 'Этапы процесса', items: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }], sourceClaimIds: ['F1'] },
      { id: 'points', type: 'points', heading: 'Риски и норма', items: [{ title: 'Есть причина звонка' }, { title: 'Нет следующего шага' }, { title: 'Риск длинного монолога' }, { title: 'Понятный вопрос' }], sourceClaimIds: ['F1'] },
    ],
  };
}
