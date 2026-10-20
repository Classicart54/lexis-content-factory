import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAgentPorts } from './agent-factory.js';
import { contentApiUrlFromEnv } from '../config.js';
import { loadProjectKnowledge } from './project-knowledge.js';
import type { DraftDoc, FactPackage, PipelineRequest } from './types.js';
import { validateMaterial } from './validation.js';
import type { MaterialStructure } from './types.js';

const requestDir = process.argv[2];
if (!requestDir) throw new Error('Usage: npm run review:local -- <request-dir>');

const projectKnowledge = await loadProjectKnowledge(process.env.HANDOFF_KONVEYER_DIR);
const agents = createAgentPorts({
  neuromediaApiKey: process.env.NEUROMEDIA_API_KEY,
  neuromediaBaseUrl: process.env.NEUROMEDIA_BASE_URL,
  neuromediaModel: process.env.NEUROMEDIA_MODEL,
  neuromediaTimeoutMs: Number(process.env.NEUROMEDIA_TIMEOUT_MS || 120000),
  projectKnowledge,
    contentApiUrl: contentApiUrlFromEnv(),
    contentApiToken: process.env.CONTENT_API_TOKEN,
});

const request = await readJson<PipelineRequest>(join(requestDir, 'request.json'));
const facts = await readJson<FactPackage>(join(requestDir, 'facts.v1.json'));
const structure = await readFirstJson<MaterialStructure>([join(requestDir, 'structure.retry.json'), join(requestDir, 'structure.v1.json')]);
const finalDoc = await readFirstJson<DraftDoc>([join(requestDir, 'assembled.v1.json'), join(requestDir, 'draft.retry.json'), join(requestDir, 'draft.v1.json')]);
const validationReport = validateMaterial(request, facts, structure, finalDoc);
await writeFile(join(requestDir, 'validation-report.v1.json'), `${JSON.stringify(validationReport, null, 2)}\n`, 'utf8');

const review = await agents.runReviewAgent(request, facts, finalDoc, validationReport);
await writeFile(join(requestDir, 'review-report.v1.json'), `${JSON.stringify(review, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      approved: review.approved,
      issueCount: review.issues.length,
      issues: review.issues,
      summary: review.summary,
      path: join(requestDir, 'review-report.v1.json'),
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
