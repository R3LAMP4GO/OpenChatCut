import assert from 'node:assert/strict';
import { buildTakeRanges } from './takeRanges.js';
const ranges = buildTakeRanges({ assetId: 'video', sourceRevision: 'r1', durationInFrames: 300, fps: 30, scenes: [{ timeMs: 3000, score: .5, kind: 'cut' }], silence: [{ startMs: 6000, endMs: 8000 }] });
assert.deepEqual(ranges.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [[0, 90], [90, 180], [180, 240], [240, 300]]);
assert.equal(buildTakeRanges({ assetId: 'v', sourceRevision: 'r', durationInFrames: 20, fps: 30 }).length, 0);
console.log('takeRanges.verify: deterministic scene and silence boundaries');
