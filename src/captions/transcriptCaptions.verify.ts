import assert from 'node:assert/strict';
import { captionPages } from './exportCaptions';
import { createTranscriptCaptions } from './transcriptCaptions';
import { captionsOnTrack, type TimelineState } from '../editor/types';
import { reduce } from '../editor/reducerTimeline';
import type { CaptionsData } from './types';

const completedTranscriptState = {
  id: 'transcribed-captions',
  fps: 30,
  width: 1920,
  height: 1080,
  trackOrder: ['C1', 'C2', 'A1'],
  tracks: {
    C1: { kind: 'caption' },
    C2: { kind: 'caption' },
    A1: { kind: 'audio' },
  },
  items: [{
    id: 'completed-clip',
    name: 'Completed interview.wav',
    kind: 'audio',
    src: '/completed-interview.wav',
    track: 'A1',
    startFrame: 0,
    durationInFrames: 180,
    transcript: [
      { text: 'Captions', start: 0, end: 350 },
      { text: 'are visible', start: 360, end: 900 },
    ],
  }],
} as unknown as TimelineState;

let next = completedTranscriptState;
const created = createTranscriptCaptions(
  ['completed-clip'],
  { id: 'C2', captions: null },
  (captions, track) => { next = reduce(next, { type: 'setCaptions', captions, track }); },
);

assert.equal(created, true, 'a completed transcription creates captions when the selected caption track is empty');
const selectedCaptions = captionsOnTrack(next, 'C2');
assert.ok(selectedCaptions?.enabled, 'captions are attached to the selected caption track');
assert.equal(captionsOnTrack(next, 'C1'), null, 'the non-selected caption track remains untouched');
assert.equal(selectedCaptions?.sourceItemId, 'completed-clip');
assert.ok(
  captionPages(selectedCaptions!, next.items, next.fps).length > 0,
  'caption pages provide timeline-visible cues for the completed transcript',
);

const styledEmptyCaptions: CaptionsData = {
  enabled: true,
  template: 'bold-outline',
  pacing: 'word',
  sourceEntries: [{ id: 'manual-empty', itemId: 'manual:manual-empty', label: 'Manual caption 1', words: [] }],
};
let captionsFromStyledTrack: CaptionsData | undefined;
const styledTrackCreated = createTranscriptCaptions(
  ['completed-clip'],
  { id: 'C2', captions: styledEmptyCaptions },
  (captions) => { captionsFromStyledTrack = captions; },
);
assert.equal(styledTrackCreated, true, 'an empty styled caption track receives the completed transcript');
assert.equal(captionsFromStyledTrack?.template, 'bold-outline', 'the selected caption style is preserved');
assert.equal(captionsFromStyledTrack?.sourceItemId, 'completed-clip');
assert.equal(captionsFromStyledTrack?.sourceEntries, undefined, 'empty manual entries do not suppress generated timeline cues');
assert.ok(
  captionPages(captionsFromStyledTrack!, completedTranscriptState.items, completedTranscriptState.fps).length > 0,
  'a styled caption track receives timeline-visible cues after transcription',
);

const legacySecondsPages = captionPages({
  enabled: true,
  template: 'black-bar',
  pacing: 'word',
  sourceItemId: 'legacy-parakeet',
}, [{
  id: 'legacy-parakeet',
  name: 'Legacy Parakeet.wav',
  kind: 'audio',
  track: 'A1',
  startFrame: 0,
  durationInFrames: 300,
  transcript: [
    { text: 'First', start: 0, end: 0.4 },
    { text: 'middle', start: 2.5, end: 3 },
    { text: 'last', start: 8, end: 9 },
  ],
}] as TimelineState['items'], 30);
assert.deepEqual(legacySecondsPages.map((page) => [page.start, page.end]), [[0, 400], [2500, 3000], [8000, 9000]], 'legacy Parakeet seconds are projected to their spoken timeline positions');
const overlappingLegacyPages = captionPages({
  enabled: true,
  template: 'black-bar',
  pacing: 'word',
  sourceItemId: 'legacy-parakeet',
}, [{
  id: 'legacy-parakeet', name: 'Legacy Parakeet.wav', kind: 'audio', track: 'A1', startFrame: 0, durationInFrames: 300,
  transcript: [{ text: 'This', start: 0.56, end: 1.56 }, { text: 'is', start: 0.88, end: 1.88 }],
}] as TimelineState['items'], 30);
assert.deepEqual(overlappingLegacyPages.map((page) => [Math.round(page.start), Math.round(page.end)]), [[567, 867], [867, 1867]], 'legacy overlapping word ends stop at the next spoken word frame');

console.log('transcriptCaptions.verify: completed transcription creates visible cues on the selected caption track');
