import assert from 'node:assert/strict';
import test from 'node:test';
import { ContentApiPublisher } from '../content-api-publisher.js';
import type { DraftDoc, PipelineRequest } from '../types.js';

test('publisher includes allowedLinks and note from 422 response in revision issue', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: 'validation_failed',
        problems: ['ссылка в никуда: /guides/tehniki-prodazh-b2b'],
        allowedLinks: ['/', '/play', '/cases'],
        note: 'Ссылаться можно только на эти адреса.',
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );

  try {
    const report = await new ContentApiPublisher({ apiUrl: 'http://example.test/api/content', apiToken: 'token', model: 'test' }).publish(sampleRequest(), sampleDraft());
    assert.equal(report.ok, false);
    assert.equal(report.issues[0]?.owner, 'writer');
    assert.equal(report.issues[0]?.code, 'publication_related_links');
    assert.match(report.issues[0]?.message || '', /ссылка в никуда/);
    assert.match(report.issues[0]?.message || '', /Ссылаться можно только на эти адреса/);
    assert.match(report.issues[0]?.message || '', /Allowed internal links: \/, \/play, \/cases/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publisher classifies accent validation errors for deterministic autofix', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: 'validation_failed',
        problems: ['выделений в тексте 5, нужно от 7: сплошное полотно не сканируется глазами'],
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );

  try {
    const report = await new ContentApiPublisher({ apiUrl: 'http://example.test/api/content', apiToken: 'token', model: 'test' }).publish(sampleRequest(), sampleDraft());
    assert.equal(report.ok, false);
    assert.equal(report.issues[0]?.code, 'publication_not_enough_accents');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publisher classifies word-count validation errors for deterministic autofix', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: 'validation_failed',
        problems: ['2026 слов, максимум 2000: материал длиннее читают по диагонали'],
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );

  try {
    const report = await new ContentApiPublisher({ apiUrl: 'http://example.test/api/content', apiToken: 'token', model: 'test' }).publish(sampleRequest(), sampleDraft());
    assert.equal(report.ok, false);
    assert.equal(report.issues[0]?.code, 'publication_word_count_high');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publisher classifies unpublished parent validation errors for deterministic autofix', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: 'validation_failed',
        problems: ['хаб «otrabotka-vozrazheniy» не опубликован: подстатья станет сиротой'],
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );

  try {
    const report = await new ContentApiPublisher({ apiUrl: 'http://example.test/api/content', apiToken: 'token', model: 'test' }).publish(sampleRequest(), sampleDraft());
    assert.equal(report.ok, false);
    assert.equal(report.issues[0]?.code, 'publication_parent_unpublished');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function sampleRequest(): PipelineRequest {
  const now = new Date().toISOString();
  return {
    id: 'A-TEST',
    status: 'approved',
    brief: {
      inputType: 'planned_topic',
      title: 'Техники продаж',
      cluster: 'техники продаж',
      materialKind: 'guide',
      goal: 'Explain topic.',
      knownFacts: 'Slug: tehniki-prodazh\nURL: /guides/tehniki-prodazh\nRole: hub\nSection: tehnika',
      forbiddenMentions: 'none',
      internalLinks: '/ /play /cases',
    },
    createdAt: now,
    updatedAt: now,
    createdBy: { source: 'system' },
    notes: [],
  };
}

function sampleDraft(): DraftDoc {
  return {
    meta: { title: 'Техники продаж', seoTitle: 'Техники продаж', description: 'Описание.', slug: 'tehniki-prodazh', author: { name: 'Команда Lexis Voice', kind: 'organization' } },
    blocks: [{ id: 'lead', type: 'lead', text: 'Лид материала.' }],
  };
}

test('does not report success when an accepted article returns 404 publicly', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1
    ? Response.json({ ok: true, url: 'https://lexisvoice.ru/guides/tehniki-prodazh' }, { status: 201 })
    : new Response('not found', { status: 404 });
  try {
    const report = await new ContentApiPublisher({ apiUrl: 'http://localhost/api/content', apiToken: 'test' }).publish(sampleRequest(), sampleDraft());
    assert.equal(report.ok, false);
    assert.equal(report.issues[0].code, 'publication_not_visible');
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('reports successful publication only after checking the public page', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1
    ? Response.json({ ok: true, url: 'https://lexisvoice.ru/guides/tehniki-prodazh' }, { status: 201 })
    : new Response('article', { status: 200 });
  try {
    const report = await new ContentApiPublisher({ apiUrl: 'http://localhost/api/content', apiToken: 'test' }).publish(sampleRequest(), sampleDraft());
    assert.equal(report.ok, true);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('occupied cluster is an editorial conflict and never requests new fact collection', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: 'validation_failed', problems: ['кластер «этапы продаж» уже занят страницей /guides/etapy-prodazh'] }, { status: 422 });
  try {
    const report = await new ContentApiPublisher({ apiUrl: 'http://localhost/api/content', apiToken: 'test' }).publish(sampleRequest(), sampleDraft());
    assert.equal(report.issues[0].code, 'publication_cluster_occupied');
    assert.equal(report.issues[0].owner, 'system');
  } finally { globalThis.fetch = original; }
});
