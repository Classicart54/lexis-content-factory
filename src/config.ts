import 'dotenv/config';

export interface AppConfig {
  telegramBotToken: string;
  dataDir: string;
  allowedTelegramUserIds: Set<number> | null;
  neuromediaApiKey?: string;
  neuromediaBaseUrl: string;
  neuromediaModel: string;
  neuromediaTimeoutMs: number;
  handoffKonveyerDir?: string;
  contentApiUrl?: string;
  contentApiToken?: string;
}

function parseAllowedUsers(value: string | undefined): Set<number> | null {
  if (!value?.trim()) return null;

  const ids = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));

  if (ids.some((id) => !Number.isInteger(id))) {
    throw new Error('ALLOWED_TELEGRAM_USER_IDS must contain comma-separated numeric ids.');
  }

  return new Set(ids);
}

export function contentApiUrlFromEnv(): string {
  return process.env.CONTENT_API_URL || process.env.LANDING_CONTENT_URL || 'http://127.0.0.1:3000/api/content';
}

export function loadConfig(): AppConfig {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required. Put it into .env or environment variables.');
  }

  return {
    telegramBotToken,
    dataDir: process.env.DATA_DIR || './data',
    allowedTelegramUserIds: parseAllowedUsers(process.env.ALLOWED_TELEGRAM_USER_IDS),
    neuromediaApiKey: process.env.NEUROMEDIA_API_KEY,
    neuromediaBaseUrl: process.env.NEUROMEDIA_BASE_URL || 'https://app.neuromedia.cloud/v1',
    neuromediaModel: process.env.NEUROMEDIA_MODEL || 'gpt-5.6-terra',
    neuromediaTimeoutMs: Number(process.env.NEUROMEDIA_TIMEOUT_MS || 120000),
    handoffKonveyerDir: process.env.HANDOFF_KONVEYER_DIR,
    contentApiUrl: contentApiUrlFromEnv(),
    contentApiToken: process.env.CONTENT_API_TOKEN,
  };
}
