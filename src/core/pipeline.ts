import { ArtifactStore } from './artifact-store.js';
import { assembleMaterial } from './assembler.js';
import { validateFactPackage } from './fact-validation.js';
import { removeWeakVisualSlots, validateInfographics } from './infographics-validation.js';
import { chooseNextAction } from './orchestrator.js';
import { applyValidationAutofixes, canAutofixValidationIssues } from './orchestrator-autofix.js';
import { createRevisionPacket, revisionLimitIssue, revisionNote } from './revision.js';
import { applyReviewAutofixes, canAutofixReviewIssues } from './review-autofix.js';
import { prepareSeoForPublication } from './seo-preparation.js';
import { assertTransition, nextRevisionStatus } from './status.js';
import { cleanupDraftStyle } from './style-cleanup.js';
import { validateStructure } from './structure-validation.js';
import type { AgentPorts, PipelineRequest, RequestBrief, RequestStatus } from './types.js';
import { validateMaterial } from './validation.js';

export class ContentPipeline {
  constructor(
    private readonly store: ArtifactStore,
    private readonly agents: AgentPorts,
  ) {}

  async createRequest(input: { brief: RequestBrief; createdBy?: PipelineRequest['createdBy']; notes?: string[] }): Promise<PipelineRequest> {
    return this.store.createRequest({
      status: 'brief_draft',
      brief: input.brief,
      createdBy: input.createdBy || { source: 'system' },
      notes: input.notes || ['Request created. Next step: gather facts and source evidence.'],
    });
  }

