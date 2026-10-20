export interface NeuromediaClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

export class NeuromediaClient {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(private readonly options: NeuromediaClientOptions) {
    this.baseUrl = (options.baseUrl || 'https://app.neuromedia.cloud/v1').replace(/\/$/, '');
    this.model = options.model || 'gpt-5.6-terra';
  }

  async createJsonCompletion<T>(input: { messages: ChatMessage[]; useWebSearch?: boolean; temperature?: number }): Promise<T> {
    const attempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.requestJsonCompletion<T>(input);
      } catch (error) {
        lastError = error;
        if (attempt === attempts || !isRetriableNeuromediaError(error)) break;
        await delay(1000 * attempt);
      }
    }

    throw lastError;
  }

  private async requestJsonCompletion<T>(input: { messages: ChatMessage[]; useWebSearch?: boolean; temperature?: number }, allowRepair = true): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs || 120_000);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: input.messages,
          response_format: { type: 'json_object' },
          ...(input.useWebSearch ? { tools: [{ type: 'web_search' }] } : {}),
          ...(typeof input.temperature === 'number' ? { temperature: input.temperature } : {}),
        }),
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`Neuromedia API error ${response.status}: ${raw.slice(0, 1000)}`);
      }

      const data = JSON.parse(raw) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Neuromedia API returned empty assistant content.');

      try {
        return JSON.parse(content) as T;
      } catch (error) {
        if (!allowRepair || !(error instanceof SyntaxError)) throw new Error('Neuromedia API returned invalid JSON.');
        return await this.requestJsonCompletion<T>({ messages: [
          { role: 'system', content: 'Repair JSON syntax only. Return the complete valid JSON object. Preserve all fields, text, sources, numbers and facts. Do not add content, omit sections or explain the repair. Escape quotation marks within strings.' },
          { role: 'user', content },
        ] }, false);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isRetriableNeuromediaError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|timeout|aborted|empty assistant content|invalid JSON|Unexpected end of JSON|Neuromedia API error 5\d\d|Neuromedia API error 429/i.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
