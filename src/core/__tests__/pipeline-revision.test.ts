import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ArtifactStore } from '../artifact-store.js';
import { ContentPipeline } from '../pipeline.js';
import type { AgentPorts, DraftDoc, FactPackage, MaterialStructure, PipelineRequest, RevisionPacket, ValidationReport } from '../types.js';

test('pipeline stores reviewer issues as a revision packet and routes to writer', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'lexis-pipeline-revision-'));
  try {
    const store = new ArtifactStore(dataDir);
    const pipeline = new ContentPipeline(store, revisionAgents());
    const request = await pipeline.createRequest({
      brief: {
        inputType: 'planned_topic',
        title: 'Test topic',
        cluster: 'test',
        materialKind: 'guide',
        goal: 'Test revision routing.',
        knownFacts: 'none',
        forbiddenMentions: 'none',
        internalLinks: '/',
      },
    });

    const facts = sampleFacts(request.id);
    const draft = sampleDraft();
    await store.writeArtifact(request.id, 'facts', facts);
    await store.writeArtifact(request.id, 'structure', sampleStructure(request.id));
    await store.writeArtifact(request.id, 'draft', draft);
    await store.writeArtifact(request.id, 'assembled', draft);
    await store.writeArtifact(request.id, 'validationReport', sampleValidationReport(request.id));
    await store.updateRequest({ ...request, status: 'llm_review' });

    const routed = await pipeline.runNext(request.id);
    const artifacts = await store.readArtifacts(request.id);

    assert.equal(routed.status, 'needs_writer_revision');
    assert.ok(artifacts.revision);
    assert.equal((artifacts.revision as RevisionPacket).targetOwner, 'writer');
    assert.match(routed.notes.at(-1) || '', /weak_generic_advice/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('pipeline applies autofixable review issues without rerunning writer', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'lexis-pipeline-autofix-'));
  try {
    const store = new ArtifactStore(dataDir);
    const agents = autofixAgents();
    const pipeline = new ContentPipeline(store, agents);
    const request = await pipeline.createRequest({
      brief: {
        inputType: 'planned_topic',
        title: 'Test topic',
        cluster: 'test',
        materialKind: 'guide',
        goal: 'Test autofix routing.',
        knownFacts: 'Slug: test-topic\nURL: /guides/test-topic',
        forbiddenMentions: 'none',
        internalLinks: '/ /product/call-scoring /play /cases /guides',
      },
    });

    const facts = sampleFacts(request.id);
    const draft = sampleReviewDraft();
    await store.writeArtifact(request.id, 'facts', facts);
    await store.writeArtifact(request.id, 'structure', sampleStructure(request.id));
    await store.writeArtifact(request.id, 'draft', draft);
    await store.writeArtifact(request.id, 'assembled', draft);
    await store.writeArtifact(request.id, 'validationReport', sampleValidationReport(request.id));
    await store.updateRequest({ ...request, status: 'llm_review' });

    const routed = await pipeline.runNext(request.id);
    const artifacts = await store.readArtifacts(request.id);

    assert.notEqual(routed.status, 'needs_writer_revision');
    assert.ok(artifacts.assembled);
    assert.equal(artifacts.assembled.blocks.some((block) => block.id === 'weak-visual'), false);
    assert.equal((agents as ReturnType<typeof autofixAgents>).writerCalls, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('pipeline approves warning-only review instead of looping in llm_review', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'lexis-pipeline-review-warnings-'));
  try {
    const store = new ArtifactStore(dataDir);
    const pipeline = new ContentPipeline(store, warningOnlyAgents());
    const request = await pipeline.createRequest({
      brief: {
        inputType: 'planned_topic',
        title: 'Test topic',
        cluster: 'test',
        materialKind: 'guide',
        goal: 'Test warning-only review.',
        knownFacts: 'Slug: test-topic\nURL: /guides/test-topic',
        forbiddenMentions: 'none',
        internalLinks: '/ /product/call-scoring /play /cases /guides',
      },
    });

    const facts = sampleFacts(request.id);
    const structure = sampleStructure(request.id);
    structure.requiredBlocks = ['lead', 'faq', 'cta', 'verdict'];
    const draft = sampleReviewDraft();
    await store.writeArtifact(request.id, 'facts', facts);
    await store.writeArtifact(request.id, 'structure', structure);
    await store.writeArtifact(request.id, 'draft', draft);
    await store.writeArtifact(request.id, 'assembled', draft);
    await store.writeArtifact(request.id, 'validationReport', sampleValidationReport(request.id));
    await store.updateRequest({ ...request, status: 'llm_review' });

    const routed = await pipeline.runNext(request.id);
    assert.equal(routed.status, 'approved');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('pipeline applies deterministic validation autofix before routing to writer', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'lexis-pipeline-validation-autofix-'));
  try {
    const store = new ArtifactStore(dataDir);
    const agents = autofixAgents();
    const pipeline = new ContentPipeline(store, agents);
    const request = await pipeline.createRequest({
      brief: {
        inputType: 'planned_topic',
        title: 'Test topic',
        cluster: 'test',
        materialKind: 'guide',
        goal: 'Test validation autofix routing.',
        knownFacts: 'Slug: test-topic\nURL: /guides/test-topic',
        forbiddenMentions: 'none',
        internalLinks: '/ /product/call-scoring /play /cases /guides',
      },
    });

    const facts = sampleFacts(request.id);
    const draft = sampleTooManySectionsDraft();
    await store.writeArtifact(request.id, 'facts', facts);
    await store.writeArtifact(request.id, 'structure', sampleStructure(request.id));
    await store.writeArtifact(request.id, 'draft', draft);
    await store.writeArtifact(request.id, 'assembled', draft);
    await store.updateRequest({ ...request, status: 'machine_review' });

    const routed = await pipeline.runNext(request.id);
    const artifacts = await store.readArtifacts(request.id);

    assert.equal(routed.status, 'llm_review');
    assert.equal(artifacts.validationReport?.ok, true);
    assert.equal((agents as ReturnType<typeof autofixAgents>).writerCalls, 0);
    assert.ok((artifacts.assembled?.blocks.filter((block) => ['tldr', 'prose', 'points', 'steps', 'table', 'stats', 'matrix', 'cards', 'fork', 'verdict', 'quote', 'callout'].includes(block.type)).length || 0) <= 8);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('pipeline expands a short lead without rerunning writer', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'lexis-pipeline-lead-autofix-'));
  try {
    const store = new ArtifactStore(dataDir);
    const agents = autofixAgents();
    const pipeline = new ContentPipeline(store, agents);
    const request = await pipeline.createRequest({
      brief: {
        inputType: 'planned_topic',
        title: 'Test topic',
        cluster: 'test',
        materialKind: 'guide',
        goal: 'Test lead autofix routing.',
        knownFacts: 'Slug: test-topic\nURL: /guides/test-topic',
        forbiddenMentions: 'none',
        internalLinks: '/ /product/call-scoring /play /cases /guides',
      },
    });

    const facts = sampleFacts(request.id);
    const draft = sampleReviewDraft();
    draft.blocks = draft.blocks.filter((block) => block.id !== 'weak-visual');
    draft.blocks.push({ id: 'seven', type: 'prose', heading: 'Седьмой раздел', paragraphs: [Array.from({ length: 220 }, () => 'слово').join(' ')], sourceClaimIds: ['F1'] });
    draft.blocks[0] = { ...draft.blocks[0], text: 'Короткий лид отвечает на тему, но немного не добирает до нижней границы длины.' };
    await store.writeArtifact(request.id, 'facts', facts);
    await store.writeArtifact(request.id, 'structure', sampleStructure(request.id));
    await store.writeArtifact(request.id, 'draft', draft);
    await store.writeArtifact(request.id, 'assembled', draft);
    await store.updateRequest({ ...request, status: 'machine_review' });

    const routed = await pipeline.runNext(request.id);
    const artifacts = await store.readArtifacts(request.id);

    assert.equal(routed.status, 'llm_review');
    assert.equal(artifacts.validationReport?.ok, true);
    assert.ok(String(artifacts.assembled?.blocks[0]?.text || '').length >= 200);
    assert.equal((agents as ReturnType<typeof autofixAgents>).writerCalls, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('pipeline fixes publication length and accent limits without rerunning writer', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'lexis-pipeline-publication-autofix-'));
  try {
    const store = new ArtifactStore(dataDir);
    const agents = publicationLimitAgents();
    const pipeline = new ContentPipeline(store, agents);
    const request = await pipeline.createRequest({
      brief: {
        inputType: 'planned_topic',
        title: 'Test topic',
        cluster: 'test',
        materialKind: 'guide',
        goal: 'Test publication autofix routing.',
        knownFacts: 'Slug: test-topic\nURL: /guides/test-topic',
        forbiddenMentions: 'none',
        internalLinks: '/ /product/call-scoring /play /cases /guides',
      },
    });

    const facts = sampleFacts(request.id);
    const structure = sampleStructure(request.id);
    structure.requiredBlocks = ['lead', 'faq', 'cta', 'verdict'];
    const draft = sampleReviewDraft();
    draft.blocks = draft.blocks.filter((block) => block.id !== 'weak-visual');
    draft.blocks[1] = { ...draft.blocks[1], paragraphs: ['**Первое предложение уже выделено.** Второе предложение должно стать запасным местом для нового акцента. Остальной текст нужен только для проверки.', ...((draft.blocks[1].paragraphs || []) as string[])] };
    draft.blocks.push({ id: 'long-tail', type: 'prose', heading: 'Длинный хвост', paragraphs: [Array.from({ length: 760 }, () => 'слово').join(' ')], sourceClaimIds: ['F1'] });
    await store.writeArtifact(request.id, 'facts', facts);
    await store.writeArtifact(request.id, 'structure', structure);
    await store.writeArtifact(request.id, 'draft', draft);
    await store.writeArtifact(request.id, 'assembled', draft);
    await store.writeArtifact(request.id, 'validationReport', sampleValidationReport(request.id));
    await store.updateRequest({ ...request, status: 'approved' });

    const routed = await pipeline.runNext(request.id);
    const artifacts = await store.readArtifacts(request.id);
    const text = JSON.stringify(artifacts.assembled?.blocks || []);

    assert.equal(routed.status, 'machine_review');
    assert.equal(agents.writerCalls, 0);
    assert.ok(artifacts.assembled?.blocks.some((block) => block.type === 'faq'));
    assert.ok(artifacts.assembled?.blocks.some((block) => block.type === 'verdict'));
    assert.ok(artifacts.assembled?.blocks.some((block) => block.type === 'cta'));
    assert.ok(countWords(text) < 1900);
    assert.ok(countAccents(text) >= 5);
    assert.doesNotMatch(text, /\*\*\*\*/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('pipeline removes empty content blocks from review feedback without rerunning writer', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'lexis-pipeline-empty-block-autofix-'));
  try {
    const store = new ArtifactStore(dataDir);
    const agents = emptyBlockAutofixAgents();
    const pipeline = new ContentPipeline(store, agents);
    const request = await pipeline.createRequest({
      brief: {
        inputType: 'planned_topic',
        title: 'Test topic',
        cluster: 'test',
        materialKind: 'guide',
        goal: 'Test empty block autofix.',
        knownFacts: 'Slug: test-topic\nURL: /guides/test-topic',
        forbiddenMentions: 'none',
        internalLinks: '/ /product/call-scoring /play /cases /guides',
      },
    });

    const facts = sampleFacts(request.id);
    const draft = sampleReviewDraft();
    draft.blocks.splice(4, 0, { id: 'empty-cards', type: 'cards', heading: 'Пустой блок', sourceClaimIds: ['F1'] });
    await store.writeArtifact(request.id, 'facts', facts);
    await store.writeArtifact(request.id, 'structure', sampleStructure(request.id));
    await store.writeArtifact(request.id, 'draft', draft);
    await store.writeArtifact(request.id, 'assembled', draft);
    await store.writeArtifact(request.id, 'validationReport', sampleValidationReport(request.id));
    await store.updateRequest({ ...request, status: 'llm_review' });

    const routed = await pipeline.runNext(request.id);
    const artifacts = await store.readArtifacts(request.id);

    assert.equal(routed.status, 'machine_review');
    assert.equal(artifacts.assembled?.blocks.some((block) => block.id === 'empty-cards'), false);
    assert.equal((agents as ReturnType<typeof emptyBlockAutofixAgents>).writerCalls, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

function revisionAgents(): AgentPorts {
  return {
    async runSearchAgent(request) {
      return sampleFacts(request.id);
    },
    async runStructureAgent(request) {
      return sampleStructure(request.id);
    },
    async runWriterAgent() {
      return sampleDraft();
    },
    async runInfographicsAgent() {
      return [];
    },
    async runReviewAgent(request) {
      return {
        requestId: request.id,
        approved: false,
        issues: [{ code: 'weak_generic_advice', severity: 'error', owner: 'writer', message: 'Rewrite generic advice.', path: 'blocks[1].paragraphs[0]' }],
        summary: 'Writer revision required.',
        checkedAt: new Date().toISOString(),
      };
    },
    async publishMaterial(request) {
      return { requestId: request.id, ok: true, issues: [], summary: 'Published.', publishedAt: new Date().toISOString() };
    },
  };
}

function autofixAgents(): AgentPorts & { writerCalls: number } {
  return {
    writerCalls: 0,
    async runSearchAgent(request) {
      return sampleFacts(request.id);
    },
    async runStructureAgent(request) {
      return sampleStructure(request.id);
    },
    async runWriterAgent() {
      this.writerCalls += 1;
      return sampleReviewDraft();
    },
    async runInfographicsAgent() {
      return [];
    },
    async runReviewAgent(request) {
      return {
        requestId: request.id,
        approved: false,
        issues: [{ code: 'bad_visual_checklist_no_norm', severity: 'error', owner: 'writer', message: 'Weak visual slot.', path: 'blocks[2].visualSlot' }],
        summary: 'Autofixable visual issue.',
        checkedAt: new Date().toISOString(),
      };
    },
    async publishMaterial(request) {
      return { requestId: request.id, ok: true, issues: [], summary: 'Published.', publishedAt: new Date().toISOString() };
    },
  };
}

function publicationLimitAgents(): AgentPorts & { writerCalls: number } {
  const agents = autofixAgents();
  return {
    ...agents,
    async publishMaterial(request) {
      return {
        requestId: request.id,
        ok: false,
        statusCode: 422,
        issues: [
          { code: 'publication_word_count_high', severity: 'error', owner: 'writer', message: '2014 слов, максимум 2000.' },
          { code: 'publication_not_enough_accents', severity: 'error', owner: 'writer', message: 'выделений в тексте 7, нужно от 8.' },
        ],
        summary: 'Publication failed with 422: validation_failed',
        publishedAt: new Date().toISOString(),
      };
    },
  };
}

function warningOnlyAgents(): AgentPorts {
  const agents = autofixAgents();
  return {
    ...agents,
    async runReviewAgent(request) {
      return {
        requestId: request.id,
        approved: false,
        issues: [{ code: 'weak_related_relevance', severity: 'warning', owner: 'writer', message: 'Non-blocking related warning.', path: 'blocks[8].items[3]' }],
        summary: 'Only warnings remain.',
        checkedAt: new Date().toISOString(),
      };
    },
  };
}

function emptyBlockAutofixAgents(): AgentPorts & { writerCalls: number } {
  const agents = autofixAgents();
  return {
    ...agents,
    async runReviewAgent(request) {
      return {
        requestId: request.id,
        approved: false,
        issues: [
          { code: 'empty_content_block', severity: 'error', owner: 'writer', message: 'Empty block.', path: 'blocks[4]' },
          { code: 'weak_visual_slot_duplicate_steps', severity: 'error', owner: 'writer', message: 'Weak visual.', path: 'blocks[3]' },
        ],
        summary: 'Autofixable empty block and visual issues.',
        checkedAt: new Date().toISOString(),
      };
    },
  };
}

function sampleFacts(requestId: string): FactPackage {
  const now = new Date().toISOString();
  return {
    requestId,
    topicOccupied: true,
    sources: [{ id: 'S1', url: 'https://example.com', title: 'Example', publisher: 'Example', retrievedAt: now, reliability: 'expert', snapshotText: 'Quote.' }],
    claims: [{ id: 'F1', claim: 'Claim.', sourceIds: ['S1'], allowedInFinal: true, quote: 'Quote.', confidence: 'high' }],
    gaps: [],
    createdAt: now,
  };
}

function sampleStructure(requestId: string): MaterialStructure {
  return {
    requestId,
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
    blocks: [{ id: 'lead', type: 'lead', text: 'Lead text.', sourceClaimIds: ['F1'] }],
  };
}

function sampleReviewDraft(): DraftDoc {
  const paragraph = Array.from({ length: 140 }, () => 'слово').join(' ');
  return {
    meta: { title: 'Test topic', seoTitle: 'Test topic', description: 'Description.', slug: 'test-topic', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Голосовой ИИ полезен тогда, когда материал опирается на проверенные факты, понятную структуру и заранее заданные правила качества. Этот черновик показывает, как конвейер доводит тему до готового JSON без ручного согласования.', sourceClaimIds: ['F1'] },
      { id: 'one', type: 'prose', heading: 'Первый раздел', paragraphs: [`**Проверяемая фактура** помогает держать статью полезной. ${paragraph}`], sourceClaimIds: ['F1'] },
      { id: 'weak-visual', type: 'visual_slot', title: 'Слабая схема', visualKind: 'checklist', items: [{ text: 'Пункт', ok: true }, { text: 'Пункт', ok: true }], sourceClaimIds: ['F1'] },
      { id: 'two', type: 'prose', heading: 'Второй раздел', paragraphs: [`==Главный вывод== виден при быстром чтении. ${paragraph}`], sourceClaimIds: ['F1'] },
      { id: 'three', type: 'prose', heading: 'Третий раздел', paragraphs: [`**Второй акцент** фиксирует мысль. ${paragraph}`], sourceClaimIds: ['F1'] },
      { id: 'four', type: 'prose', heading: 'Четвертый раздел', paragraphs: [`==Маркер== держит норму. Это удобно проверить в [инструментах Lexis Voice](/). ${paragraph}`], sourceClaimIds: ['F1'] },
      { id: 'five', type: 'prose', heading: 'Пятый раздел', paragraphs: [paragraph], sourceClaimIds: ['F1'] },
      { id: 'six', type: 'prose', heading: 'Шестой раздел', paragraphs: [paragraph], sourceClaimIds: ['F1'] },
      { id: 'verdict', type: 'verdict', text: 'Итоговый вывод нужен для проверки, что обязательный блок не удаляется при обрезке.', sourceClaimIds: ['F1'] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: Array.from({ length: 8 }, (_, index) => ({ question: `Q${index}?`, answer: 'Длинный ответ с фактом, ограничением и понятным следующим шагом для читателя материала.' })), sourceClaimIds: ['F1'] },
      { id: 'cta', type: 'cta', title: 'Проверьте разговоры', text: 'Разберите реальные звонки и найдите, где обучение расходится с практикой.', href: '/product/call-scoring' },
      { id: 'sources', type: 'sources', items: [{ title: 'Example', url: 'https://example.com', snapshot: new Date().toISOString().slice(0, 10) }] },
    ],
  };
}

function sampleTooManySectionsDraft(): DraftDoc {
  const paragraph = Array.from({ length: 130 }, () => 'слово').join(' ');
  return {
    meta: { title: 'Test topic', seoTitle: 'Test topic', description: 'Description.', slug: 'test-topic', cluster: 'test', author: 'Lexis Voice' },
    blocks: [
      { id: 'lead', type: 'lead', text: 'Голосовой ИИ полезен тогда, когда материал опирается на проверенные факты, понятную структуру и заранее заданные правила качества. Этот черновик показывает, как конвейер доводит тему до готового JSON без ручного согласования.', sourceClaimIds: ['F1'] },
      { id: 'one', type: 'prose', heading: 'Первый раздел', paragraphs: [`**Проверяемая фактура** помогает держать статью полезной. Это удобно проверить в [инструментах Lexis Voice](/). ${paragraph}`], sourceClaimIds: ['F1'] },
      { id: 'two', type: 'prose', heading: 'Второй раздел', paragraphs: [`==Главный вывод== виден при быстром чтении. ${paragraph}`], sourceClaimIds: ['F1'] },
      { id: 'three', type: 'prose', heading: 'Третий раздел', paragraphs: [`**Второй акцент** фиксирует мысль. ${paragraph}`], sourceClaimIds: ['F1'] },
      { id: 'four', type: 'prose', heading: 'Четвертый раздел', paragraphs: [`==Маркер== держит норму. ${paragraph}`], sourceClaimIds: ['F1'] },
      { id: 'five', type: 'prose', heading: 'Пятый раздел', paragraphs: [`**Третий акцент** удерживает читательский фокус. ${paragraph}`], sourceClaimIds: ['F1'] },
      { id: 'six', type: 'prose', heading: 'Шестой раздел', paragraphs: [`==Второй маркер== помогает быстро найти вывод. ${paragraph}`], sourceClaimIds: ['F1'] },
      { id: 'seven', type: 'prose', heading: 'Седьмой раздел', paragraphs: [paragraph], sourceClaimIds: ['F1'] },
      { id: 'eight', type: 'prose', heading: 'Восьмой раздел', paragraphs: [paragraph], sourceClaimIds: ['F1'] },
      { id: 'thin', type: 'callout', text: 'Короткое служебное пояснение.', sourceClaimIds: ['F1'] },
      { id: 'related', type: 'related', items: [{ href: '/' }, { href: '/play' }] },
      { id: 'faq', type: 'faq', heading: 'Частые вопросы', items: Array.from({ length: 8 }, (_, index) => ({ question: `Q${index}?`, answer: 'Длинный ответ с фактом, ограничением и понятным следующим шагом для читателя материала.' })), sourceClaimIds: ['F1'] },
      { id: 'sources', type: 'sources', items: [{ title: 'Example', url: 'https://example.com', snapshot: new Date().toISOString().slice(0, 10) }] },
    ],
  };
}

function sampleValidationReport(requestId: string): ValidationReport {
  return { requestId, ok: true, issues: [], checkedAt: new Date().toISOString() };
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countAccents(text: string): number {
  return (text.match(/\*\*[^*]+\*\*/g) || []).length + (text.match(/==[^=]+==/g) || []).length;
}
