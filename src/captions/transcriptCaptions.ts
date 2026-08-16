import type { TrackId } from '../editor/types';
import type { CaptionsData } from './types';

export interface CaptionTrackTarget {
  id: TrackId;
  captions: CaptionsData | null;
}

/** Creates a default caption source from the clips that completed transcription. */
export function createTranscriptCaptions(
  sourceItemIds: readonly string[],
  target: CaptionTrackTarget | undefined,
  setCaptions: (captions: CaptionsData, track?: TrackId) => void,
): boolean {
  const sources = [...new Set(sourceItemIds)];
  const existing = target?.captions;
  if (!sources.length || (existing && hasCaptionSource(existing))) return false;

  setCaptions({
    enabled: true,
    template: 'black-bar',
    pacing: 'phrase',
    bilingual: false,
    ...existing,
    sourceItemId: sources[0]!,
    sources: sources.length > 1 ? sources : undefined,
    sourceMode: sources.length > 1 ? 'item' : undefined,
    sourceEntries: undefined,
    words: undefined,
    offsetFrames: undefined,
    captionVariantId: undefined,
    translation: undefined,
    translationLang: undefined,
  }, target?.id);
  return true;
}

function hasCaptionSource(captions: CaptionsData): boolean {
  return captions.sourceMode === 'timeline'
    || !!captions.sourceItemId
    || !!captions.sources?.length
    || !!captions.words?.length
    || !!captions.sourceEntries?.some((entry) => !!entry.words?.length || !entry.itemId.startsWith('manual:'));
}
