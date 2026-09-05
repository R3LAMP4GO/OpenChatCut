/// <reference lib="webworker" />
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
const MAX_TEXTS = 1_200;
const MAX_TEXT_LENGTH = 1_000;
const scope = self as unknown as DedicatedWorkerGlobalScope;
let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;

env.useBrowserCache = false;
env.allowLocalModels = false;
env.allowRemoteModels = true;

function proxyHost(): string {
  if (scope.location.origin === 'null') throw new Error('Transcript take matching requires an HTTP(S) application origin');
  return `${scope.location.origin}/api/hf-proxy`;
}
function post(message: unknown): void { scope.postMessage(message); }
function validRequest(value: unknown): value is { id: number; type: 'embed'; texts: string[] } {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return Number.isSafeInteger(request.id) && (request.id as number) > 0 && request.type === 'embed'
    && Array.isArray(request.texts) && request.texts.length > 0 && request.texts.length <= MAX_TEXTS
    && request.texts.every((text) => typeof text === 'string' && text.trim().length > 0 && text.length <= MAX_TEXT_LENGTH);
}
function normalize(vector: ArrayLike<number>): number[] {
  let magnitude = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index]!;
    if (!Number.isFinite(value)) throw new Error('Model returned an invalid embedding');
    magnitude += value * value;
  }
  if (!Number.isFinite(magnitude) || magnitude <= 0) throw new Error('Model returned an empty embedding');
  const divisor = Math.sqrt(magnitude);
  return Array.from(vector, (value) => value / divisor);
}
async function load(id: number): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;
  if (!loading) {
    env.remoteHost = proxyHost();
    loading = pipeline('feature-extraction', MODEL_ID, {
      revision: REVISION,
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (info: unknown) => {
        const item = info as { progress?: unknown; file?: unknown };
        post({ id, type: 'progress', progress: typeof item.progress === 'number' ? item.progress : undefined, file: typeof item.file === 'string' ? item.file : undefined });
      },
    }) as Promise<FeatureExtractionPipeline>;
  }
  try { extractor = await loading; return extractor; }
  finally { loading = null; }
}
async function handle(value: unknown): Promise<void> {
  if (!validRequest(value)) throw new Error('Invalid transcript embedding request');
  const model = await load(value.id);
  const output = await model(value.texts, { pooling: 'mean', normalize: true });
  const data = output.data as Float32Array;
  const dimension = Number(output.dims.at(-1));
  if (!Number.isSafeInteger(dimension) || dimension < 1 || data.length !== value.texts.length * dimension) throw new Error('Model returned malformed embeddings');
  const vectors = Array.from({ length: value.texts.length }, (_, index) => normalize(data.slice(index * dimension, (index + 1) * dimension)));
  post({ id: value.id, type: 'result', vectors });
}
scope.onmessage = (event: MessageEvent<unknown>) => {
  void handle(event.data).catch((error: unknown) => {
    const id = event.data && typeof event.data === 'object' && Number.isSafeInteger((event.data as { id?: unknown }).id) ? (event.data as { id: number }).id : 1;
    post({ id, type: 'error', message: error instanceof Error ? error.message : 'Transcript embedding failed' });
  });
};
