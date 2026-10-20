export type InputType = 'planned_topic' | 'news';

export type MaterialKind = 'compare' | 'guide' | 'news' | 'programmatic' | 'unknown';

export type RequestStatus =
  | 'brief_draft'
  | 'needs_facts'
  | 'ready_for_structure'
  | 'structuring'
  | 'ready_for_writing'
  | 'writing'
  | 'ready_for_assembly'
  | 'assembling'
  | 'machine_review'
  | 'needs_structure_revision'
  | 'needs_writer_revision'
  | 'llm_review'
  | 'approved'
  | 'published'
  | 'monitoring'
  | 'blocked';

export type AgentRole = 'orchestrator' | 'search' | 'structure' | 'writer' | 'infographics' | 'validator' | 'reviewer' | 'publisher';

export type IssueOwner = 'facts' | 'structure' | 'writer' | 'system';

export interface PlannedTopicBrief {
  inputType: 'planned_topic';
  title: string;
  cluster: string;
  materialKind: MaterialKind;
  goal: string;
  knownFacts: string;
  forbiddenMentions: string;
  internalLinks: string;
}

export interface NewsBrief {
  inputType: 'news';
  sourceUrl: string;
  eventSummary: string;
  relevance: string;
  competitorMentions: string;
  deadline: string;
}

export type RequestBrief = PlannedTopicBrief | NewsBrief;

export interface PipelineRequest {
  id: string;
  status: RequestStatus;
  brief: RequestBrief;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    telegramId?: number;
    username?: string;
    name?: string;
    source?: 'telegram' | 'cli' | 'system';
  };
  notes: string[];
}

export interface SourceRef {
  id: string;
  url: string;
  title: string;
  publisher?: string;
  retrievedAt: string;
  publishedAt?: string;
  snapshotText?: string;
  reliability: 'primary' | 'official' | 'expert' | 'media' | 'unknown';
}

export type FactClaimKind = 'product' | 'competitor' | 'market' | 'method' | 'law' | 'stat' | 'event' | 'internal' | 'unknown';

export type FactConfidence = 'high' | 'medium' | 'low';

export interface FactClaim {
  id: string;
  claim: string;
  sourceIds: string[];
  allowedInFinal: boolean;
  kind?: FactClaimKind;
  quote?: string;
  confidence?: FactConfidence;
  notes?: string;
}

export interface FactPackage {
  requestId: string;
  topicOccupied: boolean;
  sources: SourceRef[];
  claims: FactClaim[];
  gaps: string[];
  angle?: string;
  createdAt: string;
}

export interface StructureSection {
  id: string;
  blockType: string;
  title?: string;
  purpose: string;
  requiredClaimIds: string[];
  targetWords?: number;
  constraints?: string[];
  plannedQuestions?: string[];
  internalLinks?: string[];
}

export interface MaterialStructure {
  requestId: string;
  materialKind: MaterialKind;
  title: string;
  seoTitle: string;
  description: string;
  sections: StructureSection[];
  requiredBlocks: string[];
  thesis?: string;
  audience?: string;
  plannedCta?: {
    purpose: string;
    productContext?: string;
    desiredAction?: string;
  };
  missingFacts?: string[];
  risks?: string[];
  createdAt: string;
}

export interface DraftBlock {
  id: string;
  type: string;
  title?: string;
  heading?: string;
  text?: string;
  paragraphs?: string[];
  items?: unknown[];
  sourceClaimIds?: string[];
  [key: string]: unknown;
}

export interface DraftDoc {
  meta: {
    title: string;
    seoTitle: string;
    description: string;
    slug: string;
    author: string | { name: string; role?: string; kind?: string; photo?: string };
    [key: string]: unknown;
  };
  blocks: DraftBlock[];
}

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  owner: IssueOwner;
  message: string;
  path?: string;
}

export interface ValidationReport {
  requestId: string;
  ok: boolean;
  issues: ValidationIssue[];
  checkedAt: string;
}

export interface ReviewReport {
  requestId: string;
  approved: boolean;
  issues: ValidationIssue[];
  summary: string;
  checkedAt: string;
}

export interface PublicationReport {
  requestId: string;
  ok: boolean;
  statusCode?: number;
  url?: string;
  updated?: boolean;
  issues: ValidationIssue[];
  summary: string;
  publishedAt: string;
}

export interface RevisionPacket {
  requestId: string;
  source: 'fact_validation' | 'structure_validation' | 'infographics_validation' | 'machine_validation' | 'llm_review' | 'publication';
  targetStatus: RequestStatus;
  targetOwner: IssueOwner;
  attempt: number;
  issues: ValidationIssue[];
  instructions: string[];
  createdAt: string;
}

export interface InfographicSpec {
  id: string;
  title: string;
  kind?: 'hero_compare' | 'howto_steps' | 'decision_fork' | 'stats_strip' | 'cards_grid' | 'criteria_points' | 'visual_slot';
  visualKind?: 'pipeline' | 'checklist' | 'bars' | 'split';
  status?: 'derivable' | 'needs_data' | 'skip';
  sourceBlockId?: string;
  renderMode?: 'template' | 'custom_visual_slot';
  visualSlot?: {
    placement: 'after_lead' | 'after_block' | 'before_cta';
    afterBlockId?: string;
    brief: string;
    dataContract: string[];
    allowedData?: string[];
    forbiddenAdditions?: string[];
    visualGoal?: string;
    tone?: 'editorial' | 'product' | 'analytical' | 'explainer';
    designFreedom: 'layout_only' | 'custom_composition';
  };
  blockType: 'stat' | 'steps' | 'comparison' | 'timeline' | 'cards' | 'fork' | 'slot';
  data: unknown;
  items?: unknown[];
  sides?: unknown[];
  sourceClaimIds: string[];
  missingData?: string[];
}

export interface PipelineArtifacts {
  facts?: FactPackage;
  structure?: MaterialStructure;
  draft?: DraftDoc;
  infographics?: InfographicSpec[];
  assembled?: DraftDoc;
  revision?: RevisionPacket;
  validationReport?: ValidationReport;
  reviewReport?: ReviewReport;
  publicationReport?: PublicationReport;
}

export interface AgentPorts {
  runSearchAgent(request: PipelineRequest): Promise<FactPackage>;
  runStructureAgent(request: PipelineRequest, facts: FactPackage): Promise<MaterialStructure>;
  runWriterAgent(request: PipelineRequest, facts: FactPackage, structure: MaterialStructure): Promise<DraftDoc>;
  runInfographicsAgent(request: PipelineRequest, facts: FactPackage, draft: DraftDoc): Promise<InfographicSpec[]>;
  runReviewAgent(request: PipelineRequest, facts: FactPackage, draft: DraftDoc, validationReport: ValidationReport): Promise<ReviewReport>;
  publishMaterial(request: PipelineRequest, draft: DraftDoc): Promise<PublicationReport>;
}

export interface NextAction {
  role: AgentRole;
  reason: string;
}
