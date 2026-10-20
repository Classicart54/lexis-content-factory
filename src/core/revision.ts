import { nextRevisionStatus } from './status.js';
import type { IssueOwner, RequestStatus, RevisionPacket, ValidationIssue } from './types.js';

const MAX_REVISION_ATTEMPTS = 20;

export function createRevisionPacket(input: { requestId: string; source: RevisionPacket['source']; issues: ValidationIssue[]; previous?: RevisionPacket }): RevisionPacket | null {
  const errors = input.issues.filter((issue) => issue.severity === 'error');
  if (errors.length === 0) return null;

  const targetStatus = nextRevisionStatus(input.issues);
  const targetOwner = ownerForStatus(targetStatus, errors);
  const scopedIssues = input.issues.filter((issue) => issue.owner === targetOwner || issue.severity === 'error');

  return {
    requestId: input.requestId,
    source: input.source,
    targetStatus,
    targetOwner,
    attempt: (input.previous?.attempt || 0) + 1,
    issues: scopedIssues,
    instructions: buildInstructions(targetOwner, scopedIssues),
    createdAt: new Date().toISOString(),
  };
}

export function revisionNote(packet: RevisionPacket): string {
  return [
    `Revision packet #${packet.attempt} created from ${packet.source}.`,
    `Route to ${packet.targetOwner}: ${packet.issues.length} issue(s).`,
    ...packet.instructions.map((instruction) => `- ${instruction}`),
  ].join('\n');
}

export function revisionLimitIssue(previous: RevisionPacket | undefined, issues: ValidationIssue[]): ValidationIssue | null {
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length === 0) return null;

  const nextAttempt = (previous?.attempt || 0) + 1;
  if (nextAttempt > MAX_REVISION_ATTEMPTS) {
    return {
      code: 'revision_budget_exceeded',
      severity: 'error',
      owner: 'system',
      message: `Material exceeded revision budget: ${MAX_REVISION_ATTEMPTS} attempts. Stop automatic retries and inspect prompts, validators or normalization before spending more API calls.`,
    };
  }

  return null;
}

function ownerForStatus(status: RequestStatus, errors: ValidationIssue[]): IssueOwner {
  if (status === 'needs_facts') return 'facts';
  if (status === 'needs_structure_revision') return 'structure';
  if (status === 'needs_writer_revision') return 'writer';
  return errors[0]?.owner || 'system';
}

function buildInstructions(owner: IssueOwner, issues: ValidationIssue[]): string[] {
  const prefix = instructionPrefix(owner);
  return issues.map((issue) => {
    const path = issue.path ? ` Path: ${issue.path}.` : '';
    return `${prefix} ${issue.code}: ${issue.message}${path}`;
  });
}

function instructionPrefix(owner: IssueOwner): string {
  if (owner === 'facts') return 'Find or correct source evidence before rewriting.';
  if (owner === 'structure') return 'Revise the plan/section logic and keep supported blocks only.';
  if (owner === 'writer') return 'Rewrite only the affected block or wording; preserve approved structure and facts.';
  return 'Fix the pipeline artifact or format issue before continuing.';
}
