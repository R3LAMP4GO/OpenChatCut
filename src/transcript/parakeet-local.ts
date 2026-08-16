import {
  PARAKEET_INFERENCE_CONTRACT,
  type ParakeetInferenceResponse,
} from '../../shared/parakeet-inference';
import type { AsrResult } from './local-asr-types';
import { TranscriptionError } from './assemblyai';

export const PARAKEET_ENGINE_KEY = 'cc.localAsrEngine';
export const PARAKEET_MODEL = 'parakeet-tdt-0.6b-v3';

export function parakeetSelected(): boolean {
  try { return localStorage.getItem(PARAKEET_ENGINE_KEY) === 'parakeet'; } catch { return false; }
}

type Word = { word?: unknown; text?: unknown; start?: unknown; end?: unknown; start_time?: unknown; end_time?: unknown };

function millisecondsFromSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : null;
}

function clipOverlappingWordEnds(chunks: AsrResult['chunks']): AsrResult['chunks'] {
  return chunks.map((chunk, index) => {
    const nextStart = chunks[index + 1]?.start;
    return nextStart != null && chunk.end > nextStart
      ? { ...chunk, end: Math.max(chunk.start, nextStart) }
      : chunk;
  });
}

/** Test seam for the validated desktop response. */
export function parseParakeetResponse(body: unknown): AsrResult {
  if (!body || typeof body !== 'object') throw new TranscriptionError('service-unavailable', 'Parakeet returned an invalid response');
  const record = body as { text?: unknown; chunks?: unknown; words?: unknown };
  const words = Array.isArray(record.chunks) ? record.chunks : record.words;
  const chunks = Array.isArray(words) ? words.flatMap((raw): AsrResult['chunks'] => {
    if (!raw || typeof raw !== 'object') return [];
    const word = raw as Word;
    const text = typeof word.word === 'string' ? word.word : typeof word.text === 'string' ? word.text : '';
    const start = millisecondsFromSeconds(word.start) ?? millisecondsFromSeconds(word.start_time);
    const end = millisecondsFromSeconds(word.end) ?? millisecondsFromSeconds(word.end_time);
    return text.trim() && start != null && end != null ? [{ text: text.trim(), start, end: Math.max(start, end) }] : [];
  }) : [];
  const timedChunks = clipOverlappingWordEnds(chunks);
  return { text: typeof record.text === 'string' ? record.text : timedChunks.map((chunk) => chunk.text).join(' '), chunks: timedChunks };
}

function parakeetLanguage(language: string): 'en' | 'en-US' | 'en-GB' {
  if (/^en$/i.test(language)) return 'en';
  if (/^en-us$/i.test(language)) return 'en-US';
  if (/^en-gb$/i.test(language)) return 'en-GB';
  throw new TranscriptionError('service-unavailable', 'Parakeet currently supports English transcription only');
}

export async function transcribeWithParakeet(source: string, language: string): Promise<AsrResult> {
  const normalizedLanguage = parakeetLanguage(language);
  if (!/^\/media\/uploads\/[^/?#]+$/.test(source)) {
    throw new TranscriptionError('source-unavailable', 'Parakeet requires a locally uploaded media file');
  }
  const desktop = window.openChatCutDesktop?.parakeet;
  if (!desktop) throw new TranscriptionError('service-unavailable', 'Parakeet is available only in the desktop app');
  try {
    const response: ParakeetInferenceResponse = await desktop.transcribe({
      requestId: crypto.randomUUID(),
      contractId: PARAKEET_INFERENCE_CONTRACT.id,
      sourcePath: source,
      language: normalizedLanguage,
    });
    return parseParakeetResponse(response);
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    throw new TranscriptionError('service-unavailable', error instanceof Error ? error.message : String(error));
  }
}
