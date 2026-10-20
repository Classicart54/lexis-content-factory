import type { MaterialKind, PipelineRequest, RequestStatus } from './core/types.js';

const STATUS_LABELS: Record<RequestStatus, string> = {
  brief_draft: 'бриф создан',
  needs_facts: 'нужны факты',
  ready_for_structure: 'готово к структуре',
  structuring: 'структура в работе',
  ready_for_writing: 'готово к тексту',
  writing: 'текст в работе',
  ready_for_assembly: 'готово к сборке',
  assembling: 'сборка JSON',
  machine_review: 'машинная приемка',
  needs_structure_revision: 'доработка структуры',
  needs_writer_revision: 'доработка текста',
  llm_review: 'LLM-ревью',
  approved: 'одобрено',
  published: 'опубликовано',
  monitoring: 'мониторинг',
  blocked: 'заблокировано',
};

const KIND_LABELS: Record<MaterialKind, string> = {
  compare: 'compare',
  guide: 'guide',
  news: 'news',
  programmatic: 'programmatic',
  unknown: 'не знаю',
};

function nextStep(request: PipelineRequest): string {
  switch (request.status) {
    case 'brief_draft':
      return 'проверить кластер, дубли и достаточность фактуры';
    case 'needs_facts':
      return 'собрать недостающие факты и источники';
    case 'ready_for_structure':
      return 'передать структурщику';
    case 'structuring':
      return 'дождаться структуры блоков';
    case 'ready_for_writing':
      return 'передать писателю';
    case 'writing':
      return 'дождаться текста блоков';
    case 'ready_for_assembly':
      return 'собрать черновик и инфографику';
    case 'assembling':
      return 'собрать итоговый { meta, blocks }';
    case 'machine_review':
      return 'запустить детерминированные проверки';
    case 'needs_structure_revision':
      return 'вернуть структурщику на исправление';
    case 'needs_writer_revision':
      return 'вернуть писателю на исправление';
    case 'llm_review':
      return 'проверить смысл, глубину и границы';
    case 'approved':
      return 'публикация';
    case 'published':
      return 'перевести в мониторинг';
    case 'monitoring':
      return 'наблюдать за опубликованным материалом';
    case 'blocked':
      return 'ждать новых фактов, источников или изменения правил допуска';
  }
}

export function formatRequestCard(request: PipelineRequest): string {
  if (request.brief.inputType === 'planned_topic') {
    return [
      `#${request.id} Тема из плана`,
      `Статус: ${STATUS_LABELS[request.status]}`,
      `Название: ${request.brief.title}`,
      `Кластер: ${request.brief.cluster}`,
      `Тип материала: ${KIND_LABELS[request.brief.materialKind]}`,
      `Цель: ${request.brief.goal}`,
      `Следующий шаг: ${nextStep(request)}`,
    ].join('\n');
  }

  return [
    `#${request.id} Новость`,
    `Статус: ${STATUS_LABELS[request.status]}`,
    `Источник: ${request.brief.sourceUrl}`,
    `Событие: ${request.brief.eventSummary}`,
    `Почему важно: ${request.brief.relevance}`,
    `Срок: ${request.brief.deadline}`,
    `Следующий шаг: ${nextStep(request)}`,
  ].join('\n');
}

export function formatRequestList(requests: PipelineRequest[]): string {
  if (requests.length === 0) return 'Активных заявок пока нет. Нажми «Новая тема» или отправь /new.';

  return requests
    .slice(0, 20)
    .map((request) => {
      const title = request.brief.inputType === 'planned_topic' ? request.brief.title : request.brief.eventSummary;
      return `#${request.id} · ${STATUS_LABELS[request.status]} · ${title}`;
    })
    .join('\n');
}

export function formatDailyReport(requests: PipelineRequest[], date = new Date()): string {
  const dayKey = toDayKey(date);
  const today = requests.filter((request) => toDayKey(new Date(request.updatedAt)) === dayKey || toDayKey(new Date(request.createdAt)) === dayKey);
  const created = requests.filter((request) => toDayKey(new Date(request.createdAt)) === dayKey);
  const completed = today.filter((request) => request.status === 'approved' || request.status === 'published' || request.status === 'monitoring');
  const monitoring = today.filter((request) => request.status === 'monitoring');
  const blocked = today.filter((request) => request.status === 'blocked');
  const inProgress = today.filter((request) => !['approved', 'published', 'monitoring', 'blocked'].includes(request.status));

  const statusLines = Object.entries(countByStatus(today))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `- ${STATUS_LABELS[status as RequestStatus]}: ${count}`);

  const materialLines = today
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20)
    .map((request) => {
      const title = request.brief.inputType === 'planned_topic' ? request.brief.title : request.brief.eventSummary;
      return `#${request.id} · ${STATUS_LABELS[request.status]} · ${title}`;
    });

  return [
    `Отчет за ${dayKey}`,
    '',
    `Создано заявок: ${created.length}`,
    `Дошло до approved/published/monitoring: ${completed.length}`,
    `В мониторинге: ${monitoring.length}`,
    `В работе: ${inProgress.length}`,
    `Заблокировано: ${blocked.length}`,
    '',
    'По статусам:',
    ...(statusLines.length > 0 ? statusLines : ['- за день движений нет']),
    '',
    'Материалы:',
    ...(materialLines.length > 0 ? materialLines : ['- нет материалов за этот день']),
  ].join('\n');
}

function countByStatus(requests: PipelineRequest[]): Partial<Record<RequestStatus, number>> {
  return requests.reduce<Partial<Record<RequestStatus, number>>>((acc, request) => {
    acc[request.status] = (acc[request.status] || 0) + 1;
    return acc;
  }, {});
}

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
