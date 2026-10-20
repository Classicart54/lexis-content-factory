import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, utimes, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

test('format repair preserves mtime so old articles do not consume the daily publication quota', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lexis-repair-test-'));
  try {
    const content = join(root, 'content');
    const landing = join(root, 'landing');
    await mkdir(join(content, 'guide'), { recursive: true });
    await mkdir(join(landing, 'lib/doc'), { recursive: true });
    await writeFile(join(landing, 'package.json'), '{"type":"module"}');
    await writeFile(join(landing, 'lib/doc/validate.js'), 'export const validateDoc = () => [];');
    const file = join(content, 'guide/test.json');
    await writeFile(file, JSON.stringify({ meta: { slug: 'test' }, blocks: [{ id: 'example', type: 'example', paragraphs: ['Original text.'] }] }));
    const old = new Date('2026-08-18T08:00:00Z');
    await utimes(file, old, old);
    await promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/core/repair-legacy-store.ts', '--apply'], { env: { ...process.env, CONTENT_DIR: content, LANDING_SOURCE_DIR: landing }, timeout: 15000 });
    assert.equal((await stat(file)).mtimeMs, old.getTime());
    const doc = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(doc.blocks[0].type, 'prose');
    assert.deepEqual(doc.blocks[0].paragraphs, ['Original text.']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
