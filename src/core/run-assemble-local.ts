import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assembleMaterial } from './assembler.js';
import type { DraftDoc, InfographicSpec, MaterialStructure, PipelineRequest } from './types.js';

const requestDir = process.argv[2];
if (!requestDir) throw new Error('Usage: npm run assemble:local -- <request-dir>');

const request = await readJson<PipelineRequest>(join(requestDir, 'request.json'));
const structure = await readFirstJson<MaterialStructure>([join(requestDir, 'structure.retry.json'), join(requestDir, 'structure.v1.json')]);
const draft = await readFirstJson<DraftDoc>([join(requestDir, 'draft.retry.json'), join(requestDir, 'draft.v1.json')]);
const infographics = await readJson<InfographicSpec[]>(join(requestDir, 'infographics.v1.json'));

const assembled = assembleMaterial(request, structure, draft, infographics);
await writeFile(join(requestDir, 'assembled.v1.json'), `${JSON.stringify(assembled, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      blockCount: assembled.blocks.length,
      visualSlots: assembled.blocks.filter((block) => block.type === 'visual_slot').length,
      path: join(requestDir, 'assembled.v1.json'),
    },
    null,
    2,
  ),
);

async function readFirstJson<T>(filePaths: string[]): Promise<T> {
  const errors: string[] = [];
  for (const filePath of filePaths) {
    try {
      return await readJson<T>(filePath);
    } catch (error) {
      errors.push(`${filePath}: ${(error as Error).message}`);
    }
  }
  throw new Error(`Cannot read any JSON file:\n${errors.join('\n')}`);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}
