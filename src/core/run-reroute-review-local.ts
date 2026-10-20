import { ArtifactStore } from './artifact-store.js';
import { createRevisionPacket, revisionNote } from './revision.js';
import { nextRevisionStatus } from './status.js';
import type { ValidationIssue } from './types.js';

const requestId = process.argv[2];
if (!requestId) throw new Error('Usage: npm run reroute-review:local -- <request-id>');

const dataDir = process.env.DATA_DIR || './data';
const store = new ArtifactStore(dataDir);
const request = await store.findRequest(requestId);
if (!request) throw new Error(`Request ${requestId} not found.`);

const artifacts = await store.readArtifacts(requestId);
if (!artifacts.reviewReport) throw new Error(`Review report for ${requestId} not found.`);

const issues = artifacts.reviewReport.issues.map(normalizeReviewIssueOwner);
const nextStatus = artifacts.reviewReport.approved ? 'approved' : nextRevisionStatus(issues);
const revision = createRevisionPacket({ requestId, source: 'llm_review', issues, previous: artifacts.revision });
if (revision) await store.writeArtifact(requestId, 'revision', revision);

const updated = await store.updateRequest({
  ...request,
  status: nextStatus,
  notes: [...request.notes, revision ? `Review rerouted after owner normalization.\n${revisionNote(revision)}` : 'Review rerouted: no blocking revision.'],
});

console.log(JSON.stringify({ id: updated.id, status: updated.status, revision }, null, 2));

function normalizeReviewIssueOwner(issue: ValidationIssue): ValidationIssue {
  if (issue.code.includes('internal_link') || issue.code.includes('visual_brief')) return { ...issue, owner: 'writer' };
  return issue;
}
