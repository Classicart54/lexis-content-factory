import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type TopicQueueStatus = 'pending' | 'running' | 'done' | 'blocked';

export interface TopicQueueEntry {
  requestId: string;
  slug: string;
  url: string;
  title: string;
  status: TopicQueueStatus;
  addedAt: string;
  updatedAt: string;
  publishedUrl?: string;
  note?: string;
}

interface TopicQueueFile {
  items: TopicQueueEntry[];
}

export class TopicQueueStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'topic-queue.json');
  }

  async list(): Promise<TopicQueueEntry[]> {
    return (await this.read()).items;
  }

  async add(entry: Omit<TopicQueueEntry, 'status' | 'addedAt' | 'updatedAt'>): Promise<TopicQueueEntry> {
    const queue = await this.read();
    const existing = queue.items.find((item) => item.requestId === entry.requestId || item.slug === entry.slug && item.status !== 'done' && item.status !== 'blocked');
    if (existing) return existing;

    const now = new Date().toISOString();
    const item: TopicQueueEntry = { ...entry, status: 'pending', addedAt: now, updatedAt: now };
    queue.items.push(item);
    await this.write(queue);
    return item;
  }

  async nextPending(): Promise<TopicQueueEntry | null> {
    const queue = await this.read();
    return queue.items.find((item) => item.status === 'pending') || null;
  }

  async update(requestId: string, patch: Partial<Omit<TopicQueueEntry, 'requestId' | 'slug' | 'url' | 'title' | 'addedAt'>>): Promise<TopicQueueEntry | null> {
    const queue = await this.read();
    const index = queue.items.findIndex((item) => item.requestId === requestId);
    if (index === -1) return null;
    queue.items[index] = { ...queue.items[index], ...patch, updatedAt: new Date().toISOString() };
    await this.write(queue);
    return queue.items[index];
  }

  private async read(): Promise<TopicQueueFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as TopicQueueFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { items: [] };
      throw error;
    }
  }

  private async write(queue: TopicQueueFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
  }
}
