import { ArtifactStore } from './artifact-store.js';
import { ContentApiPublisher } from './content-api-publisher.js';
import { contentApiUrlFromEnv } from '../config.js';
import { NeuromediaClient } from './neuromedia-client.js';
import { prepareSeoForPublication } from './seo-preparation.js';
import { validateMaterial } from './validation.js';
import type { DraftBlock, DraftDoc } from './types.js';

const requestId = process.argv[2];
if (!requestId) throw new Error('Usage: tsx src/core/run-compact-publish.ts <request-id>');

const store = new ArtifactStore(process.env.DATA_DIR || './data');
const request = await store.findRequest(requestId);
if (!request) throw new Error(`Request ${requestId} not found.`);
const artifacts = await store.readArtifacts(requestId);
if (!artifacts.facts || !artifacts.structure || !artifacts.assembled) throw new Error('Need facts, structure and assembled artifacts.');

const apiKey = process.env.NEUROMEDIA_API_KEY;
if (!apiKey) throw new Error('NEUROMEDIA_API_KEY is required.');

const client = new NeuromediaClient({ apiKey, baseUrl: process.env.NEUROMEDIA_BASE_URL, model: process.env.NEUROMEDIA_MODEL, timeoutMs: Number(process.env.NEUROMEDIA_TIMEOUT_MS || 300000) });
const compacted = await client.createJsonCompletion<DraftDoc>({
  messages: [
    {
      role: 'system',
      content: [
        'You are a strict editor compacting an already approved Lexis Voice article JSON.',
        'Return only valid JSON with the same shape: {"meta": {...}, "blocks": [...]}.',
        'Do not add facts, sources, product claims, numbers, sections or links.',
        'Keep the same slug, h1/title, seoTitle, description, cluster, section and author.',
        'Target 1200-1900 visible Russian words. Hard maximum 2000 words.',
        'Keep 6-8 core content sections before FAQ; remove side sections that expand beyond the brief question.',
        'Do not mention search results, SEO, keyword clusters, topic occupancy or why the page exists.',
        'Add scan accents: use **bold** or ==marker== 1-2 times per content section, never in lead, headings or table cells.',
        'Keep FAQ at exactly 8 compact questions. Keep related, sources and CTA blocks, but you may shorten CTA text.',
        'Keep sources as items with title, url and snapshot if present. Do not convert them to groups.',
        'If a block has type verdict and text, convert text to paragraphs array of 1-2 short paragraphs.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({ brief: request.brief, facts: artifacts.facts.claims, doc: pruneDocForCompaction(artifacts.assembled) }, null, 2),
    },
  ],
  temperature: 0.2,
});

const prepared = prepareSeoForPublication(request, artifacts.facts, artifacts.structure, normalizeCompacted(compacted, artifacts.assembled));
await store.writeArtifact(requestId, 'assembled', prepared);
const validation = validateMaterial(request, artifacts.facts, artifacts.structure, prepared);
await store.writeArtifact(requestId, 'validationReport', validation);
if (!validation.ok) {
  console.log(JSON.stringify({ ok: false, validation }, null, 2));
  process.exit(2);
}

const publisher = new ContentApiPublisher({ apiUrl: contentApiUrlFromEnv(), apiToken: process.env.CONTENT_API_TOKEN, model: process.env.NEUROMEDIA_MODEL || 'gpt-5.6-terra' });
const report = await publisher.publish(request, prepared);
await store.writeArtifact(requestId, 'publicationReport', report);
console.log(JSON.stringify({ ok: report.ok, validation, report, blockTypes: prepared.blocks.map((block) => block.type) }, null, 2));
if (!report.ok) process.exit(3);

function pruneDocForCompaction(doc: DraftDoc): DraftDoc {
  return {
    meta: doc.meta,
    blocks: doc.blocks.filter((block) => block.type !== 'visual_slot').map((block) => {
      if (block.type === 'sources') return block;
      return truncateBlock(block);
    }),
  };
}

function truncateBlock(block: DraftBlock): DraftBlock {
  const copy = { ...block };
  if (Array.isArray(copy.paragraphs)) copy.paragraphs = copy.paragraphs.map((item) => String(item).slice(0, 900));
  if (typeof copy.text === 'string') copy.text = copy.text.slice(0, 1200);
  return copy;
}

function normalizeCompacted(compacted: DraftDoc, previous: DraftDoc): DraftDoc {
  return {
    meta: { ...previous.meta, ...compacted.meta, slug: previous.meta.slug, cluster: previous.meta.cluster, section: previous.meta.section, author: previous.meta.author },
    blocks: normalizeBlocks(compacted.blocks || previous.blocks),
  };
}

function normalizeBlocks(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block) => {
    if (block.type === 'verdict' && typeof block.text === 'string' && !Array.isArray(block.paragraphs)) {
      return { ...block, paragraphs: [block.text], text: undefined };
    }
    return block;
  });
}
