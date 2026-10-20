import type { FactPackage, PipelineRequest, ValidationIssue } from './types.js';

const MIN_ALLOWED_CLAIMS = 3;

export function validateFactPackage(request: PipelineRequest, facts: FactPackage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sourceIds = new Set(facts.sources.map((source) => source.id));

  if (request.brief.inputType === 'planned_topic' && !facts.topicOccupied) {
    issues.push({ code: 'topic_occupancy_missing', severity: 'error', owner: 'facts', message: 'Search agent must check whether the topic/cluster is already occupied.' });
  }

  if (facts.sources.length === 0) {
    issues.push({ code: 'facts_no_sources', severity: 'error', owner: 'facts', message: 'FactPackage must contain at least one usable source.' });
  }

  const allowedClaims = facts.claims.filter((claim) => claim.allowedInFinal);
  if (allowedClaims.length < MIN_ALLOWED_CLAIMS) {
    issues.push({ code: 'facts_too_few_claims', severity: 'error', owner: 'facts', message: `FactPackage must contain at least ${MIN_ALLOWED_CLAIMS} allowed claims.` });
  }

  for (const source of facts.sources) {
    if (!/^https?:\/\//i.test(source.url)) {
      issues.push({ code: 'source_url_invalid', severity: 'error', owner: 'facts', message: `Source ${source.id} must contain an absolute http(s) URL.` });
    }

    if (/utm_|chatgpt|gclid|yclid/i.test(source.url)) {
      issues.push({ code: 'source_tracking_params', severity: 'error', owner: 'facts', message: `Source ${source.id} contains tracking or assistant-looking URL parameters.` });
    }

    if (!source.publisher) {
      issues.push({ code: 'source_publisher_missing', severity: 'error', owner: 'facts', message: `Source ${source.id} must include publisher.` });
    }

    if (!source.snapshotText || source.snapshotText.length < 20) {
      issues.push({ code: 'source_quote_missing', severity: 'error', owner: 'facts', message: `Source ${source.id} must include a direct quote or snapshot text.` });
    }
  }

  for (const claim of facts.claims) {
    if (!claim.claim.trim()) {
      issues.push({ code: 'claim_empty', severity: 'error', owner: 'facts', message: `Claim ${claim.id} is empty.` });
    }

    if (claim.allowedInFinal && claim.sourceIds.length === 0) {
      issues.push({ code: 'claim_without_source', severity: 'error', owner: 'facts', message: `Claim ${claim.id} is allowed in final text but has no sources.` });
    }

    for (const sourceId of claim.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        issues.push({ code: 'claim_unknown_source', severity: 'error', owner: 'facts', message: `Claim ${claim.id} references unknown source ${sourceId}.` });
      }
    }

    if (claim.allowedInFinal && (!claim.quote || claim.quote.length < 20)) {
      issues.push({ code: 'claim_quote_missing', severity: 'error', owner: 'facts', message: `Claim ${claim.id} must include a direct supporting quote.` });
    }

    if (claim.confidence === 'low') {
      issues.push({ code: 'claim_low_confidence', severity: 'error', owner: 'facts', message: `Claim ${claim.id} has low confidence and cannot be used in final text.` });
    }

    if (claim.confidence === 'medium') {
      issues.push({ code: 'claim_medium_confidence', severity: 'warning', owner: 'facts', message: `Claim ${claim.id} has medium confidence; writer must phrase it carefully.` });
    }
  }

  if (!facts.angle || facts.angle.length < 30) {
    issues.push({ code: 'angle_missing', severity: 'warning', owner: 'facts', message: 'Search agent should return an angle that is not obvious from top search results.' });
  }

  if (facts.gaps.length > 0) {
    issues.push({ code: 'facts_have_gaps', severity: 'warning', owner: 'facts', message: `Search agent reported ${facts.gaps.length} open gaps.` });
  }

  return issues;
}
