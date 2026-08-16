export const PARAKEET_INFERENCE_CONTRACT = {
  id: 'parakeet-tdt-0.6b-v3-english-word-v1',
} as const;

export const PARAKEET_INFERENCE_CHANNELS = {
  transcribe: 'openchatcut:parakeet-transcribe',
  cancel: 'openchatcut:parakeet-cancel',
} as const;

export interface ParakeetInferenceRequest {
  readonly requestId: string;
  readonly contractId: typeof PARAKEET_INFERENCE_CONTRACT.id;
  readonly sourcePath: string;
  readonly language: 'en' | 'en-US' | 'en-GB';
}

export interface ParakeetWordTimestamp {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface ParakeetInferenceResponse {
  readonly requestId: string;
  readonly text: string;
  readonly chunks: readonly ParakeetWordTimestamp[];
}

const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_SOURCE_PATH = 2_048;
const ENGLISH_LANGUAGE = /^(en|en-US|en-GB)$/i;

export function isParakeetInferenceRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value);
}

function validSourcePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SOURCE_PATH
    || !value.startsWith('/media/uploads/') || value.includes('\\')) return false;
  try {
    const parsed = new URL(value, 'http://openchatcut.local');
    return parsed.origin === 'http://openchatcut.local'
      && parsed.search === ''
      && parsed.hash === ''
      && /^\/media\/uploads\/[^/]+$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

export function parseParakeetInferenceRequest(value: unknown): ParakeetInferenceRequest {
  if (typeof value !== 'object' || value === null
    || !hasExactKeys(value, ['requestId', 'contractId', 'sourcePath', 'language'])) {
    throw new Error('invalid Parakeet transcription request');
  }
  const request = value as Partial<ParakeetInferenceRequest>;
  if (!isParakeetInferenceRequestId(request.requestId)
    || request.contractId !== PARAKEET_INFERENCE_CONTRACT.id
    || !validSourcePath(request.sourcePath)
    || typeof request.language !== 'string' || !ENGLISH_LANGUAGE.test(request.language)) {
    throw new Error('invalid Parakeet transcription request');
  }
  return {
    requestId: request.requestId,
    contractId: request.contractId,
    sourcePath: request.sourcePath,
    language: request.language.toLowerCase() === 'en-us' ? 'en-US'
      : request.language.toLowerCase() === 'en-gb' ? 'en-GB' : 'en',
  };
}

export function isParakeetInferenceResponse(value: unknown): value is ParakeetInferenceResponse {
  if (typeof value !== 'object' || value === null
    || !hasExactKeys(value, ['requestId', 'text', 'chunks'])) return false;
  const response = value as Partial<ParakeetInferenceResponse>;
  return isParakeetInferenceRequestId(response.requestId)
    && typeof response.text === 'string'
    && Array.isArray(response.chunks)
    && response.chunks.every((chunk) => typeof chunk === 'object' && chunk !== null
      && hasExactKeys(chunk, ['text', 'start', 'end'])
      && typeof Reflect.get(chunk, 'text') === 'string'
      && typeof Reflect.get(chunk, 'start') === 'number' && Number.isFinite(Reflect.get(chunk, 'start'))
      && Reflect.get(chunk, 'start') >= 0
      && typeof Reflect.get(chunk, 'end') === 'number' && Number.isFinite(Reflect.get(chunk, 'end'))
      && Reflect.get(chunk, 'end') >= Reflect.get(chunk, 'start'));
}
