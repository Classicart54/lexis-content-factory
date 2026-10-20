import type { FactClaimKind, FactConfidence, FactPackage, PipelineRequest, SourceRef } from './types.js';
import { NeuromediaClient } from './neuromedia-client.js';
import { buildKnowledgeContext, type ProjectKnowledge } from './project-knowledge.js';

interface SearchAgentJson {
  topicOccupied?: boolean;
  findings?: Array<{
    claim?: string;
    kind?: FactClaimKind;
    url?: string;
    publisher?: string;
    title?: string;
    published?: string | null;
    snapshot?: string;
    quote?: string;
    confidence?: FactConfidence;
  }>;
  unknown?: string[];
  angle?: string;
}

export class NeuromediaSearchAgent {
  constructor(
    private readonly client: NeuromediaClient,
    private readonly projectKnowledge: ProjectKnowledge | null,
  ) {}

  async run(request: PipelineRequest): Promise<FactPackage> {
    const retrievedAt = new Date().toISOString();
    const result = await this.client.createJsonCompletion<SearchAgentJson>({
      useWebSearch: true,
      messages: [
        {
          role: 'system',
          content: [
            'You are the fact search agent for Lexis Voice content pipeline.',
            'Return only valid JSON. Do not write article text.',
            'Use web search when public facts are needed.',
            'Lexis Voice is a Russian voice AI training platform for sales teams: managers talk to an AI client by voice, and the platform analyzes training sessions and real calls from CRM.',
            'Never search or invent Lexis Voice product facts, metrics, cases, scale, integrations or promises. Use only the provided project knowledge for Lexis Voice.',
            'For competitor products, use only provided competitor profiles or the vendor own website with URL and snapshot date. Do not use third-party comparisons as facts about competitors.',
            'Never collect or repeat competitor marketing framing as Lexis Voice framing.',
            'Every finding must contain a URL, publisher, snapshot date and direct quote. A quote is mandatory evidence that the page was opened.',
            'Do not invent facts, metrics, competitors, prices, dates, cases or legal claims.',
            'If evidence is weak or missing, put the problem into unknown. Missing facts are better than invented facts.',
            'Final JSON shape: {"topicOccupied":boolean,"findings":[{"claim":"one sentence as it can be used in text","kind":"product|competitor|market|method|law|stat|event","url":"https://...","publisher":"...","title":"...","published":"YYYY-MM-DD or null","snapshot":"YYYY-MM-DD","quote":"direct quote from source","confidence":"high|medium"}],"unknown":["what was not found and where you looked"],"angle":"one observation not obvious from top search results"}.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [buildSearchPrompt(request), 'Project knowledge:', buildKnowledgeContext(this.projectKnowledge, request)].join('\n\n'),
        },
      ],
    });

    return normalizeSearchResult(request.id, result, retrievedAt);
  }
}

function buildSearchPrompt(request: PipelineRequest): string {
  if (request.brief.inputType === 'news') {
    return [
      'Input type: news.',
      `Source URL from brief: ${request.brief.sourceUrl}`,
      `Event summary: ${request.brief.eventSummary}`,
      `Relevance: ${request.brief.relevance}`,
      `Competitor mentions: ${request.brief.competitorMentions}`,
      `Deadline: ${request.brief.deadline}`,
      'Task: verify the news source, find supporting or correcting public sources, and return facts that can safely be used for a Lexis Voice material.',
    ].join('\n');
  }

  return [
    'Input type: planned topic.',
    `Working title: ${request.brief.title}`,
    `Cluster: ${request.brief.cluster}`,
    `Material kind: ${request.brief.materialKind}`,
    `Goal: ${request.brief.goal}`,
    `Known facts from brief: ${request.brief.knownFacts}`,
    `Forbidden mentions: ${request.brief.forbiddenMentions}`,
    `Preferred internal links: ${request.brief.internalLinks}`,
    `Revision notes from orchestrator: ${summarizeRevisionNotes(request.notes)}`,
    'Task: check whether the topic appears occupied/covered in public search context, collect reliable public facts, and identify gaps that block confident writing.',
  ].join('\n');
}

function summarizeRevisionNotes(notes: string[]): string {
  const revisionNotes = notes.filter((note) => note.includes('Revision packet'));
  return (revisionNotes.at(-1) || notes.slice(-3).join('\n')).slice(0, 4000);
}

function normalizeSearchResult(requestId: string, result: SearchAgentJson, retrievedAt: string): FactPackage {
  const usableFindings = (result.findings || []).filter((finding) => finding.claim && finding.url && finding.publisher && finding.quote);
  const sources = usableFindings.map((finding, index) => ({
    id: `S${index + 1}`,
    url: finding.url || '',
    title: finding.title || finding.publisher || 'Untitled source',
    publisher: finding.publisher,
    retrievedAt,
    publishedAt: finding.published || undefined,
    snapshotText: finding.quote,
    reliability: reliabilityForKind(finding.kind),
  } satisfies SourceRef));

  const claims = usableFindings.map((finding, index) => ({
    id: `F${index + 1}`,
    claim: finding.claim || '',
    sourceIds: [`S${index + 1}`],
    allowedInFinal: Boolean(finding.quote && finding.url),
    kind: finding.kind || 'unknown',
    quote: finding.quote,
    confidence: finding.confidence || 'medium',
    notes: finding.snapshot ? `Snapshot: ${finding.snapshot}` : undefined,
  }));

  const gaps = [...(result.unknown || [])];
  if (sources.length === 0) gaps.push('No usable public sources returned by search agent.');
  if (claims.filter((claim) => claim.allowedInFinal).length === 0) gaps.push('No sourced claims are allowed for final text.');

  return {
    requestId,
    topicOccupied: Boolean(result.topicOccupied),
    sources,
    claims,
    gaps,
    angle: result.angle,
    createdAt: retrievedAt,
  };
}

function reliabilityForKind(kind: FactClaimKind | undefined): SourceRef['reliability'] {
  if (kind === 'law') return 'primary';
  if (kind === 'competitor' || kind === 'product') return 'official';
  if (kind === 'method' || kind === 'stat') return 'expert';
  if (kind === 'event' || kind === 'market') return 'media';
  return 'unknown';
}
