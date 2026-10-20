import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAgentPorts } from './agent-factory.js';
import { contentApiUrlFromEnv } from '../config.js';
import { loadProjectKnowledge } from './project-knowledge.js';
import { validateStructure } from './structure-validation.js';
import type { FactPackage, PipelineRequest } from './types.js';
import { validateMaterial } from './validation.js';

const requestDir = process.argv[2];
if (!requestDir) throw new Error('Usage: npm run from-facts:local -- <request-dir>');

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

const structure = await agents.runStructureAgent(request, facts);
const structureIssues = validateStructure(request, facts, structure);
await writeFile(join(requestDir, 'structure.retry.json'), `${JSON.stringify(structure, null, 2)}\n`, 'utf8');

if (structureIssues.some((issue) => issue.severity === 'error')) {
  console.log(JSON.stringify({ stage: 'structure', ok: false, issues: structureIssues, structure }, null, 2));
  process.exit(0);
}

const draft = await agents.runWriterAgent(request, facts, structure);
const validationReport = validateMaterial(request, facts, structure, draft);
await writeFile(join(requestDir, 'draft.retry.json'), `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
await writeFile(join(requestDir, 'validation-report.retry.json'), `${JSON.stringify(validationReport, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({ stage: 'draft', ok: validationReport.ok, issues: validationReport.issues, blockCount: draft.blocks.length, draftPath: join(requestDir, 'draft.retry.json') }, null, 2));

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}
