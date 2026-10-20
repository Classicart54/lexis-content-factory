import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { ArtifactStore } from '../artifact-store.js';
import { TopicQueueStore } from '../topic-queue.js';

const run = promisify(execFile);

test('daily runner preserves the request and records an upstream failure with a nonzero exit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lexis-daily-test-'));
  try {
    const handoff = join(root, 'handoff');
    await mkdir(join(handoff, 'fakty'), { recursive: true });
    for (const name of ['temy', 'produkt', 'keysy', 'konkurenty', 'terminy', 'glossariy', 'vnutrennie-ssylki']) {
      await writeFile(join(handoff, 'fakty', `${name}.json`), '{}');
    }
    const store = new ArtifactStore(root);
    const request = await store.createRequest({ status: 'brief_draft', brief: {
      inputType: 'planned_topic', title: 'Test article', cluster: 'test', materialKind: 'guide', goal: 'test',
      knownFacts: 'Slug: test-topic', forbiddenMentions: '', internalLinks: '/',
    }, createdBy: { source: 'system' }, notes: [] });
    const queue = new TopicQueueStore(root);
    await queue.add({ requestId: request.id, slug: 'test-topic', title: 'Test article', url: '/guides/test-topic' });
    const stub = join(root, 'upstream.mjs');
    await writeFile(stub, 'globalThis.fetch = async () => new Response("Bad upstream request", {status: 400});');
    await assert.rejects(run(process.execPath, ['--import', 'tsx', '--import', stub, 'src/core/run-daily-topics-local.ts', '1'], {
      env: { ...process.env, DATA_DIR: root, HANDOFF_KONVEYER_DIR: handoff, NEUROMEDIA_API_KEY: 'test', CONTENT_API_TOKEN: 'test' },
      timeout: 15000,
    }), (error: unknown) => (error as { code: number }).code === 1);
    const report = JSON.parse(await readFile(join(root, 'daily-report.json'), 'utf8'));
    assert.equal(report.ok, false);
    assert.equal(report.published, 0);
    assert.match(report.results[0].note, /400/);
    assert.equal((await queue.list())[0].status, 'pending');
    assert.equal((await store.findRequest(request.id))?.status, 'brief_draft');
  } finally { await rm(root, { recursive: true, force: true }); }
});
