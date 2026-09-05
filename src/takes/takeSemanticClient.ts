import { fetchModelPackCatalog } from '../../shared/model-packs/client';

const MODEL_PACK_ID = 'take-semantics-lite' as const;
const MAX_TEXTS = 1_200;
const MAX_TEXT_LENGTH = 1_000;
export type TakeSemanticProgress = (progress?: number, file?: string) => void;
type WorkerRequest = { id: number; type: 'embed'; texts: string[] };
type WorkerResponse = { id: number; type: 'progress'; progress?: number; file?: string }
  | { id: number; type: 'result'; vectors: number[][] }
  | { id: number; type: 'error'; message: string };
type Pending = { resolve: (vectors: number[][]) => void; reject: (reason: unknown) => void; progress?: TakeSemanticProgress; removeAbort?: () => void };

export class TakeSemanticPackUnavailableError extends Error {
  constructor() { super('Install the transcript take-matching model pack to find paraphrases.'); }
}

export type TakeSemanticWorkerFactory = () => Worker;

export class TakeSemanticClient {
  private worker: Worker | null = null;
  private nextRequestId = 0;
  private readonly pending = new Map<number, Pending>();
  private disposed = false;
  private readonly createWorker: TakeSemanticWorkerFactory;

  constructor(createWorker: TakeSemanticWorkerFactory = () => new Worker(new URL('./takeSemantic.worker.ts', import.meta.url), { type: 'module' })) {
    this.createWorker = createWorker;
  }

  async isAvailable(): Promise<boolean> {
    const packs = await fetchModelPackCatalog();
    return packs.some((pack) => pack.id === MODEL_PACK_ID && pack.status === 'installed');
  }

  async embed(texts: readonly string[], signal?: AbortSignal, onProgress?: TakeSemanticProgress): Promise<number[][]> {
    if (signal?.aborted) throw abortError();
    if (!await this.isAvailable()) throw new TakeSemanticPackUnavailableError();
    if (texts.length === 0) return [];
    if (texts.length > MAX_TEXTS || texts.some((text) => typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_LENGTH)) {
      throw new Error('Invalid transcript embedding request');
    }
    const id = ++this.nextRequestId;
    return new Promise<number[][]>((resolve, reject) => {
      const pending: Pending = { resolve, reject, progress: onProgress };
      if (signal) {
        const abort = () => this.finish(id)?.reject(abortError());
        signal.addEventListener('abort', abort, { once: true });
        pending.removeAbort = () => signal.removeEventListener('abort', abort);
      }
      this.pending.set(id, pending);
      try { this.getWorker().postMessage({ id, type: 'embed', texts: [...texts] } satisfies WorkerRequest); }
      catch (error) { this.finish(id)?.reject(error); }
    });
  }

  cancel(): void { this.failAll(abortError()); }
  dispose(): void { this.disposed = true; this.cancel(); }

  private getWorker(): Worker {
    if (this.disposed) throw new Error('Take semantic client is disposed');
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<unknown>) => {
      try { this.handle(validateResponse(event.data)); }
      catch (error) { this.failAll(error instanceof Error ? error : new Error(String(error))); }
    };
    worker.onerror = (event) => this.failAll(new Error(event.message || 'Take semantic worker failed'));
    this.worker = worker;
    return worker;
  }

  private handle(response: WorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    if (response.type === 'progress') { pending.progress?.(response.progress, response.file); return; }
    this.finish(response.id);
    if (response.type === 'error') pending.reject(new Error(response.message));
    else pending.resolve(response.vectors);
  }

  private finish(id: number): Pending | undefined {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    this.pending.delete(id); pending.removeAbort?.(); return pending;
  }

  private failAll(error: Error): void {
    this.worker?.terminate(); this.worker = null;
    for (const id of [...this.pending.keys()]) this.finish(id)?.reject(error);
  }
}

function abortError(): DOMException { return new DOMException('Transcript take scan canceled', 'AbortError'); }
function isVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 1_024 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}
function validateResponse(value: unknown): WorkerResponse {
  if (!value || typeof value !== 'object') throw new Error('Take semantic worker returned an invalid response');
  const response = value as Record<string, unknown>;
  if (!Number.isSafeInteger(response.id) || (response.id as number) < 1) throw new Error('Take semantic worker returned an invalid request id');
  if (response.type === 'progress' && (response.progress === undefined || (typeof response.progress === 'number' && Number.isFinite(response.progress))) && (response.file === undefined || typeof response.file === 'string')) return response as WorkerResponse;
  if (response.type === 'error' && typeof response.message === 'string') return response as WorkerResponse;
  if (response.type === 'result' && Array.isArray(response.vectors) && response.vectors.every(isVector)) return response as WorkerResponse;
  throw new Error('Take semantic worker returned an invalid response payload');
}
