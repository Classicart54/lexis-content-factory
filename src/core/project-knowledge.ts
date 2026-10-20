import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PipelineRequest } from './types.js';

export interface TopicQueueItem {
  id?: number;
  slug: string;
  url: string;
  urlStatus?: string;
  kind: string;
  role?: string;
  parent?: string;
  section?: string;
  question: string;
  h1?: string;
  cluster: string;
  queries?: string[];
  priority?: string;
  queue?: string;
  status?: string;
  source?: string;
  sourceFile?: string;
  editorialType?: string;
  intent?: string;
  boundary?: string;
  productRoute?: string;
  generationMode?: string;
  demand?: {
    shows?: number;
    clusters?: number;
  } | null;
  wave?: number;
}

interface TopicsFile {
  total?: number;
  items?: TopicQueueItem[];
}

interface ContentPlanFile {
  total?: number;
  wave1Slugs?: string[];
  items?: TopicQueueItem[];
}

interface ProductFile {
  scale?: unknown;
  engines?: unknown;
  data?: unknown;
  integrations?: unknown;
}

interface ProductLinksFile {
  links?: Array<{
    href: string;
    product?: string;
    when?: string;
    anchorExample?: string;
  }>;
}

interface CasesFile {
  totals?: unknown;
  featured?: unknown[] | unknown;
  cases?: unknown[];
}

interface CompetitorsFile {
  snapshot?: string;
  competitors?: Array<{
    slug: string;
    name: string;
    site?: string;
    snapshot?: string;
    positioning?: string;
    facts?: unknown[];
    sources?: unknown[];
  }>;
}

interface TermsFile {
  terms?: Array<{
    slug?: string;
    term?: string;
    question?: string;
    definition?: string;
    owner?: string;
    href?: string;
  }>;
}

interface InternalLinksFile {
  links?: Array<{
    href: string;
    title?: string;
    rubric?: string;
  }>;
}

export interface ProjectKnowledge {
  handoffDir: string;
  topics: TopicQueueItem[];
  contentPlanTopics: TopicQueueItem[];
  legacyTopics: TopicQueueItem[];
  wave1Slugs: string[];
  product: ProductFile;
  productLinks: ProductLinksFile;
  cases: CasesFile;
  competitors: CompetitorsFile;
  terms: TermsFile;
  glossary: TermsFile;
  internalLinks: InternalLinksFile;
  editorialExperts: EditorialExpert[];
}

interface EditorialExpert {
  id: string;
  name: string;
  role: string;
  allowedUse: string;
  constraints: string[];
}

const EDITORIAL_EXPERTS: EditorialExpert[] = [
  {
    id: 'expert-alexey-zelenin',
    name: 'Алексей Зеленин',
    role: 'Директор по продажам, Co-founder Lexis Voice',
    allowedUse: 'Короткий редакционный комментарий внутри гайда: практический вывод, оговорка или управленческий критерий по теме статьи.',
    constraints: [
      'Не приписывать Алексею внешние исследования, цифры, кейсы, должности и биографические факты, которых нет в проектной фактуре.',
      'Комментарий должен быть коротким, конкретным и связанным с одним фактом или тезисом статьи.',
      'Комментарий не является внешним источником и не заменяет ссылки на источники для статистики, закона, рынка или конкурентов.',
    ],
  },
];

