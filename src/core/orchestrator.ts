import type { NextAction, PipelineArtifacts, PipelineRequest } from './types.js';

export function chooseNextAction(request: PipelineRequest, artifacts: PipelineArtifacts): NextAction | null {
  switch (request.status) {
    case 'brief_draft':
    case 'needs_facts':
      return { role: 'search', reason: 'Need verified facts, sources and occupied-topic check before structuring.' };

    case 'ready_for_structure':
    case 'needs_structure_revision':
    case 'structuring':
      if (!artifacts.facts) return { role: 'search', reason: 'Structure cannot be built without a fact package.' };
      return { role: 'structure', reason: 'Fact package is ready; build article blocks and required sections.' };

    case 'ready_for_writing':
    case 'needs_writer_revision':
    case 'writing':
      if (!artifacts.facts) return { role: 'search', reason: 'Writer needs traceable facts.' };
      if (!artifacts.structure) return { role: 'structure', reason: 'Writer needs approved structure.' };
      return { role: 'writer', reason: 'Structure and facts are ready; draft block content.' };

    case 'ready_for_assembly':
    case 'assembling':
      if (!artifacts.draft) return { role: 'writer', reason: 'Assembly needs a draft document.' };
      return { role: 'infographics', reason: 'Draft is ready; derive infographic specs from sourced data.' };

    case 'machine_review':
      return { role: 'validator', reason: 'Run deterministic checks before any LLM review.' };

    case 'llm_review':
      if (!artifacts.facts || !artifacts.draft || !artifacts.validationReport) {
        return { role: 'validator', reason: 'Review needs facts, draft and machine validation report.' };
      }
      return { role: 'reviewer', reason: 'Machine validation passed; run semantic review.' };

    case 'approved':
      return { role: 'publisher', reason: 'Material is approved for publication.' };

    case 'published':
      return { role: 'publisher', reason: 'Move published material into monitoring.' };

    case 'monitoring':
    case 'blocked':
      return null;
  }
}
