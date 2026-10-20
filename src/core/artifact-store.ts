import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PipelineArtifacts, PipelineRequest } from './types.js';

interface StoreShape {
  nextNumber: number;
  requests: PipelineRequest[];
}

type ArtifactKey = keyof PipelineArtifacts | 'request';

const INITIAL_STORE: StoreShape = {
  nextNumber: 1,
  requests: [],
};

const ARTIFACT_FILES: Record<ArtifactKey, string> = {
  request: 'request.json',
  facts: 'facts.v1.json',
  structure: 'structure.v1.json',
  draft: 'draft.v1.json',
  infographics: 'infographics.v1.json',
  assembled: 'assembled.v1.json',
  revision: 'revision.v1.json',
  validationReport: 'validation-report.v1.json',
  reviewReport: 'review-report.v1.json',
  publicationReport: 'publication-report.v1.json',
};

export class ArtifactStore {
  private readonly indexPath: string;
  private readonly requestsDir: string;

  constructor(private readonly dataDir: string) {
    this.indexPath = join(dataDir, 'requests.json');
    this.requestsDir = join(dataDir, 'requests');
  }

  async listRequests(): Promise<PipelineRequest[]> {
    const store = await this.readIndex();
    const requestFiles = await this.readRequestFiles();
    const byId = new Map(store.requests.map((request) => [request.id, request]));
    for (const request of requestFiles) byId.set(request.id, request);
    return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findRequest(id: string): Promise<PipelineRequest | null> {
    const fileRequest = await this.readRequestFile(id);
    if (fileRequest) return fileRequest;

    const store = await this.readIndex();
    return store.requests.find((request) => request.id.toLowerCase() === id.toLowerCase()) || null;
  }

  async createRequest(input: Omit<PipelineRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<PipelineRequest> {
    const store = await this.readIndex();
    const now = new Date().toISOString();
    const request: PipelineRequest = {
      ...input,
      id: `A-${String(store.nextNumber).padStart(4, '0')}`,
      createdAt: now,
      updatedAt: now,
    };

    store.nextNumber += 1;
    store.requests.push(request);
    await this.writeIndex(store);
    await this.writeArtifact(request.id, 'request', request);
    return request;
  }

  async updateRequest(request: PipelineRequest): Promise<PipelineRequest> {
    const store = await this.readIndex();
    const index = store.requests.findIndex((item) => item.id === request.id);
    if (index === -1) throw new Error(`Request ${request.id} not found.`);

    const nextRequest = { ...request, updatedAt: new Date().toISOString() };
    store.requests[index] = nextRequest;
    await this.writeIndex(store);
    await this.writeArtifact(request.id, 'request', nextRequest);
    return nextRequest;
  }

  async readArtifacts(requestId: string): Promise<PipelineArtifacts> {
    const [facts, structure, draft, infographics, assembled, revision, validationReport, reviewReport, publicationReport] = await Promise.all([
      this.readArtifact(requestId, 'facts'),
      this.readArtifact(requestId, 'structure'),
      this.readArtifact(requestId, 'draft'),
      this.readArtifact(requestId, 'infographics'),
      this.readArtifact(requestId, 'assembled'),
      this.readArtifact(requestId, 'revision'),
      this.readArtifact(requestId, 'validationReport'),
      this.readArtifact(requestId, 'reviewReport'),
      this.readArtifact(requestId, 'publicationReport'),
    ]);

    return { facts, structure, draft, infographics, assembled, revision, validationReport, reviewReport, publicationReport } as PipelineArtifacts;
  }

  async writeArtifact<K extends ArtifactKey>(requestId: string, key: K, value: K extends keyof PipelineArtifacts ? PipelineArtifacts[K] : PipelineRequest): Promise<void> {
    const filePath = this.artifactPath(requestId, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  private async readArtifact(requestId: string, key: keyof PipelineArtifacts): Promise<PipelineArtifacts[typeof key] | undefined> {
    try {
      const raw = await readFile(this.artifactPath(requestId, key), 'utf8');
      return JSON.parse(raw) as PipelineArtifacts[typeof key];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async readRequestFile(requestId: string): Promise<PipelineRequest | null> {
    try {
      const raw = await readFile(this.artifactPath(requestId, 'request'), 'utf8');
      return JSON.parse(raw) as PipelineRequest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async readRequestFiles(): Promise<PipelineRequest[]> {
    try {
      const ids = await readdir(this.requestsDir);
      const requests = await Promise.all(ids.map((id) => this.readRequestFile(id)));
      return requests.filter((request): request is PipelineRequest => Boolean(request));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private artifactPath(requestId: string, key: ArtifactKey): string {
    return join(this.requestsDir, requestId, ARTIFACT_FILES[key]);
  }

  private async readIndex(): Promise<StoreShape> {
    try {
      const raw = await readFile(this.indexPath, 'utf8');
      return JSON.parse(raw) as StoreShape;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.writeIndex(INITIAL_STORE);
        return { ...INITIAL_STORE, requests: [] };
      }
      throw error;
    }
  }

  private async writeIndex(store: StoreShape): Promise<void> {
    await mkdir(dirname(this.indexPath), { recursive: true });
    await writeFile(this.indexPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  }
}