export async function loadProjectKnowledge(handoffDir: string | undefined): Promise<ProjectKnowledge | null> {
  if (!handoffDir) return null;

  try {
    const faktyDir = join(handoffDir, 'fakty');
    const [topics, contentPlan, product, productLinks, cases, competitors, terms, glossary, internalLinks] = await Promise.all([
      readJson<TopicsFile>(join(faktyDir, 'temy.json')),
      readOptionalJson<ContentPlanFile>(join(faktyDir, 'content-plan-guides.json'), { items: [], wave1Slugs: [] }),
      readJson<ProductFile>(join(faktyDir, 'produkt.json')),
      readOptionalJson<ProductLinksFile>(join(faktyDir, 'produktovye-ssylki.json'), { links: [] }),
      readJson<CasesFile>(join(faktyDir, 'keysy.json')),
      readJson<CompetitorsFile>(join(faktyDir, 'konkurenty.json')),
      readJson<TermsFile>(join(faktyDir, 'terminy.json')),
      readJson<TermsFile>(join(faktyDir, 'glossariy.json')),
      readJson<InternalLinksFile>(join(faktyDir, 'vnutrennie-ssylki.json')),
    ]);

    const legacyTopics = normalizeLegacyTopics(topics.items || []);
    const contentPlanTopics = normalizeContentPlanTopics(contentPlan.items || [], contentPlan.wave1Slugs || [], legacyTopics);
    const mergedTopics = mergeTopics(contentPlanTopics, legacyTopics);

    return {
      handoffDir,
      topics: mergedTopics,
      contentPlanTopics,
      legacyTopics,
      wave1Slugs: contentPlan.wave1Slugs || [],
      product,
      productLinks,
      cases,
      competitors,
      terms,
      glossary,
      internalLinks,
      editorialExperts: EDITORIAL_EXPERTS,
    };
  } catch (error) {
    throw new Error(`Cannot load project knowledge from ${handoffDir}: ${(error as Error).message}`);
  }
}

export function sortTopicsForQueue(a: TopicQueueItem, b: TopicQueueItem): number {
  return sourceRank(a) - sourceRank(b)
    || waveRank(a) - waveRank(b)
    || queueRank(a) - queueRank(b)
    || roleRank(a) - roleRank(b)
    || (b.demand?.shows || 0) - (a.demand?.shows || 0)
    || (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER)
    || a.slug.localeCompare(b.slug);
}

export function topicKnownFacts(topic: TopicQueueItem): string {
  const lines = [
    `Источник темы: fakty/${topic.sourceFile || 'temy.json'}`,
    `Slug: ${topic.slug}`,
    `URL: ${topic.url}`,
    topic.role ? `Role: ${topic.role}` : undefined,
    topic.parent ? `Parent: ${topic.parent}` : undefined,
    topic.section ? `Section: ${topic.section}` : undefined,
    topic.queue ? `Queue: ${topic.queue}` : undefined,
    topic.priority ? `Priority: ${topic.priority}` : undefined,
    topic.status ? `Status: ${topic.status}` : undefined,
    topic.editorialType ? `EditorialType: ${topic.editorialType}` : undefined,
    topic.intent ? `Intent: ${topic.intent}` : undefined,
    `Boundary: ${topic.boundary || defaultBoundary(topic)}`,
    topic.productRoute ? `ProductRoute: ${topic.productRoute}` : undefined,
    topic.generationMode ? `GenerationMode: ${topic.generationMode}` : undefined,
    topic.queries?.length ? `Queries: ${topic.queries.join('; ')}` : undefined,
    `Demand: ${formatDemand(topic.demand)}`,
    topic.wave ? `Wave: ${topic.wave}` : undefined,
  ];

  return lines.filter(isString).join('\n');
}

export function buildKnowledgeContext(knowledge: ProjectKnowledge | null, request: PipelineRequest): string {
  if (!knowledge) {
    return 'Project knowledge files are not loaded. Do not invent Lexis Voice product facts, metrics, cases or competitor facts.';
  }

  const matchedTopics = findRelevantTopics(knowledge, request).slice(0, 8);
  const matchedCompetitors = findRelevantCompetitors(knowledge, request).slice(0, 4);

  return JSON.stringify(
    {
      rules: [
        'Lexis Voice product facts, metrics and cases must come only from this project knowledge, not from web search.',
        'Editorial expert comments are allowed only for experts listed in editorialExperts. They are internal editorial commentary, not external factual sources.',
        'Competitor facts must come from konkurenty.json or the vendor own website with snapshot date; never use their marketing frame as Lexis Voice framing.',
        'Definitions from terminy.json must not be rewritten.',
        'Internal links must be selected only from vnutrennie-ssylki.json.',
      ],
      topicQueue: {
        total: knowledge.topics.length,
        relevant: matchedTopics,
      },
      product: knowledge.product,
      productLinks: knowledge.productLinks,
      cases: {
        totals: knowledge.cases.totals,
        featured: asArray(knowledge.cases.featured).slice(0, 6),
        sampleCases: knowledge.cases.cases?.slice(0, 8),
      },
      competitors: {
        snapshot: knowledge.competitors.snapshot,
        relevant: matchedCompetitors,
      },
      terms: knowledge.terms.terms?.slice(0, 40),
      glossary: knowledge.glossary.terms?.slice(0, 40),
      internalLinks: knowledge.internalLinks.links?.slice(0, 80),
      editorialExperts: knowledge.editorialExperts,
    },
    null,
    2,
  );
}

