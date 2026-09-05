import assert from 'node:assert/strict';
import { reduce } from '../editor/reduce';
import type { TimelineItem, TimelineState } from '../editor/types';
import { visibleSegments } from './visibleSegments';

const base: TimelineItem = {
  id: 'parent', track: 'video-main', kind: 'video', name: 'take.mov', src: '/take.mov',
  startFrame: 100, durationInFrames: 20,
  transcript: [
    { text: 'first', start: 0, end: 1000 },
    { text: 'deleted', start: 1000, end: 2000 },
    { text: 'last', start: 2000, end: 3000 },
  ],
};

const deletedWord = visibleSegments({ ...base, deletedWordIdx: [1] }, 10);
assert.deepEqual(deletedWord.map(({ startFrame, durationInFrames, sourceStartFrame, sourceEndFrame }) => (
  { startFrame, durationInFrames, sourceStartFrame, sourceEndFrame }
)), [
  { startFrame: 100, durationInFrames: 10, sourceStartFrame: 0, sourceEndFrame: 10 },
  { startFrame: 110, durationInFrames: 10, sourceStartFrame: 20, sourceEndFrame: 30 },
]);
assert.ok(deletedWord.every((segment) => segment.sourceEndFrame <= 10 || segment.sourceStartFrame >= 20));

const reduced = reduce({
  fps: 10, width: 1920, height: 1080, selectedId: null, items: [base], transitions: [],
} satisfies TimelineState, { type: 'deleteWords', id: base.id, idxs: [1] });
assert.equal(reduced.items.length, 1, 'transcript deletion retains one persisted parent item');
assert.deepEqual(visibleSegments(reduced.items[0], 10), deletedWord, 'reducer output projects the same visible subclips');

const deletedGap = visibleSegments({
  ...base,
  durationInFrames: 20,
  transcript: [
    { text: 'before', start: 0, end: 1000 },
    { text: 'after', start: 3000, end: 4000 },
  ],
  gapCapsMs: { 1: 0 },
}, 10);
assert.deepEqual(deletedGap.map(({ startFrame, durationInFrames, sourceStartFrame, sourceEndFrame }) => (
  { startFrame, durationInFrames, sourceStartFrame, sourceEndFrame }
)), [
  { startFrame: 100, durationInFrames: 10, sourceStartFrame: 0, sourceEndFrame: 10 },
  { startFrame: 110, durationInFrames: 10, sourceStartFrame: 30, sourceEndFrame: 40 },
]);

console.log('visibleSegments.verify: transcript cuts project into distinct retained subclips');