  async runNext(requestId: string): Promise<PipelineRequest> {
    const request = await this.mustFindRequest(requestId);
    const artifacts = await this.store.readArtifacts(request.id);
    const action = chooseNextAction(request, artifacts);

    if (!action) return request;

    switch (action.role) {
      case 'search': {
        const facts = await this.agents.runSearchAgent(request);
        await this.store.writeArtifact(request.id, 'facts', facts);
        const factIssues = validateFactPackage(request, facts);
        const errors = factIssues.filter((issue) => issue.severity === 'error');
        const note = `Search agent completed: ${facts.claims.length} claims, ${facts.sources.length} sources, ${factIssues.length} fact-check issues.`;
        if (errors.length > 0) {
          const limitIssue = revisionLimitIssue(artifacts.revision, factIssues);
          if (limitIssue) return this.move(request, 'blocked', `Automatic revision stopped. ${limitIssue.message}`);
          const revision = createRevisionPacket({ requestId: request.id, source: 'fact_validation', issues: factIssues, previous: artifacts.revision });
          if (revision) await this.store.writeArtifact(request.id, 'revision', revision);
          return this.move(request, 'needs_facts', revision ? `${note}\n${revisionNote(revision)}` : note);
        }
        return this.move(request, 'ready_for_structure', note);
      }

      case 'structure': {
        if (!artifacts.facts) throw new Error('Cannot run structure agent without facts.');
        const structuring = await this.move(request, 'structuring', 'Structure agent started.');
        const structure = await this.agents.runStructureAgent(structuring, artifacts.facts);
        await this.store.writeArtifact(request.id, 'structure', structure);
        const structureIssues = validateStructure(structuring, artifacts.facts, structure);
        const nextStatus = nextRevisionStatus(structureIssues);
        const note = `Structure agent completed: ${structure.sections.length} sections, ${structureIssues.length} structure-check issues.`;
        if (nextStatus !== 'llm_review') {
          const limitIssue = revisionLimitIssue(artifacts.revision, structureIssues);
          if (limitIssue) return this.move(structuring, 'blocked', `Automatic revision stopped. ${limitIssue.message}`);
          const revision = createRevisionPacket({ requestId: request.id, source: 'structure_validation', issues: structureIssues, previous: artifacts.revision });
          if (revision) await this.store.writeArtifact(request.id, 'revision', revision);
          return this.move(structuring, nextStatus, revision ? `${note}\n${revisionNote(revision)}` : note);
        }
        return this.move(structuring, nextStatus === 'llm_review' ? 'ready_for_writing' : nextStatus, note);
      }

      case 'writer': {
        if (!artifacts.facts || !artifacts.structure) throw new Error('Cannot run writer without facts and structure.');
        const writing = await this.move(request, 'writing', 'Writer agent started.');
        const draft = cleanupDraftStyle(await this.agents.runWriterAgent(writing, artifacts.facts, artifacts.structure));
        await this.store.writeArtifact(request.id, 'draft', draft);
        return this.move(writing, 'ready_for_assembly', `Writer agent completed: ${draft.blocks.length} blocks.`);
      }

      case 'infographics': {
        if (!artifacts.facts || !artifacts.structure || !artifacts.draft) throw new Error('Cannot run infographics agent without facts, structure and draft.');
        const assembling = await this.move(request, 'assembling', 'Assembly started.');
        let infographics = await this.agents.runInfographicsAgent(assembling, artifacts.facts, artifacts.draft);
        let visualIssues = validateInfographics(artifacts.facts, artifacts.draft, infographics);
        const filteredInfographics = removeWeakVisualSlots(infographics, visualIssues);
        if (filteredInfographics.length !== infographics.length) {
          infographics = filteredInfographics;
          visualIssues = validateInfographics(artifacts.facts, artifacts.draft, infographics);
        }
        await this.store.writeArtifact(request.id, 'infographics', infographics);
        const assembled = cleanupDraftStyle(prepareSeoForPublication(assembling, artifacts.facts, artifacts.structure, assembleMaterial(assembling, artifacts.structure, artifacts.draft, infographics)));
        await this.store.writeArtifact(request.id, 'assembled', assembled);
        const nextStatus = nextRevisionStatus(visualIssues);
        const note = `Assembly completed with ${infographics.length} infographic specs, ${assembled.blocks.length} final blocks, ${visualIssues.length} visual-check issues.`;
        if (nextStatus !== 'llm_review') {
          const limitIssue = revisionLimitIssue(artifacts.revision, visualIssues);
          if (limitIssue) return this.move(assembling, 'blocked', `Automatic revision stopped. ${limitIssue.message}`);
          const revision = createRevisionPacket({ requestId: request.id, source: 'infographics_validation', issues: visualIssues, previous: artifacts.revision });
          if (revision) await this.store.writeArtifact(request.id, 'revision', revision);
          return this.move(assembling, nextStatus, revision ? `${note}\n${revisionNote(revision)}` : note);
        }
        return this.move(assembling, nextStatus === 'llm_review' ? 'machine_review' : nextStatus, note);
      }

      case 'validator': {
        if (!artifacts.facts || !artifacts.structure || !artifacts.draft) throw new Error('Cannot validate without facts, structure and draft.');
        const finalDoc = cleanupDraftStyle(prepareSeoForPublication(request, artifacts.facts, artifacts.structure, artifacts.assembled || artifacts.draft));
        await this.store.writeArtifact(request.id, 'assembled', finalDoc);
        let report = validateMaterial(request, artifacts.facts, artifacts.structure, finalDoc);
        if (!report.ok && canAutofixValidationIssues(report.issues)) {
          const fixed = cleanupDraftStyle(applyValidationAutofixes(request, artifacts.facts, artifacts.structure, finalDoc, report.issues));
          await this.store.writeArtifact(request.id, 'assembled', fixed);
          report = validateMaterial(request, artifacts.facts, artifacts.structure, fixed);
        }
        await this.store.writeArtifact(request.id, 'validationReport', report);
        const nextStatus = nextRevisionStatus(report.issues);
        if (nextStatus !== 'llm_review') {
          const limitIssue = revisionLimitIssue(artifacts.revision, report.issues);
          if (limitIssue) return this.move(request, 'blocked', `Automatic revision stopped. ${limitIssue.message}`);
          const revision = createRevisionPacket({ requestId: request.id, source: 'machine_validation', issues: report.issues, previous: artifacts.revision });
          if (revision) await this.store.writeArtifact(request.id, 'revision', revision);
          const note = `Machine validation failed with ${report.issues.length} issues.`;
          return this.move(request, nextStatus, revision ? `${note}\n${revisionNote(revision)}` : note);
        }
        return this.move(request, nextStatus, report.ok ? 'Machine validation passed.' : `Machine validation failed with ${report.issues.length} issues.`);
      }

      case 'reviewer': {
        if (!artifacts.facts || !artifacts.structure || !artifacts.draft || !artifacts.validationReport) throw new Error('Cannot review without facts, structure, draft and validation report.');
        const finalDoc = artifacts.assembled || artifacts.draft;
        const report = await this.agents.runReviewAgent(request, artifacts.facts, finalDoc, artifacts.validationReport);
        await this.store.writeArtifact(request.id, 'reviewReport', report);
        const nextStatus = report.approved ? 'approved' : nextRevisionStatus(report.issues);
        if (!report.approved) {
          if (canAutofixReviewIssues(report.issues)) {
            const fixed = cleanupDraftStyle(applyReviewAutofixes(request, artifacts.facts, artifacts.structure, finalDoc, report.issues));
            await this.store.writeArtifact(request.id, 'assembled', fixed);
            const fixedValidation = validateMaterial(request, artifacts.facts, artifacts.structure, fixed);
            await this.store.writeArtifact(request.id, 'validationReport', fixedValidation);
            const note = `${report.summary}\nOrchestrator autofix applied: removed weak visual slots and normalized related/product links without rerunning writer.`;
            if (fixedValidation.ok) return this.move(request, 'approved', note);
            return this.move(request, 'machine_review', note);
          }
          if (report.issues.every((issue) => issue.severity === 'warning')) return this.move(request, 'approved', report.summary);
          const limitIssue = revisionLimitIssue(artifacts.revision, report.issues);
          if (limitIssue) return this.move(request, 'blocked', `Automatic revision stopped. ${limitIssue.message}`);
          const revision = createRevisionPacket({ requestId: request.id, source: 'llm_review', issues: report.issues, previous: artifacts.revision });
          if (revision) await this.store.writeArtifact(request.id, 'revision', revision);
          return this.move(request, nextStatus, revision ? `${report.summary}\n${revisionNote(revision)}` : report.summary);
        }
        return this.move(request, nextStatus, report.summary);
      }

      case 'publisher': {
        if (request.status === 'approved') {
          const finalDoc = artifacts.assembled || artifacts.draft;
          if (!finalDoc) throw new Error('Cannot publish without assembled document or draft.');
          const report = await this.agents.publishMaterial(request, finalDoc);
          await this.store.writeArtifact(request.id, 'publicationReport', report);
          if (!report.ok) {
            if (report.statusCode === 429) {
              // A daily wave limit is temporary. Preserve approval so the next
              // scheduled run can publish without regenerating the article.
              throw new Error(`Publication deferred until the daily quota resets: ${report.summary}`);
            }
            if (artifacts.facts && artifacts.structure && canAutofixValidationIssues(report.issues)) {
              const fixed = cleanupDraftStyle(applyValidationAutofixes(request, artifacts.facts, artifacts.structure, finalDoc, report.issues));
              await this.store.writeArtifact(request.id, 'assembled', fixed);
              const fixedValidation = validateMaterial(request, artifacts.facts, artifacts.structure, fixed);
              await this.store.writeArtifact(request.id, 'validationReport', fixedValidation);
              return this.move(request, 'machine_review', `${report.summary}\nOrchestrator publication autofix applied without rerunning writer.`);
            }
            const limitIssue = revisionLimitIssue(artifacts.revision, report.issues);
            if (limitIssue) return this.move(request, 'blocked', `Automatic revision stopped. ${limitIssue.message}`);
            const revision = createRevisionPacket({ requestId: request.id, source: 'publication', issues: report.issues, previous: artifacts.revision });
            if (revision) await this.store.writeArtifact(request.id, 'revision', revision);
            return this.move(request, revision?.targetStatus || 'blocked', revision ? `${report.summary}\n${revisionNote(revision)}` : report.summary);
          }
          return this.move(request, 'published', report.summary);
        }
        if (request.status === 'published') return this.move(request, 'monitoring', 'Published material moved into monitoring.');
        return request;
      }

      case 'orchestrator':
        return request;
    }
  }

  async runUntilIdle(requestId: string, maxSteps = 20): Promise<PipelineRequest> {
    let current = await this.mustFindRequest(requestId);

    for (let step = 0; step < maxSteps; step += 1) {
      const next = await this.runNext(current.id);
      if (next.status === current.status && next.updatedAt === current.updatedAt) return next;
      current = next;
      if (current.status === 'monitoring' || current.status === 'blocked') return current;
    }

    throw new Error(`Pipeline did not become idle after ${maxSteps} steps.`);
  }

  private async mustFindRequest(requestId: string): Promise<PipelineRequest> {
    const request = await this.store.findRequest(requestId);
    if (!request) throw new Error(`Request ${requestId} not found.`);
    return request;
  }

  private async move(request: PipelineRequest, status: RequestStatus, note: string): Promise<PipelineRequest> {
    if (request.status !== status) assertTransition(request.status, status);
    return this.store.updateRequest({ ...request, status, notes: [...request.notes, note] });
  }
}
