import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PipelineRequest } from './types.js';

interface StoreShape {
  nextNumber: number;
  requests: PipelineRequest[];
}

const INITIAL_STORE: StoreShape = {
  nextNumber: 1,
  requests: [],
};

export class RequestStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'requests.json');
  }

  async list(): Promise<PipelineRequest[]> {
    const store = await this.readStore();
    return [...store.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async find(id: string): Promise<PipelineRequest | null> {
    const store = await this.readStore();
    return store.requests.find((request) => request.id.toLowerCase() === id.toLowerCase()) || null;
  }

  async create(input: Omit<PipelineRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<PipelineRequest> {
    const store = await this.readStore();
    const now = new Date().toISOString();
    const request: PipelineRequest = {
      ...input,
      id: `A-${String(store.nextNumber).padStart(4, '0')}`,
      createdAt: now,
      updatedAt: now,
    };

    store.nextNumber += 1;
    store.requests.push(request);
    await this.writeStore(store);
    return request;
  }

  private async readStore(): Promise<StoreShape> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as StoreShape;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.writeStore(INITIAL_STORE);
        return { ...INITIAL_STORE, requests: [] };
      }
      throw error;
    }
  }

  private async writeStore(store: StoreShape): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  }
}

