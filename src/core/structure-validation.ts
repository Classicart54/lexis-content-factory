import type { FactPackage, MaterialStructure, PipelineRequest, ValidationIssue } from './types.js';

const BLOCK_TYPES = new Set([
  'lead',
  'tldr',
  'prose',
  'points',
  'steps',
  'table',
  'stats',
  'matrix',
  'cards',
  'fork',
  'verdict',
  'quote',
  'callout',
  'image',
  'promo',
  'related',
  'faq',
  'sources',
  'cta',
]);

const MIN_TARGET_WORDS = 1200;
const MAX_TARGET_WORDS = 2000;
const MAX_CONTENT_SECTIONS = 8;
const FAQ_MIN = 8;
const CONTENT_SECTION_TYPES = new Set(['tldr', 'prose', 'points', 'steps', 'table', 'stats', 'matrix', 'cards', 'fork', 'verdict', 'quote', 'callout']);

export function validateStructure(request: PipelineRequest, facts: FactPackage, structure: MaterialStructure): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const factIds = new Set(facts.claims.map((claim) => claim.id));
  const blockTypes = structure.sections.map((section) => section.blockType);

  if (structure.requestId !== request.id) {
    issues.push({ code: 'structure_request_mismatch', severity: 'error', owner: 'structure', message: 'Structure requestId must match request id.' });
  }

  if (structure.seoTitle.length > 65) {
    issues.push({ code: 'structure_seo_title_too_long', severity: 'error', owner: 'structure', message: 'Structure seoTitle must be 65 characters or less.' });
  }

  if (structure.description.length > 160) {
    issues.push({ code: 'structure_description_too_long', severity: 'error', owner: 'structure', message: 'Structure description must be 160 characters or less.' });
  }

  const leadCount = blockTypes.filter((type) => type === 'lead').length;
  if (leadCount !== 1 || blockTypes[0] !== 'lead') {
    issues.push({ code: 'structure_invalid_lead', severity: 'error', owner: 'structure', message: 'Structure must have exactly one lead section and it must be first.' });
  }

  for (const section of structure.sections) {
    if (!BLOCK_TYPES.has(section.blockType)) {
      issues.push({ code: 'structure_unknown_block', severity: 'error', owner: 'structure', message: `Unknown block type: ${section.blockType}.` });
    }

    if (!section.purpose.trim()) {
      issues.push({ code: 'structure_empty_purpose', severity: 'error', owner: 'structure', message: `Section ${section.id} must have purpose.` });
    }

    if (section.blockType !== 'cta' && section.blockType !== 'related' && section.blockType !== 'promo' && section.requiredClaimIds.length === 0) {
      issues.push({ code: 'structure_section_without_facts', severity: 'error', owner: 'structure', message: `Section ${section.id} must reference at least one fact.` });
    }

    for (const factId of section.requiredClaimIds) {
      if (!factIds.has(factId)) {
        issues.push({ code: 'structure_unknown_fact', severity: 'error', owner: 'structure', message: `Section ${section.id} references unknown fact ${factId}.` });
      }
    }

    if (/^(введение|выводы|преимущества|особенности)$/iu.test(section.title || '')) {
      issues.push({ code: 'structure_generic_heading', severity: 'error', owner: 'structure', message: `Section ${section.id} has generic heading; heading must carry the subject.` });
    }
  }

  for (const requiredBlock of structure.requiredBlocks) {
    if (!BLOCK_TYPES.has(requiredBlock)) {
      issues.push({ code: 'structure_unknown_required_block', severity: 'error', owner: 'structure', message: `Unknown required block type: ${requiredBlock}.` });
    }

    if (!blockTypes.includes(requiredBlock)) {
      issues.push({ code: 'structure_missing_required_block', severity: 'error', owner: 'structure', message: `Required block ${requiredBlock} is not planned in sections.` });
    }
  }

  const targetWords = structure.sections.reduce((sum, section) => sum + (section.targetWords || 0), 0);
  if (targetWords < MIN_TARGET_WORDS) {
    issues.push({ code: 'structure_target_words_low', severity: 'error', owner: 'structure', message: `Structure targetWords must be at least ${MIN_TARGET_WORDS}; got ${targetWords}.` });
  }

  if (targetWords > MAX_TARGET_WORDS) {
    issues.push({ code: 'structure_target_words_high', severity: 'error', owner: 'structure', message: `Structure targetWords must be ${MAX_TARGET_WORDS} or less; got ${targetWords}.` });
  }

  const contentSections = structure.sections.filter((section) => CONTENT_SECTION_TYPES.has(section.blockType));
  if (contentSections.length > 0 && contentSections.length < 6) {
    issues.push({ code: 'structure_too_few_sections', severity: 'error', owner: 'structure', message: `Structure must have 6-8 content sections; got ${contentSections.length}.` });
  }
  if (contentSections.length > MAX_CONTENT_SECTIONS) {
    issues.push({ code: 'structure_too_many_sections', severity: 'error', owner: 'structure', message: `Structure must have 6-8 content sections; got ${contentSections.length}.` });
  }

  const faqSection = structure.sections.find((section) => section.blockType === 'faq');
  if (!faqSection) {
    issues.push({ code: 'structure_faq_missing', severity: 'error', owner: 'structure', message: 'FAQ section is mandatory.' });
  } else if ((faqSection.plannedQuestions?.length || 0) < FAQ_MIN) {
    issues.push({ code: 'structure_faq_too_short', severity: 'error', owner: 'structure', message: `FAQ must plan at least ${FAQ_MIN} questions.` });
  }

  if (structure.materialKind === 'compare') {
    for (const blockType of ['table', 'fork', 'verdict', 'faq', 'cta']) {
      if (!blockTypes.includes(blockType)) {
        issues.push({ code: 'structure_compare_block_missing', severity: 'error', owner: 'structure', message: `Compare structure must include ${blockType}.` });
      }
    }

    const fork = structure.sections.find((section) => section.blockType === 'fork');
    if (!fork?.constraints?.some((constraint) => constraint.toLowerCase().includes('neither'))) {
      issues.push({ code: 'structure_fork_without_neither', severity: 'error', owner: 'structure', message: 'Compare fork must explicitly plan neither option.' });
    }
  }

  if (structure.missingFacts && structure.missingFacts.length > 0) {
    issues.push({ code: 'structure_missing_facts', severity: 'error', owner: 'facts', message: `Structure requires missing facts: ${structure.missingFacts.join('; ')}` });
  }

  if (!structure.plannedCta?.purpose) {
    issues.push({ code: 'structure_cta_missing', severity: 'warning', owner: 'structure', message: 'Structure should plan a topic-specific CTA purpose.' });
  }

  return issues;
}
