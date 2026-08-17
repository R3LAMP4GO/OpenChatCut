import assert from 'node:assert/strict';
import { makeDraft } from '../../editor/store';
import { historyReduce, type AtomicAction } from '../../editor/reduce';
import type { TimelineState } from '../../editor/types';
import { docFromTimeline } from '../../persist/projectStore';
import type { AgentContext } from '../context';
import { applyShortformPlan, buildShortformPlan, type ShortformScores } from './shortform-clip-tools';

const transcript = Array.from({ length: 12 }, (_, index) => ({ id: `w${index}`, text: `word${index}`, start: index * 1000, end: (index + 1) * 1000 }));
const state: TimelineState = {
  fps: 30, width: 1920, height: 1080, selectedId: null,
  trackOrder: ['V1'], tracks: { V1: { kind: 'video' } },
  items: [
    { id: 'talk', track: 'V1', startFrame: 0, durationInFrames: 360, name: 'Talk', kind: 'video', src: '/talk.mp4', transcript },
    { id: 'visual', track: 'V2', startFrame: 120, durationInFrames: 120, name: 'Visual proof', kind: 'image', src: '/proof.png' },
  ],
};
const scores = (patch: Partial<ShortformScores> = {}): ShortformScores => ({
  hookStrength: 8, curiosity: 8, contextCompleteness: 8, payoff: 8, specificity: 8, emotion: 5, visualSupport: 7,
  misleadingPenalty: 0, incompletePenalty: 0, ...patch,
});
const args = {
  preset: 'curiosity', ratio: '9:16', minSeconds: 3, maxSeconds: 10, maxClips: 3,
  candidates: [
    { sourceItemId: 'talk', startWordIndex: 0, endWordIndex: 5, title: 'Complete answer', reason: 'Hook and payoff', scores: scores({ hookStrength: 9 }) },
    { sourceItemId: 'talk', startWordIndex: 2, endWordIndex: 6, title: 'Overlapping weaker cut', reason: 'Duplicates the answer', scores: scores({ hookStrength: 5, incompletePenalty: 4 }) },
    { sourceItemId: 'talk', startWordIndex: 8, endWordIndex: 11, title: 'Specific ending', reason: 'Standalone ending', scores: scores({ specificity: 10 }) },
  ],
};
const baseDoc = docFromTimeline(state);
const draft = makeDraft(baseDoc);
let applyCount = 0;
const commands = { ...draft.commands, applyDoc: (doc: Parameters<typeof draft.commands.applyDoc>[0]) => { applyCount += 1; draft.commands.applyDoc(doc); } };
const ctx = { commands, getState: draft.getState, getDoc: draft.getDoc, getCreativeMode: () => null, templates: [], audio: [] } as AgentContext;

const planned = buildShortformPlan(args, ctx);
assert.ok('ok' in planned && planned.ok);
if (!('ok' in planned)) throw new Error('planning failed');
assert.equal(draft.getDoc().timelines.length, 1, 'preview does not mutate');
assert.equal(planned.plan.candidates.length, 2, 'overlapping candidate is deduplicated');
assert.equal(planned.plan.rejected.some((entry) => entry.reason.includes('overlaps')), true);
assert.deepEqual(planned.plan.candidates.map((candidate) => [candidate.startFrame, candidate.endFrame]), [[0, 180], [240, 360]], 'cuts snap to exact word timestamps');
assert.equal(planned.plan.safeFraming, 'contain');

const result = applyShortformPlan({ ...args, planRef: planned.plan.planRef, approvedCandidateIds: planned.plan.candidates.map((candidate) => candidate.candidateId) }, ctx) as { ok: boolean; count: number; clips: Array<{ timelineId: string; sourceReference: { itemId: string } }> };
assert.equal(result.ok, true);
assert.equal(result.count, 2);
assert.equal(applyCount, 1, 'all approved clips commit through one document action');
assert.equal(draft.getDoc().timelines.length, 3);
for (const clip of result.clips) {
  const timeline = draft.getDoc().timelines.find((candidate) => candidate.id === clip.timelineId)!;
  assert.deepEqual([timeline.width, timeline.height, timeline.fit], [1080, 1920, 'contain']);
  assert.equal(Object.values(timeline.tracks ?? {}).some((track) => track?.kind === 'caption' && track.captions?.enabled), true, 'clip has transcript captions');
  assert.equal(clip.sourceReference.itemId, 'talk');
}
const committedActions = draft.takeActions();
assert.equal(committedActions.length, 1, 'apply records one project action');
let history = historyReduce({ past: [], present: baseDoc, future: [] }, committedActions[0] as AtomicAction);
history = historyReduce(history, { type: 'undo' });
assert.equal(history.present.timelines.length, 1, 'one undo removes every created clip');
history = historyReduce(history, { type: 'redo' });
assert.equal(history.present.timelines.length, 3, 'one redo restores every created clip');

const staleDraft = makeDraft(docFromTimeline(state));
const staleCtx = { commands: staleDraft.commands, getState: staleDraft.getState, getDoc: staleDraft.getDoc, getCreativeMode: () => null, templates: [], audio: [] } as AgentContext;
const stalePlan = buildShortformPlan(args, staleCtx);
if (!('ok' in stalePlan)) throw new Error('stale fixture planning failed');
staleDraft.commands.moveItem('talk', { startFrame: 30 });
const stale = applyShortformPlan({ ...args, planRef: stalePlan.plan.planRef, approvedCandidateIds: [stalePlan.plan.candidates[0]!.candidateId] }, staleCtx) as { error: string };
assert.match(stale.error, /stale/);
assert.equal(staleDraft.getDoc().timelines.length, 1, 'stale apply creates nothing');

const penalized = buildShortformPlan({ ...args, candidates: [{ ...args.candidates[0], scores: scores({ misleadingPenalty: 10, incompletePenalty: 10 }) }] }, staleCtx);
assert.ok('ok' in penalized && penalized.plan.candidates[0]!.score < 1, 'misleading/incomplete penalties materially reduce score');

console.log('SHORTFORM_CLIP_WORKFLOW_PASSED: scored preview, word snapping, dedupe, stale rejection, captions, safe framing, source references, atomic apply');
