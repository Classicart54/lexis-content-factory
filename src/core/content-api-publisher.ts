import { toLegacySiteDoc, toSiteDoc } from './site-doc-transformer.js';
import type { DraftDoc, PipelineRequest, PublicationReport, ValidationIssue } from './types.js';

export interface ContentApiPublisherOptions {
  apiUrl?: string;
  apiToken?: string;
  model?: string;
}

interface ContentApiResponse {
  ok?: boolean;
  slug?: string;
  url?: string;
  updated?: boolean;
  error?: string;
  detail?: string;
  problems?: string[];
  allowedLinks?: string[];
  note?: string;
}

export class ContentApiPublisher {
  constructor(private readonly options: ContentApiPublisherOptions) {}

  async publish(request: PipelineRequest, draft: DraftDoc): Promise<PublicationReport> {
    const publishedAt = new Date().toISOString();
    if (!this.options.apiUrl || !this.options.apiToken) {
      return {
        requestId: request.id,
        ok: false,
        issues: [{ code: 'publisher_not_configured', severity: 'error', owner: 'system', message: 'CONTENT_API_URL or CONTENT_API_TOKEN is not configured.' }],
        summary: 'Publication adapter is not configured.',
        publishedAt,
      };
    }

    const generated = toSiteDoc(request, draft, { model: this.options.model });
    const doc = process.env.CONTENT_SCHEMA_VERSION === '1' ? toLegacySiteDoc(generated) : generated;
    const response = await fetch(this.options.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ doc }),
      signal: AbortSignal.timeout(30_000),
    });

    const raw = await response.text();
    const body = parseBody(raw);
    if (response.ok && body.ok) {
      const expectedPath = `/guides/${doc.meta.slug}`;
      const publicUrl = new URL(expectedPath, 'https://lexisvoice.ru');
      if (!body.url || new URL(body.url, publicUrl).pathname !== expectedPath) {
        return { requestId: request.id, ok: false, issues: [{ code: 'publication_bad_url', severity: 'error', owner: 'system', message: 'Content API did not return the expected article URL.' }], summary: 'Publication URL is missing or incorrect.', publishedAt };
      }
      const check = await fetch(publicUrl, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
      await check.body?.cancel();
      if (!check.ok) {
        return { requestId: request.id, ok: false, statusCode: check.status, url: body.url, issues: [{ code: 'publication_not_visible', severity: 'error', owner: 'system', message: `Article was stored but public URL returned HTTP ${check.status}.` }], summary: 'Article is not publicly available.', publishedAt };
      }
      return {
        requestId: request.id,
        ok: true,
        statusCode: response.status,
        url: body.url,
        updated: Boolean(body.updated),
        issues: [],
        summary: body.updated ? `Material updated: ${body.url}` : `Material published: ${body.url}`,
        publishedAt,
      };
    }

    return {
      requestId: request.id,
      ok: false,
      statusCode: response.status,
      issues: issuesFromContentApi(response.status, body),
      summary: `Publication failed with ${response.status}: ${body.error || raw.slice(0, 240)}`,
      publishedAt,
    };
  }
}

function parseBody(raw: string): ContentApiResponse {
  try {
    return JSON.parse(raw) as ContentApiResponse;
  } catch {
    return { error: raw.slice(0, 500) };
  }
}

function issuesFromContentApi(status: number, body: ContentApiResponse): ValidationIssue[] {
  if (status === 422 && Array.isArray(body.problems)) {
    const suffix = publicationHint(body);
    return body.problems.map((problem, index) => ({ code: codeForProblem(problem, index), severity: 'error', owner: ownerForProblem(problem), message: `${problem}${suffix}` }));
  }

  if (status === 429) {
    return [{ code: 'publication_wave_limit', severity: 'error', owner: 'system', message: body.detail || 'Daily publication wave limit reached.' }];
  }

  return [{ code: `publication_http_${status}`, severity: 'error', owner: status === 401 || status === 404 || status === 503 ? 'system' : 'writer', message: body.detail || body.error || `Publication failed with HTTP ${status}.` }];
}

function codeForProblem(problem: string, index: number): string {
  if (/кластер.*уже занят/iu.test(problem)) return 'publication_cluster_occupied';
  if (/выделени|жирн|маркер|сплошное полотно/iu.test(problem)) return 'publication_not_enough_accents';
  if (/\b\d+\s+слов|максимум\s+\d+|длиннее/iu.test(problem)) return 'publication_word_count_high';
  if (/хаб|parent|сирот/iu.test(problem)) return 'publication_parent_unpublished';
  if (/related|Читайте также|ссылка|адрес/iu.test(problem)) return 'publication_related_links';
  if (/visual|инфограф|схем|visualSlots/iu.test(problem)) return 'publication_visual_issue';
  return `publication_validation_${index + 1}`;
}

function publicationHint(body: ContentApiResponse): string {
  const parts: string[] = [];
  if (body.note) parts.push(body.note);
  if (Array.isArray(body.allowedLinks) && body.allowedLinks.length > 0) {
    parts.push(`Allowed internal links: ${body.allowedLinks.slice(0, 80).join(', ')}${body.allowedLinks.length > 80 ? ', ...' : ''}`);
  }
  return parts.length > 0 ? `\n${parts.join('\n')}` : '';
}

function ownerForProblem(problem: string): ValidationIssue['owner'] {
  if (/кластер.*уже занят/iu.test(problem)) return 'system';
  if (/источник|факт|кластер|provenance|снимк/iu.test(problem)) return 'facts';
  if (/section|parent|хаб|раздел|lead|faq|related|блок|структур/iu.test(problem)) return 'structure';
  return 'writer';
}
