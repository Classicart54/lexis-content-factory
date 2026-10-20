import { readdir, readFile, writeFile, rename, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toLegacySiteDoc, type SiteDoc } from './site-doc-transformer.js';

// Validate against the actual deployed renderer, rather than a copied schema.
const root = process.env.CONTENT_DIR;
const landing = process.env.LANDING_SOURCE_DIR;
if (!root || !landing) throw new Error('CONTENT_DIR and LANDING_SOURCE_DIR are required.');
const { validateDoc } = await import(pathToFileURL(join(landing, 'lib/doc/validate.js')).href);
const apply = process.argv.includes('--apply');
let repaired = 0;
let skipped = 0;
for (const name of await readdir(join(root, 'guide'))) {
  if (!name.endsWith('.json')) continue;
  const path = join(root, 'guide', name);
  const original = JSON.parse(await readFile(path, 'utf8')) as SiteDoc;
  if (!original.blocks.some((b) => ['example', 'expert', 'takeaways'].includes(b.type))) continue;
  const doc = toLegacySiteDoc(original);
  const problems = validateDoc(doc) as string[];
  if (problems.length) {
    skipped++;
    console.log(JSON.stringify({ file: name, skipped: true, problems }));
    continue;
  }
  if (apply) {
    const timestamps = await stat(path);
    await writeFile(path + '.tmp', JSON.stringify(doc, null, 2) + '\n');
    await rename(path + '.tmp', path);
    // The landing daily quota uses filesystem mtime. A format repair is not
    // a new publication and must preserve the original publication timestamp.
    await utimes(path, timestamps.atime, timestamps.mtime);
  }
  repaired++;
  console.log(JSON.stringify({ file: name, applied: apply }));
}
console.log(JSON.stringify({ apply, repaired, skipped }));
