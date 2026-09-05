import assert from 'node:assert/strict';
import type { MediaAsset, ProjectDoc } from '../editor/types.js';
import { detectCandidateTakes } from './takeReviewAnalysis.js';
import { addTakeReviewSession, createTakeReviewSession } from './takeReviewReducer.js';

const video = (id: string, frames: number): MediaAsset => ({
  id, name: `${id}.mov`, kind: 'video', src: `memory://${id}`, durationInFrames: frames, sourceRevision: `source:${id}`,
});
const audio = { ...video('audio', 20), kind: 'audio' as const };
const candidates = detectCandidateTakes([video('a', 120), audio, video('b', 90), video('a', 120)]);
assert.deepEqual(candidates, [
  { assetId: 'a', sourceRevision: 'source:a', startFrame: 0, endFrame: 120 },
  { assetId: 'b', sourceRevision: 'source:b', startFrame: 0, endFrame: 90 },
], 'each unique imported video becomes a whole-clip candidate without ranking or timeline edits');

const doc = {
  version: 3, assets: [video('a', 120), video('b', 90)], mediaFolders: [], timelines: [{ id: 'tl', name: 'Timeline', order: 0, items: [], fps: 30, width: 1920, height: 1080, selectedId: null }], activeTimelineId: 'tl',
} as ProjectDoc;
const session = createTakeReviewSession(doc, ['a', 'b'], 1234);
assert.ok(session, 'two imported videos create a review batch');
assert.deepEqual(createTakeReviewSession(doc, ['a'], 1234)?.candidates, [
  { assetId: 'a', sourceRevision: 'source:a', startFrame: 0, endFrame: 120 },
], 'a one-clip batch persists exactly its imported candidate without implying a comparison');
const next = addTakeReviewSession(doc, session!);
assert.equal(next.timelines, doc.timelines, 'creating a review batch never mutates the timeline');
assert.equal(next.takeReviewSessions?.[0]?.status, 'ready');

console.log('takeReviewAnalysis.verify: imported videos become deterministic non-destructive candidates');
