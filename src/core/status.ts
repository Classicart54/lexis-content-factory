import type { RequestStatus, ValidationIssue } from './types.js';

const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  brief_draft: ['needs_facts', 'ready_for_structure', 'blocked'],
  needs_facts: ['ready_for_structure', 'blocked'],
  ready_for_structure: ['structuring'],
  structuring: ['ready_for_writing', 'needs_facts', 'needs_structure_revision', 'blocked'],
  ready_for_writing: ['writing'],
  writing: ['ready_for_assembly', 'needs_facts', 'blocked'],
  ready_for_assembly: ['assembling'],
  assembling: ['machine_review', 'needs_structure_revision', 'needs_writer_revision', 'needs_facts', 'blocked'],
  machine_review: ['llm_review', 'needs_structure_revision', 'needs_writer_revision', 'needs_facts', 'blocked'],
  needs_structure_revision: ['structuring'],
  needs_writer_revision: ['writing'],
  llm_review: ['approved', 'machine_review', 'needs_structure_revision', 'needs_writer_revision', 'needs_facts', 'blocked'],
  // ⚠️ machine_review добавлен 10.08.2026: при 422 от Content API автофикс
  // правит артефакт и должен прогнать машинную приёмку заново, не гоняя
  // writer. Без этого перехода публикационный автофикс падал с
  // «Illegal pipeline transition: approved -> machine_review».
  approved: ['published', 'machine_review', 'needs_structure_revision', 'needs_writer_revision', 'needs_facts', 'blocked'],
  published: ['monitoring'],
  monitoring: [],
  blocked: ['brief_draft', 'needs_facts', 'ready_for_structure'],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RequestStatus, to: RequestStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal pipeline transition: ${from} -> ${to}`);
  }
}

export function nextRevisionStatus(issues: ValidationIssue[]): RequestStatus {
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.some((issue) => issue.owner === 'facts')) return 'needs_facts';
  if (errors.some((issue) => issue.owner === 'structure')) return 'needs_structure_revision';
  if (errors.some((issue) => issue.owner === 'writer')) return 'needs_writer_revision';
  if (errors.length > 0) return 'blocked';
  return 'llm_review';
}

export function listAllowedTransitions(status: RequestStatus): RequestStatus[] {
  return [...TRANSITIONS[status]];
}
