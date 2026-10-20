import { Telegraf, Markup } from 'telegraf';
import type { Context } from 'telegraf';
import { createAgentPorts } from './core/agent-factory.js';
import { ArtifactStore } from './core/artifact-store.js';
import { ContentPipeline } from './core/pipeline.js';
import { chooseNextAction } from './core/orchestrator.js';
import { findTopicBySlug, loadProjectKnowledge, summarizeTopicQueue, topicToInternalLinks, type TopicQueueItem } from './core/project-knowledge.js';
import { TopicQueueStore, type TopicQueueEntry } from './core/topic-queue.js';
import type { AgentRole, MaterialKind, NewsBrief, PipelineRequest, PlannedTopicBrief } from './core/types.js';
import { loadConfig } from './config.js';
import { formatDailyReport, formatRequestCard, formatRequestList } from './format.js';
import type { ConversationState } from './types.js';

const config = loadConfig();
const bot = new Telegraf(config.telegramBotToken);
const store = new ArtifactStore(config.dataDir);
const topicQueue = new TopicQueueStore(config.dataDir);
const projectKnowledge = await loadProjectKnowledge(config.handoffKonveyerDir);
const agents = createAgentPorts({
  neuromediaApiKey: config.neuromediaApiKey,
  neuromediaBaseUrl: config.neuromediaBaseUrl,
  neuromediaModel: config.neuromediaModel,
  neuromediaTimeoutMs: config.neuromediaTimeoutMs,
  projectKnowledge,
  contentApiUrl: config.contentApiUrl,
  contentApiToken: config.contentApiToken,
});
const pipeline = new ContentPipeline(store, agents);
const conversations = new Map<number, ConversationState>();
const topicSelections = new Map<number, Set<string>>();
let queueRunnerActive = false;

const mainKeyboard = Markup.keyboard([['Контент-план', 'Очередь'], ['Новая тема', 'Новость'], ['Активные', 'Помощь']]).resize();
const TOPIC_PLAN_PAGE_SIZE = 8;

interface QueueReporter {
  reply(text: string): Promise<void>;
}

function isString(value: string | undefined): value is string {
  return Boolean(value);
}

function userId(ctx: Context): number | null {
  return ctx.from?.id || null;
}

