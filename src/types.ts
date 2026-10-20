export type InputType = 'planned_topic' | 'news';

export type MaterialKind = 'compare' | 'guide' | 'news' | 'programmatic' | 'unknown';

export type RequestStatus =
  | 'brief_draft'
  | 'needs_facts'
  | 'ready_for_structure'
  | 'structuring'
  | 'writing'
  | 'assembling'
  | 'machine_review'
  | 'llm_review'
  | 'approved'
  | 'blocked';

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
    telegramId: number;
    username?: string;
    name?: string;
  };
  notes: string[];
}

export type ConversationStep =
  | 'choose_input_type'
  | 'planned_title'
  | 'planned_cluster'
  | 'planned_kind'
  | 'planned_goal'
  | 'planned_known_facts'
  | 'planned_forbidden_mentions'
  | 'planned_internal_links'
  | 'news_source_url'
  | 'news_event_summary'
  | 'news_relevance'
  | 'news_competitor_mentions'
  | 'news_deadline';

export interface ConversationDraft {
  inputType?: InputType;
  title?: string;
  cluster?: string;
  materialKind?: MaterialKind;
  goal?: string;
  knownFacts?: string;
  forbiddenMentions?: string;
  internalLinks?: string;
  sourceUrl?: string;
  eventSummary?: string;
  relevance?: string;
  competitorMentions?: string;
  deadline?: string;
}

export interface ConversationState {
  step: ConversationStep;
  draft: ConversationDraft;
}