export function summarizeTopicQueue(knowledge: ProjectKnowledge): string {
  const waveOne = knowledge.topics.filter((topic) => topic.wave === 1);
  const topDemand = [...knowledge.topics]
    .sort((a, b) => (b.demand?.shows || 0) - (a.demand?.shows || 0))
    .slice(0, 20)
    .map((topic) => `${topic.url} — ${topic.question} (${topic.demand?.shows ?? 'no demand'} shows)`);

  return [
    `Topics total: ${knowledge.topics.length}`,
    `Wave 1 topics: ${waveOne.length}`,
    'Top demand topics:',
    ...topDemand,
  ].join('\n');
}

export function findTopicBySlug(knowledge: ProjectKnowledge, slugOrUrl: string): TopicQueueItem | null {
  const normalized = slugOrUrl.trim().replace(/^#/, '').replace(/^\//, '').replace(/^guides\//, '').toLowerCase();
  const normalizedUrl = slugOrUrl.trim().startsWith('/') ? slugOrUrl.trim().toLowerCase() : `/${slugOrUrl.trim().replace(/^\//, '')}`.toLowerCase();

  return (
    knowledge.topics.find((topic) => topic.slug.toLowerCase() === normalized) ||
    knowledge.topics.find((topic) => topic.url.toLowerCase() === normalizedUrl) ||
    null
  );
}

export function topicToInternalLinks(knowledge: ProjectKnowledge, topic: TopicQueueItem): string {
  const links = knowledge.internalLinks.links || [];
  const productLinks = knowledge.productLinks.links || [];
  const productRoute = topic.productRoute ? links.find((link) => link.href === topic.productRoute) || { href: topic.productRoute } : undefined;
  const preferred = [
    links.find((link) => link.href === topic.url),
    productRoute,
    ...links.filter((link) => link.rubric === 'Продукт').slice(0, 2),
    ...productLinks,
    ...links.filter((link) => link.href.startsWith('/cases')).slice(0, 2),
    ...links.filter((link) => link.href.startsWith('/glossary')).slice(0, 2),
  ].filter(Boolean) as NonNullable<ProjectKnowledge['internalLinks']['links']>;

  return [...new Map(preferred.map((link) => [link.href, link])).values()]
    .slice(0, 6)
    .map((link) => link.href)
    .join(' ');
}

function normalizeLegacyTopics(topics: TopicQueueItem[]): TopicQueueItem[] {
  return topics.map((topic) => ({
    ...topic,
    sourceFile: topic.sourceFile || 'temy.json',
    wave: topic.wave ?? 99,
  }));
}

function normalizeContentPlanTopics(topics: TopicQueueItem[], wave1Slugs: string[], legacyTopics: TopicQueueItem[]): TopicQueueItem[] {
  const legacyBySlug = new Map(legacyTopics.map((topic) => [topic.slug, topic]));
  const waveOne = new Set(wave1Slugs);
  return topics.map((topic) => {
    const legacy = legacyBySlug.get(topic.slug);
    return {
      ...legacy,
      ...topic,
      sourceFile: 'content-plan-guides.json',
      editorialType: topic.editorialType || inferEditorialType(topic),
      intent: topic.intent || inferIntent(topic),
      boundary: topic.boundary || defaultBoundary(topic),
      productRoute: topic.productRoute || inferProductRoute(topic),
      generationMode: topic.generationMode || 'standard',
      wave: topic.wave ?? (waveOne.has(topic.slug) ? 1 : 2),
      demand: topic.demand || legacy?.demand || null,
    };
  });
}

function mergeTopics(contentPlanTopics: TopicQueueItem[], legacyTopics: TopicQueueItem[]): TopicQueueItem[] {
  const merged = new Map<string, TopicQueueItem>();
  for (const topic of legacyTopics) merged.set(topic.slug, topic);
  for (const topic of contentPlanTopics) merged.set(topic.slug, topic);
  return [...merged.values()];
}

function sourceRank(topic: TopicQueueItem): number {
  return topic.sourceFile === 'content-plan-guides.json' ? 0 : 1;
}

function waveRank(topic: TopicQueueItem): number {
  return topic.wave ?? 99;
}

function queueRank(topic: TopicQueueItem): number {
  const queue = (topic.queue || topic.priority || '').toUpperCase();
  if (queue === 'A') return 0;
  if (queue === 'B') return 1;
  if (queue === 'C') return 2;
  return 9;
}

function roleRank(topic: TopicQueueItem): number {
  if (topic.role === 'hub') return 0;
  if (topic.role === 'sub') return 1;
  return 2;
}

function inferEditorialType(topic: TopicQueueItem): string {
  if (/vs|сравн|чем отличается/i.test(`${topic.slug} ${topic.question}`)) return 'comparison';
  if (/как|какие|что делать|этап|метод|техник/i.test(topic.question)) return 'method';
  return 'guide';
}

function inferIntent(topic: TopicQueueItem): string {
  if (inferEditorialType(topic) === 'comparison') return 'сравнить варианты и помочь выбрать подходящий сценарий применения';
  return 'объяснить метод или этап продаж через применение в реальном разговоре';
}

function defaultBoundary(topic: TopicQueueItem): string {
  const parent = topic.parent ? ` связать с родительской темой ${topic.parent}, но не пересказывать её полностью.` : '';
  return `одна статья отвечает на один вопрос темы; не превращать материал в общий учебник по продажам.${parent}`;
}

function inferProductRoute(topic: TopicQueueItem): string {
  const text = `${topic.slug} ${topic.question} ${topic.cluster}`.toLowerCase();
  if (/тренаж|обуч|скрипт|возраж|презентац|закрыт|потребност|вопрос/.test(text)) return '/product/call-scoring';
  if (/аналит|отчет|метрик|воронк|план|контрол/.test(text)) return '/product/sales-analytics';
  return '/product/call-scoring';
}

function formatDemand(demand: TopicQueueItem['demand']): string {
  if (!demand) return 'не измерялся shows, не измерялось clusters';
  return `${demand.shows ?? 'не измерялся'} shows, ${demand.clusters ?? 'не измерялось'} clusters`;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function findRelevantTopics(knowledge: ProjectKnowledge, request: PipelineRequest): TopicQueueItem[] {
  const query = request.brief.inputType === 'planned_topic' ? `${request.brief.title} ${request.brief.cluster}` : request.brief.eventSummary;
  const tokens = tokenize(query);
  if (tokens.length === 0) return knowledge.topics.filter((topic) => topic.wave === 1).slice(0, 8);

  return [...knowledge.topics]
    .map((topic) => ({ topic, score: scoreText(`${topic.question} ${topic.cluster} ${topic.slug}`, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (b.topic.demand?.shows || 0) - (a.topic.demand?.shows || 0))
    .map((item) => item.topic);
}

function findRelevantCompetitors(knowledge: ProjectKnowledge, request: PipelineRequest): NonNullable<CompetitorsFile['competitors']> {
  const query = request.brief.inputType === 'planned_topic' ? `${request.brief.title} ${request.brief.cluster} ${request.brief.forbiddenMentions}` : `${request.brief.eventSummary} ${request.brief.competitorMentions}`;
  const tokens = tokenize(query);

  return (knowledge.competitors.competitors || [])
    .map((competitor) => ({ competitor, score: scoreText(`${competitor.slug} ${competitor.name} ${competitor.site} ${competitor.positioning}`, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.competitor);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function scoreText(value: string, tokens: string[]): number {
  const text = value.toLowerCase();
  return tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function readOptionalJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return await readJson<T>(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

function asArray<T>(value: T[] | T | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
