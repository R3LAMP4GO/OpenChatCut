import assert from 'node:assert/strict';
import { runProjectMigrations } from './index.js';

const base = {
  version: 3,
  assets: [{ id: 'video', name: 'video.mov', kind: 'video', src: 'memory://video', durationInFrames: 30, sourceRevision: 'source:video' }],
  mediaFolders: [],
  timelines: [{ id: 'tl', name: 'Timeline', order: 0, items: [], fps: 30 }],
  activeTimelineId: 'tl',
};
const legacy = runProjectMigrations(base);
assert.ok(legacy);
assert.equal(legacy.doc.takeReviewSessions, undefined, 'legacy projects load without a review collection');

const malformed = runProjectMigrations({ ...base, takeReviewSessions: [{ id: 'bad' }] });
assert.ok(malformed);
assert.equal(malformed.doc.takeReviewSessions, undefined, 'malformed review sessions are discarded without affecting media');

const stale = runProjectMigrations({ ...base, takeReviewSessions: [{ version: 1, id: 'review', createdAt: 1, status: 'ready', candidates: [{ assetId: 'video', sourceRevision: 'old', startFrame: 0, endFrame: 30 }] }] });
assert.equal(stale?.doc.takeReviewSessions?.[0]?.status, 'stale', 'relinked source revisions keep sessions visible but stale');

console.log('takeReviewSessions.verify: persisted review sessions remain optional and stale safely');
