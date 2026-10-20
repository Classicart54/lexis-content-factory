import test from 'node:test';
import assert from 'node:assert/strict';
import { NeuromediaClient } from '../neuromedia-client.js';

test('uses Terra and retries an empty successful upstream response', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).model, 'gpt-5.6-terra');
    calls++;
    return Response.json({ choices: [{ message: { content: calls === 1 ? '' : '{"ok":true}' } }] });
  };
  try {
    assert.deepEqual(await new NeuromediaClient({ apiKey: 'test' }).createJsonCompletion({ messages: [] }), { ok: true });
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('request timeout remains active while reading the response body', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => ({
    ok: true,
    text: () => new Promise<string>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('body timed out')), { once: true });
    }),
  } as Response);
  try {
    await assert.rejects(new NeuromediaClient({ apiKey: 'test', timeoutMs: 10 }).createJsonCompletion({ messages: [] }), /body timed out/);
  } finally { globalThis.fetch = original; }
});