function userName(ctx: Context): string | undefined {
  if (!ctx.from) return undefined;
  return [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || undefined;
}

function isAllowed(ctx: Context): boolean {
  const id = userId(ctx);
  if (!id) return false;
  return !config.allowedTelegramUserIds || config.allowedTelegramUserIds.has(id);
}

async function guard(ctx: Context): Promise<boolean> {
  if (isAllowed(ctx)) return true;
  await ctx.reply('У этого Telegram-аккаунта нет доступа к боту. Добавь id в ALLOWED_TELEGRAM_USER_IDS.');
  return false;
}

function getText(ctx: Context): string | null {
  const message = ctx.message;
  if (!message || !('text' in message)) return null;
  return message.text.trim();
}

async function startNewConversation(ctx: Context, inputType?: 'planned_topic' | 'news'): Promise<void> {
  const id = userId(ctx);
  if (!id) return;

  if (!inputType) {
    conversations.set(id, { step: 'choose_input_type', draft: {} });
    await ctx.reply('Что заводим?', Markup.keyboard([['Тема из плана', 'Новость'], ['Отмена']]).resize());
    return;
  }

  if (inputType === 'planned_topic') {
    conversations.set(id, { step: 'planned_title', draft: { inputType } });
    await ctx.reply('Какое рабочее название материала?', Markup.keyboard([['Отмена']]).resize());
    return;
  }

  conversations.set(id, { step: 'news_source_url', draft: { inputType } });
  await ctx.reply('Пришли ссылку на источник новости.', Markup.keyboard([['Отмена']]).resize());
}

function parseMaterialKind(value: string): MaterialKind {
  const normalized = value.toLowerCase();
  if (normalized.includes('compare')) return 'compare';
  if (normalized.includes('guide')) return 'guide';
  if (normalized.includes('news')) return 'news';
  if (normalized.includes('program')) return 'programmatic';
  if (normalized.includes('срав')) return 'compare';
  if (normalized.includes('гайд')) return 'guide';
  if (normalized.includes('нов')) return 'news';
  if (normalized.includes('програм')) return 'programmatic';
  return 'unknown';
}

async function createPlannedTopic(ctx: Context, draft: Partial<PlannedTopicBrief>): Promise<void> {
  const telegramId = userId(ctx);
  if (!telegramId || !draft.title || !draft.cluster || !draft.materialKind || !draft.goal) {
    await ctx.reply('Не получилось собрать бриф: не хватает обязательных полей. Давай начнем заново через /new.', mainKeyboard);
    return;
  }

  const request = await pipeline.createRequest({
    brief: {
      inputType: 'planned_topic',
      title: draft.title,
      cluster: draft.cluster,
      materialKind: draft.materialKind,
      goal: draft.goal,
      knownFacts: draft.knownFacts || 'Не указано',
      forbiddenMentions: draft.forbiddenMentions || 'Не указано',
      internalLinks: draft.internalLinks || 'Не указано',
    },
    createdBy: {
      telegramId,
      username: ctx.from?.username,
      name: userName(ctx),
      source: 'telegram',
    },
    notes: ['Следующий шаг: проверить свободный кластер и достаточность фактуры.'],
  });

  await ctx.reply(`Заявка создана.\n\n${formatRequestCard(request)}\n\nЗапуск: /run ${request.id}\nПолный прогон: /run_all ${request.id}`, mainKeyboard);
}

async function createNews(ctx: Context, draft: Partial<NewsBrief>): Promise<void> {
  const telegramId = userId(ctx);
  if (!telegramId || !draft.sourceUrl || !draft.eventSummary || !draft.relevance) {
    await ctx.reply('Не получилось собрать бриф: не хватает обязательных полей. Давай начнем заново через /new.', mainKeyboard);
    return;
  }

  const request = await pipeline.createRequest({
    brief: {
      inputType: 'news',
      sourceUrl: draft.sourceUrl,
      eventSummary: draft.eventSummary,
      relevance: draft.relevance,
      competitorMentions: draft.competitorMentions || 'Не указано',
      deadline: draft.deadline || 'Не указано',
    },
    createdBy: {
      telegramId,
      username: ctx.from?.username,
      name: userName(ctx),
      source: 'telegram',
    },
    notes: ['Следующий шаг: собрать источники, дату снимка и проверить добавленную ценность.'],
  });

  await ctx.reply(`Заявка создана.\n\n${formatRequestCard(request)}\n\nЗапуск: /run ${request.id}\nПолный прогон: /run_all ${request.id}`, mainKeyboard);
}

function parseRequestId(ctx: Context): string | null {
  const message = ctx.message;
  if (!message || !('text' in message)) return null;

  const id = message.text.split(/\s+/)[1]?.replace(/^#/, '');
  if (!id) return null;

  return id.trim();
}

function parseCommandArg(ctx: Context): string | null {
  const message = ctx.message;
  if (!message || !('text' in message)) return null;

  const value = message.text.split(/\s+/)[1];
  return value ? value.trim() : null;
}

function parseCommandArgs(ctx: Context): string[] {
  const message = ctx.message;
  if (!message || !('text' in message)) return [];
  return message.text.split(/\s+/).slice(1).map((value) => value.trim()).filter(Boolean);
}

function slugFromKnownFacts(knownFacts: string): string | undefined {
  return knownFacts.match(/Slug:\s*([^\s]+)/)?.[1];
}

function urlFromKnownFacts(knownFacts: string): string | undefined {
  return knownFacts.match(/URL:\s*(\/[^\s]+)/)?.[1];
}

async function usedTopicKeys(): Promise<Set<string>> {
  const requests = await store.listRequests();
  return new Set(
    requests
      .filter((request) => request.status !== 'blocked')
      .flatMap((request) => request.brief.inputType === 'planned_topic' ? [slugFromKnownFacts(request.brief.knownFacts), urlFromKnownFacts(request.brief.knownFacts)] : [])
      .filter(isString),
  );
}

async function availableContentPlanTopics(): Promise<TopicQueueItem[]> {
  if (!projectKnowledge) return [];
  const used = await usedTopicKeys();
  return projectKnowledge.topics
    .filter((topic) => !used.has(topic.slug) && !used.has(topic.url))
    .sort((a, b) => (a.wave ?? 999) - (b.wave ?? 999) || (b.demand?.shows || 0) - (a.demand?.shows || 0));
}

function selectedTopicsFor(ctx: Context): Set<string> {
  const id = userId(ctx);
  if (!id) return new Set();
  const existing = topicSelections.get(id);
  if (existing) return existing;
  const selection = new Set<string>();
  topicSelections.set(id, selection);
  return selection;
}

function formatTopicLine(topic: TopicQueueItem, selected: boolean): string {
  const mark = selected ? '[x]' : '[ ]';
  const role = topic.role ? ` · ${topic.role}` : '';
  return `${mark} ${topic.slug} · волна ${topic.wave ?? '-'} · ${topic.demand?.shows ?? 0} показов${role}\n${topic.question}`;
}

async function showContentPlan(ctx: Context, page = 0, edit = false): Promise<void> {
  if (!projectKnowledge) {
    await ctx.reply('Контент-план не подключен. Укажи HANDOFF_KONVEYER_DIR в окружении сервиса.', mainKeyboard);
    return;
  }

  const topics = await availableContentPlanTopics();
  const totalPages = Math.max(1, Math.ceil(topics.length / TOPIC_PLAN_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const selection = selectedTopicsFor(ctx);
  const items = topics.slice(safePage * TOPIC_PLAN_PAGE_SIZE, (safePage + 1) * TOPIC_PLAN_PAGE_SIZE);

  const text = [
    `Контент-план: доступно ${topics.length} тем`,
    `Страница ${safePage + 1}/${totalPages}. Выбрано: ${selection.size}`,
    '',
    ...items.map((topic) => formatTopicLine(topic, selection.has(topic.slug))),
    '',
    'Нажми темы, которые отправить в очередь. Потом: Добавить выбранные.',
  ].join('\n\n').slice(0, 3900);

  const keyboard = Markup.inlineKeyboard([
    ...items.map((topic) => [Markup.button.callback(`${selection.has(topic.slug) ? '✓' : '+'} ${topic.slug}`, `topic_toggle:${safePage}:${topic.slug}`)]),
    [
      Markup.button.callback('Назад', `topic_page:${Math.max(0, safePage - 1)}`),
      Markup.button.callback('Вперед', `topic_page:${Math.min(totalPages - 1, safePage + 1)}`),
    ],
    [Markup.button.callback(`Добавить выбранные (${selection.size})`, 'topic_add_selected')],
    [Markup.button.callback('Сбросить выбор', `topic_clear:${safePage}`), Markup.button.callback('Показать очередь', 'topic_show_queue')],
  ]);

  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, keyboard);
      return;
    } catch (error) {
      if (!(error as Error).message.includes('message is not modified')) throw error;
      return;
    }
  }

  await ctx.reply(text, keyboard);
}

async function showRequest(ctx: Context, id: string): Promise<void> {
  const request = await store.findRequest(id);
  await ctx.reply(request ? formatRequestCard(request) : `Заявка ${id} не найдена.`, mainKeyboard);
}

async function runOneStep(ctx: Context, requestId: string): Promise<void> {
  const before = await store.findRequest(requestId);
  if (!before) {
    await ctx.reply(`Заявка ${requestId} не найдена.`, mainKeyboard);
    return;
  }

  const after = await pipeline.runNext(requestId);
  await ctx.reply(formatRunResult(before, after, false), mainKeyboard);
}

async function runAllSteps(ctx: Context, requestId: string): Promise<void> {
  const before = await store.findRequest(requestId);
  if (!before) {
    await ctx.reply(`Заявка ${requestId} не найдена.`, mainKeyboard);
    return;
  }

  const after = await pipeline.runUntilIdle(requestId);
  await ctx.reply(formatRunResult(before, after, true), mainKeyboard);
  const publicationReport = (await store.readArtifacts(requestId)).publicationReport;
  if (after.status === 'monitoring' && publicationReport?.url) {
    await ctx.reply(formatPublicationReport(after, publicationReport.url), mainKeyboard);
  }
}

async function createRequestFromTopic(ctx: Context, topic: TopicQueueItem, options: { silent?: boolean } = {}): Promise<PipelineRequest | null> {
  const telegramId = userId(ctx);
  if (!telegramId) return null;

  const existing = await findExistingTopicRequest(topic);
  if (existing) {
    if (!options.silent) await ctx.reply(`Заявка по этой теме уже есть.\n\n${formatRequestCard(existing)}\n\nЗапуск: /run ${existing.id}\nПолный прогон: /run_all ${existing.id}`, mainKeyboard);
    return existing;
  }

  const request = await pipeline.createRequest({
    brief: {
      inputType: 'planned_topic',
      title: topic.question,
      cluster: topic.cluster,
      materialKind: parseMaterialKind(topic.kind),
      goal: `Ответить на вопрос: ${topic.question}`,
      knownFacts: [
        `Источник темы: fakty/temy.json`,
        `Slug: ${topic.slug}`,
        `URL: ${topic.url}`,
        `Role: ${topic.role || 'не указано'}`,
        `Parent: ${topic.parent || 'не указано'}`,
        `Section: ${topic.section || 'не указано'}`,
        `Demand: ${topic.demand?.shows ?? 'не измерялся'} shows, ${topic.demand?.clusters ?? 'не измерялось'} clusters`,
        `Wave: ${topic.wave ?? 'не указана'}`,
        topic.slug === 'tehniki-prodazh' ? 'Boundary: не раскрывать холодные звонки как половину материала; для этого есть отдельные темы /guides/holodnye-zvonki и /guides/tehniki-holodnyh-zvonkov.' : '',
      ].join('\n'),
      forbiddenMentions: 'Не использовать факты о Lexis Voice из открытого поиска; продукт, кейсы, конкуренты, термины и ссылки брать из handoff/fakty.',
      internalLinks: projectKnowledge ? topicToInternalLinks(projectKnowledge, topic) : topic.url,
    },
    createdBy: {
      telegramId,
      username: ctx.from?.username,
      name: userName(ctx),
      source: 'telegram',
    },
    notes: [`Created from topic queue: ${topic.slug} (${topic.url}).`],
  });

  if (!options.silent) await ctx.reply(`Тема взята из очереди.\n\n${formatRequestCard(request)}\n\nЗапуск: /run ${request.id}\nПолный прогон: /run_all ${request.id}`, mainKeyboard);
  return request;
}

async function addTopicsToQueue(ctx: Context, slugs: string[]): Promise<void> {
  if (!projectKnowledge) {
    await ctx.reply('Очередь тем не подключена. Укажи HANDOFF_KONVEYER_DIR в окружении сервиса.', mainKeyboard);
    return;
  }

  if (slugs.length === 0) {
    await ctx.reply('Укажи один или несколько slug: /queue_add etapy-prodazh otrabotka-vozrazheniy holodnye-zvonki', mainKeyboard);
    return;
  }

  const added: TopicQueueEntry[] = [];
  const missing: string[] = [];
  const alreadyFinished: string[] = [];
  for (const slug of slugs) {
    const topic = findTopicBySlug(projectKnowledge, slug);
    if (!topic) {
      missing.push(slug);
      continue;
    }
    const request = await createRequestFromTopic(ctx, topic, { silent: true });
    if (!request) continue;
    if (request.status === 'monitoring' || request.status === 'published' || request.status === 'approved') {
      alreadyFinished.push(topic.slug);
      continue;
    }
    added.push(await topicQueue.add({ requestId: request.id, slug: topic.slug, url: topic.url, title: topic.question }));
  }

  await ctx.reply(
    [
      `Добавлено в очередь: ${added.length}`,
      ...added.map((item) => `- ${item.slug} · #${item.requestId} · ${item.status}`),
      ...(missing.length > 0 ? ['', `Не найдены: ${missing.join(', ')}`] : []),
      ...(alreadyFinished.length > 0 ? ['', `Уже опубликованы/готовы: ${alreadyFinished.join(', ')}`] : []),
      '',
      'Запуск очереди: /queue_run',
    ].join('\n').slice(0, 3900),
    mainKeyboard,
  );
}

async function showTopicQueue(ctx: Context): Promise<void> {
  await syncTopicQueueWithRequests();
  const items = await topicQueue.list();
  if (items.length === 0) {
    await ctx.reply('Очередь тем пуста. Добавь: /queue_add etapy-prodazh otrabotka-vozrazheniy', mainKeyboard);
    return;
  }

  await ctx.reply(
    [
      'Очередь тем:',
      ...items.slice(-20).map((item) => `#${item.requestId} · ${item.status} · ${item.slug}${item.publishedUrl ? ` · ${item.publishedUrl}` : ''}`),
    ].join('\n').slice(0, 3900),
    mainKeyboard,
  );
}

async function syncTopicQueueWithRequests(): Promise<void> {
  const items = await topicQueue.list();
  for (const item of items) {
    const request = await store.findRequest(item.requestId);
    if (!request) continue;

    if (request.status === 'monitoring') {
      const publicationReport = (await store.readArtifacts(item.requestId)).publicationReport;
      await topicQueue.update(item.requestId, { status: 'done', publishedUrl: publicationReport?.url || item.publishedUrl, note: publicationReport?.summary || item.note });
      continue;
    }

    if (request.status === 'blocked') {
      await topicQueue.update(item.requestId, { status: 'blocked', note: request.notes.at(-1) || item.note });
      continue;
    }

    if (item.status === 'blocked' || item.status === 'done') {
      await topicQueue.update(item.requestId, { status: 'pending', note: `Queue status restored from request status ${request.status}.` });
    }
  }
}

async function nextQueueWorkItem(): Promise<TopicQueueEntry | null> {
  await syncTopicQueueWithRequests();
  const items = await topicQueue.list();
  return items.find((item) => item.status === 'running') || items.find((item) => item.status === 'pending') || null;
}

async function runQueueItemUntilIdle(requestId: string, reporter: QueueReporter, maxSteps = 160): Promise<{ request: PipelineRequest; exhausted: boolean }> {
  let current = await store.findRequest(requestId);
  if (!current) throw new Error(`Request ${requestId} not found.`);

  for (let step = 0; step < maxSteps; step += 1) {
    const artifacts = await store.readArtifacts(current.id);
    const action = chooseNextAction(current, artifacts);
    if (!action) return { request: current, exhausted: false };

    await reporter.reply(formatStepStarted(current, action.role));
    const next = await pipeline.runNext(current.id);
    await reporter.reply(formatStepCompleted(current, next, action.role));
    if (next.status === current.status && next.updatedAt === current.updatedAt) return { request: next, exhausted: false };
    current = next;
    if (current.status === 'monitoring' || current.status === 'blocked') return { request: current, exhausted: false };
  }

  return { request: current, exhausted: true };
}

function formatStepStarted(request: PipelineRequest, role: AgentRole): string {
  const title = request.brief.inputType === 'planned_topic' ? request.brief.title : request.brief.eventSummary;
  return `${agentLabel(role)}: ${agentStartText(role)}\n#${request.id} · ${title}`;
}

function formatStepCompleted(before: PipelineRequest, after: PipelineRequest, role: AgentRole): string {
  const note = after.notes.slice(before.notes.length).at(-1) || after.notes.at(-1) || '';
  return `${agentLabel(role)}: ${agentDoneText(role, after)}\nСтатус: ${after.status}\n${summarizeStepNote(note)}`.trim();
}

function agentLabel(role: AgentRole): string {
  const labels: Record<AgentRole, string> = {
    orchestrator: 'Оркестратор',
    search: 'Агент поисковик',
    structure: 'Структурщик',
    writer: 'Писатель',
    infographics: 'Агент инфографики',
    validator: 'Машинная проверка',
    reviewer: 'Ревьюер',
    publisher: 'Публикатор',
  };
  return labels[role];
}

function agentStartText(role: AgentRole): string {
  const texts: Record<AgentRole, string> = {
    orchestrator: 'смотрю текущий статус и выбираю следующий шаг.',
    search: 'начал собирать факты, источники и проверять тему.',
    structure: 'получил фактуру, собираю структуру и набор блоков.',
    writer: 'получил структуру и факты, начал готовить текст.',
    infographics: 'получил черновик, подбираю визуальные блоки и собираю материал.',
    validator: 'запускаю детерминированные проверки перед ревью.',
    reviewer: 'проверяю смысл, границы темы и качество материала.',
    publisher: 'материал одобрен, отправляю на сайт.',
  };
  return texts[role];
}

function agentDoneText(role: AgentRole, request: PipelineRequest): string {
  if (request.status === 'blocked') return 'остановил материал, нужна причина из последнего сообщения.';
  const texts: Record<AgentRole, string> = {
    orchestrator: 'следующий шаг выбран.',
    search: 'информация собрана, передаю структурщику.',
    structure: request.status === 'needs_structure_revision' ? 'структура требует доработки.' : 'структура готова, передаю писателю.',
    writer: request.status === 'needs_writer_revision' ? 'текст требует доработки.' : 'текст готов, передаю на сборку и инфографику.',
    infographics: 'материал собран, передаю на машинную проверку.',
    validator: request.status === 'llm_review' ? 'проверки пройдены, передаю ревьюеру.' : 'нашёл замечания, возвращаю на доработку.',
    reviewer: request.status === 'approved' ? 'материал одобрен, передаю на публикацию.' : 'нашёл смысловые замечания, возвращаю на доработку.',
    publisher: request.status === 'monitoring' ? 'публикация завершена, материал в мониторинге.' : 'шаг публикации выполнен.',
  };
  return texts[role];
}

function summarizeStepNote(note: string): string {
  if (!note.trim()) return '';
  return note.split('\n').slice(0, 4).join('\n').slice(0, 900);
}

function queueReporter(ctx: Context): QueueReporter {
  const chatId = ctx.chat?.id;
  if (!chatId) return { reply: async (text: string) => { await ctx.reply(text, mainKeyboard); } };
  return { reply: async (text: string) => { await bot.telegram.sendMessage(chatId, text, mainKeyboard); } };
}

async function runTopicQueueWorker(reporter: QueueReporter): Promise<void> {
  try {
    while (true) {
      const item = await nextQueueWorkItem();
      if (!item) {
        await reporter.reply('Очередь закончилась: тем в работе и pending-тем больше нет.');
        return;
      }

      await topicQueue.update(item.requestId, { status: 'running', note: item.status === 'running' ? 'Resumed by Telegram queue runner.' : 'Started by Telegram queue runner.' });
      await reporter.reply(`${item.status === 'running' ? 'Продолжаю' : 'Начинаю'} тему: ${item.slug}\n#${item.requestId} · ${item.title}`);

      const before = await store.findRequest(item.requestId);
      if (!before) {
        await topicQueue.update(item.requestId, { status: 'blocked', note: 'Request disappeared from store.' });
        await reporter.reply(`Тема ${item.slug} заблокирована: заявка #${item.requestId} не найдена.`);
        continue;
      }

      const result = await runQueueItemUntilIdle(item.requestId, reporter);
      const after = result.request;
      const publicationReport = (await store.readArtifacts(item.requestId)).publicationReport;
      const url = publicationReport?.url;

      if (after.status === 'monitoring' && url) {
        await topicQueue.update(item.requestId, { status: 'done', publishedUrl: url, note: publicationReport.summary });
        await reporter.reply(formatPublicationReport(after, url));
        continue;
      }

      if (result.exhausted) {
        await topicQueue.update(item.requestId, { status: 'running', note: `Still running after long queue batch. Last status: ${after.status}.` });
        await reporter.reply(`Тема ${item.slug} все еще в работе после длинной пачки шагов.\n\n${formatRequestCard(after)}\n\nМожно продолжить той же командой: /queue_run`);
        return;
      }

      await topicQueue.update(item.requestId, { status: 'blocked', note: after.notes.at(-1) || `Stopped with status ${after.status}.` });
      await reporter.reply(`Очередь остановилась на ${item.slug}.\n\n${formatRequestCard(after)}\n\nПоследнее: ${(after.notes.at(-1) || '').slice(0, 1200)}`);
      return;
    }
  } catch (error) {
    await reporter.reply(`Очередь остановилась с ошибкой: ${(error as Error).message}`);
  } finally {
    queueRunnerActive = false;
  }
}

async function startTopicQueue(ctx: Context): Promise<void> {
  if (queueRunnerActive) {
    await ctx.reply('Очередь уже запущена. Посмотреть состояние: /queue', mainKeyboard);
    return;
  }

  queueRunnerActive = true;
  await ctx.reply('Запускаю очередь в фоне. Команда уже принята, Telegram не будет ждать весь прогон. Отчеты пришлю сюда после публикаций или остановок.', mainKeyboard);
  void runTopicQueueWorker(queueReporter(ctx));
}

function formatPublicationReport(request: PipelineRequest, url: string): string {
  const title = request.brief.inputType === 'planned_topic' ? request.brief.title : request.brief.eventSummary;
  return ['Материал опубликован', `#${request.id} · ${title}`, url].join('\n');
}

async function findExistingTopicRequest(topic: TopicQueueItem): Promise<PipelineRequest | null> {
  const requests = await store.listRequests();
  return (
    requests.find((request) => {
      if (request.status === 'blocked') return false;
      if (request.brief.inputType !== 'planned_topic') return false;
      return request.brief.knownFacts.includes(`Slug: ${topic.slug}`) || request.brief.knownFacts.includes(`URL: ${topic.url}`);
    }) || null
  );
}

function formatRunResult(before: PipelineRequest, after: PipelineRequest, fullRun: boolean): string {
  const title = fullRun ? 'Полный прогон завершен.' : 'Шаг конвейера выполнен.';
  const newNotes = after.notes.slice(before.notes.length);
  const notes = newNotes.length > 0 ? newNotes.map((note) => `- ${note}`).join('\n') : '- Новых действий нет: материал уже в конечном или заблокированном статусе.';

  return [title, '', formatRequestCard(after), '', 'Что произошло:', notes].join('\n');
}

async function handleConversation(ctx: Context, text: string): Promise<boolean> {
  const id = userId(ctx);
  if (!id) return false;

  const state = conversations.get(id);
  if (!state) return false;

  if (text === 'Отмена' || text === '/cancel') {
    conversations.delete(id);
    await ctx.reply('Ок, текущий диалог отменен.', mainKeyboard);
    return true;
  }

  switch (state.step) {
    case 'choose_input_type':
      if (text.toLowerCase().includes('нов')) {
        await startNewConversation(ctx, 'news');
      } else {
        await startNewConversation(ctx, 'planned_topic');
      }
      return true;

    case 'planned_title':
      state.draft.title = text;
      state.step = 'planned_cluster';
      await ctx.reply('Какой поисковый кластер закрываем?');
      return true;

    case 'planned_cluster':
      state.draft.cluster = text;
      state.step = 'planned_kind';
      await ctx.reply('Какой тип материала предполагается?', Markup.keyboard([['compare', 'guide'], ['news', 'programmatic'], ['Не знаю', 'Отмена']]).resize());
      return true;

    case 'planned_kind':
      state.draft.materialKind = parseMaterialKind(text);
      state.step = 'planned_goal';
      await ctx.reply('Зачем нужен материал? Какой вопрос пользователя он должен закрыть?', Markup.keyboard([['Отмена']]).resize());
      return true;

    case 'planned_goal':
      state.draft.goal = text;
      state.step = 'planned_known_facts';
      await ctx.reply('Какие факты уже есть? Можно списком. Если фактов нет, так и напиши.');
      return true;

    case 'planned_known_facts':
      state.draft.knownFacts = text;
      state.step = 'planned_forbidden_mentions';
      await ctx.reply('Кого или что нельзя упоминать? Если ограничений нет, напиши «нет».');
      return true;

    case 'planned_forbidden_mentions':
      state.draft.forbiddenMentions = text;
      state.step = 'planned_internal_links';
      await ctx.reply('Какие внутренние ссылки желательно использовать? Если не знаешь, напиши «не знаю».');
      return true;

    case 'planned_internal_links':
      state.draft.internalLinks = text;
      conversations.delete(id);
      await createPlannedTopic(ctx, state.draft as Partial<PlannedTopicBrief>);
      return true;

    case 'news_source_url':
      state.draft.sourceUrl = text;
      state.step = 'news_event_summary';
      await ctx.reply('Коротко: что произошло?');
      return true;

    case 'news_event_summary':
      state.draft.eventSummary = text;
      state.step = 'news_relevance';
      await ctx.reply('Почему это важно для отдела продаж, обучения, найма или клиентского сервиса?');
      return true;

    case 'news_relevance':
      state.draft.relevance = text;
      state.step = 'news_competitor_mentions';
      await ctx.reply('Нужно ли упоминать конкурентов? Если да, кого именно?');
      return true;

    case 'news_competitor_mentions':
      state.draft.competitorMentions = text;
      state.step = 'news_deadline';
      await ctx.reply('К какому сроку желательно выпустить материал?');
      return true;

    case 'news_deadline':
      state.draft.deadline = text;
      conversations.delete(id);
      await createNews(ctx, state.draft as Partial<NewsBrief>);
      return true;
  }
}

bot.start(async (ctx) => {
  if (!(await guard(ctx))) return;
  await ctx.reply(
    'Привет. Я бот конвейера материалов Lexis Voice. Помогу завести тему или новость, собрать бриф и провести материал по этапам.',
    mainKeyboard,
  );
});

bot.help(async (ctx) => {
  if (!(await guard(ctx))) return;
  await ctx.reply(
    [
      'Команды:',
      '/new — новая заявка',
      '/list — активные заявки',
      '/show <id> — карточка заявки',
      '/run <id> — выполнить следующий шаг конвейера',
      '/run_all <id> — прогнать до публикации, мониторинга или блокировки',
      '/topics — показать очередь тем из handoff/fakty/temy.json',
      '/content_plan — выбрать несколько тем кнопками',
      '/topics_next — ближайшие темы без уже опубликованных заявок',
      '/take_topic <slug> — создать заявку из очереди тем',
      '/queue_add <slug...> — добавить несколько тем в последовательную очередь',
      '/queue — показать очередь тем',
      '/queue_run — запускать очередь по одной теме до публикации/блока',
      '/report — отчет за сегодня',
      '/cancel — отменить текущий диалог',
    ].join('\n'),
    mainKeyboard,
  );
});

bot.command('new', async (ctx) => {
  if (!(await guard(ctx))) return;
  await startNewConversation(ctx);
});

bot.command('cancel', async (ctx) => {
  if (!(await guard(ctx))) return;
  const id = userId(ctx);
  if (id) conversations.delete(id);
  await ctx.reply('Ок, текущий диалог отменен.', mainKeyboard);
});

bot.command('list', async (ctx) => {
  if (!(await guard(ctx))) return;
  await ctx.reply(formatRequestList(await store.listRequests()), mainKeyboard);
});

bot.command('report', async (ctx) => {
  if (!(await guard(ctx))) return;
  await ctx.reply(formatDailyReport(await store.listRequests()).slice(0, 3900), mainKeyboard);
});

bot.command('today', async (ctx) => {
  if (!(await guard(ctx))) return;
  await ctx.reply(formatDailyReport(await store.listRequests()).slice(0, 3900), mainKeyboard);
});

bot.command('show', async (ctx) => {
  if (!(await guard(ctx))) return;
  const id = parseRequestId(ctx);
  if (!id) {
    await ctx.reply('Укажи id: /show A-0001');
    return;
  }

  await showRequest(ctx, id);
});

bot.command('run', async (ctx) => {
  if (!(await guard(ctx))) return;
  const id = parseRequestId(ctx);
  if (!id) {
    await ctx.reply('Укажи id: /run A-0001');
    return;
  }

  await runOneStep(ctx, id);
});

bot.command('run_all', async (ctx) => {
  if (!(await guard(ctx))) return;
  const id = parseRequestId(ctx);
  if (!id) {
    await ctx.reply('Укажи id: /run_all A-0001');
    return;
  }

  await runAllSteps(ctx, id);
});

bot.command('topics', async (ctx) => {
  if (!(await guard(ctx))) return;
  if (!projectKnowledge) {
    await ctx.reply('Очередь тем не подключена. Укажи HANDOFF_KONVEYER_DIR в окружении сервиса.', mainKeyboard);
    return;
  }

  await ctx.reply(summarizeTopicQueue(projectKnowledge).slice(0, 3900), mainKeyboard);
});

bot.command('content_plan', async (ctx) => {
  if (!(await guard(ctx))) return;
  await showContentPlan(ctx);
});

bot.command('topics_next', async (ctx) => {
  if (!(await guard(ctx))) return;
  if (!projectKnowledge) {
    await ctx.reply('Очередь тем не подключена. Укажи HANDOFF_KONVEYER_DIR в окружении сервиса.', mainKeyboard);
    return;
  }

  const requests = await store.listRequests();
  const used = new Set(requests.filter((request) => request.status !== 'blocked').flatMap((request) => request.brief.inputType === 'planned_topic' ? [slugFromKnownFacts(request.brief.knownFacts), urlFromKnownFacts(request.brief.knownFacts)] : []).filter(Boolean));
  const next = projectKnowledge.topics
    .filter((topic) => topic.wave === 1)
    .filter((topic) => !used.has(topic.slug) && !used.has(topic.url))
    .sort((a, b) => (b.demand?.shows || 0) - (a.demand?.shows || 0))
    .slice(0, 12);

  await ctx.reply(
    [
      'Ближайшие темы:',
      ...next.map((topic) => `- ${topic.slug} · ${topic.demand?.shows ?? 0} показов · ${topic.question}`),
      '',
      `Добавить несколько: /queue_add ${next.slice(0, 3).map((topic) => topic.slug).join(' ')}`,
    ].join('\n').slice(0, 3900),
    mainKeyboard,
  );
});

bot.action(/^topic_page:(\d+)$/, async (ctx) => {
  if (!(await guard(ctx))) return;
  await ctx.answerCbQuery();
  await showContentPlan(ctx, Number(ctx.match[1]), true);
});

bot.action(/^topic_toggle:(\d+):(.+)$/, async (ctx) => {
  if (!(await guard(ctx))) return;
  const page = Number(ctx.match[1]);
  const slug = ctx.match[2];
  const selection = selectedTopicsFor(ctx);
  if (selection.has(slug)) {
    selection.delete(slug);
    await ctx.answerCbQuery('Убрал из выбора');
  } else {
    selection.add(slug);
    await ctx.answerCbQuery('Добавил в выбор');
  }
  await showContentPlan(ctx, page, true);
});

bot.action(/^topic_clear:(\d+)$/, async (ctx) => {
  if (!(await guard(ctx))) return;
  selectedTopicsFor(ctx).clear();
  await ctx.answerCbQuery('Выбор очищен');
  await showContentPlan(ctx, Number(ctx.match[1]), true);
});

bot.action('topic_add_selected', async (ctx) => {
  if (!(await guard(ctx))) return;
  const selection = selectedTopicsFor(ctx);
  const slugs = [...selection];
  if (slugs.length === 0) {
    await ctx.answerCbQuery('Сначала выбери хотя бы одну тему');
    return;
  }

  selection.clear();
  await ctx.answerCbQuery('Добавляю в очередь');
  await addTopicsToQueue(ctx, slugs);
});

bot.action('topic_show_queue', async (ctx) => {
  if (!(await guard(ctx))) return;
  await ctx.answerCbQuery();
  await showTopicQueue(ctx);
});

bot.command('take_topic', async (ctx) => {
  if (!(await guard(ctx))) return;
  if (!projectKnowledge) {
    await ctx.reply('Очередь тем не подключена. Укажи HANDOFF_KONVEYER_DIR в окружении сервиса.', mainKeyboard);
    return;
  }

  const slug = parseCommandArg(ctx);
  if (!slug) {
    await ctx.reply('Укажи slug или URL: /take_topic tehniki-prodazh', mainKeyboard);
    return;
  }

  const topic = findTopicBySlug(projectKnowledge, slug);
  if (!topic) {
    await ctx.reply(`Тема ${slug} не найдена. Посмотри очередь через /topics.`, mainKeyboard);
    return;
  }

  await createRequestFromTopic(ctx, topic);
});

bot.command('queue_add', async (ctx) => {
  if (!(await guard(ctx))) return;
  await addTopicsToQueue(ctx, parseCommandArgs(ctx));
});

bot.command('queue', async (ctx) => {
  if (!(await guard(ctx))) return;
  await showTopicQueue(ctx);
});

bot.command('queue_run', async (ctx) => {
  if (!(await guard(ctx))) return;
  await startTopicQueue(ctx);
});

bot.hears('Новая тема', async (ctx) => {
  if (!(await guard(ctx))) return;
  await startNewConversation(ctx, 'planned_topic');
});

bot.hears('Контент-план', async (ctx) => {
  if (!(await guard(ctx))) return;
  await showContentPlan(ctx);
});

bot.hears('Очередь', async (ctx) => {
  if (!(await guard(ctx))) return;
  await showTopicQueue(ctx);
});

bot.hears('Новость', async (ctx) => {
  if (!(await guard(ctx))) return;
  await startNewConversation(ctx, 'news');
});

bot.hears('Активные', async (ctx) => {
  if (!(await guard(ctx))) return;
  await ctx.reply(formatRequestList(await store.listRequests()), mainKeyboard);
});

bot.hears('Помощь', async (ctx) => {
  if (!(await guard(ctx))) return;
  await ctx.reply('Используй /new, чтобы завести материал. Через /queue_add etapy-prodazh otrabotka-vozrazheniy можно поставить несколько тем в очередь, /queue_run запустит их по одной. Отчет за день: /report.', mainKeyboard);
});

bot.on('text', async (ctx) => {
  if (!(await guard(ctx))) return;
  const text = getText(ctx);
  if (!text) return;

  const handled = await handleConversation(ctx, text);
  if (!handled) {
    await ctx.reply('Не понял команду. Нажми кнопку или отправь /help.', mainKeyboard);
  }
});

bot.catch((error) => {
  console.error('Bot error:', error);
});

bot.launch();

console.log('Telegram content pipeline bot started.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
