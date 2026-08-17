import assert from 'node:assert/strict';
import { makeDraft } from '../../editor/store';
import { docFromTimeline } from '../../persist/projectStore';
import type { AgentContext } from '../context';
import { execCutStrategyTool, planCutStrategy, setCutStrategyEnabled } from './cut-strategy-tools';

const items = Array.from({ length: 8 }, (_, index) => ({
  id: `clip_${index}`, track: 'V1', startFrame: index * 30, durationInFrames: 30,
  name: `Clip ${index}`, kind: 'video' as const, src: `/clip-${index}.mp4`, srcInFrame: 30,
}));
const draft = makeDraft(docFromTimeline({
  fps: 30, width: 1920, height: 1080, selectedId: null,
  trackOrder: ['V1'], tracks: { V1: { kind: 'video' } }, items,
}));
const ctx = { commands: draft.commands, getState: draft.getState, getDoc: draft.getDoc, getCreativeMode: () => null, templates: [], audio: [] } as AgentContext;
const observation = (outgoingId: string, incomingId: string, patch: Record<string, unknown>) => ({
  outgoingId, incomingId, audioMotivation: 'none', outgoingVisualUseful: false,
  incomingVisualAddsContext: false, reactionValue: 0, lipSyncRisk: 1, visualMatch: 0,
  pacing: 'natural', confidence: 0.9, rationale: 'Verified transcript and boundary-frame evidence.', ...patch,
});

setCutStrategyEnabled(false);
const disabled = planCutStrategy({ boundaries: [observation('clip_0', 'clip_1', {})] }, ctx) as { enabled: boolean; error: string };
assert.equal(disabled.enabled, false);
assert.match(disabled.error, /off/);
await execCutStrategyTool('configure_cut_strategy', { enabled: true }, ctx);
const result = planCutStrategy({ boundaries: [
  observation('clip_0', 'clip_1', { audioMotivation: 'incoming', outgoingVisualUseful: true }),
  observation('clip_2', 'clip_3', { audioMotivation: 'outgoing', incomingVisualAddsContext: true, pacing: 'quick' }),
  observation('clip_4', 'clip_5', { visualMatch: 9 }),
  observation('clip_6', 'clip_7', { audioMotivation: 'incoming', outgoingVisualUseful: true, lipSyncRisk: 8 }),
] }, ctx) as { ok: boolean; mutated: boolean; recommendations: Array<{ type: string; durationSeconds: number | null; nextTool: string | null }> };
assert.equal(result.ok, true);
assert.equal(result.mutated, false);
assert.deepEqual(result.recommendations.map((entry) => [entry.type, entry.durationSeconds, entry.nextTool]), [
  ['j-cut', 0.5, 'plan_split_edit'],
  ['l-cut', 0.3, 'plan_split_edit'],
  ['match-cut', null, null],
  ['regular-cut', null, null],
]);
assert.equal(draft.takeActions().length, 0, 'strategy planning never mutates the timeline');

const lowConfidence = planCutStrategy({ boundaries: [observation('clip_0', 'clip_1', {
  audioMotivation: 'incoming', outgoingVisualUseful: true, confidence: 0.5,
})] }, ctx) as { recommendations: Array<{ type: string }> };
assert.equal(lowConfidence.recommendations[0]!.type, 'regular-cut');
const invalidAdjacency = planCutStrategy({ boundaries: [observation('clip_0', 'clip_2', {})] }, ctx) as { error: string };
assert.match(invalidAdjacency.error, /adjacent/);
await execCutStrategyTool('configure_cut_strategy', { enabled: false }, ctx);
assert.equal((planCutStrategy({ boundaries: [observation('clip_0', 'clip_1', {})] }, ctx) as { enabled: boolean }).enabled, false);

console.log('CUT_STRATEGY_PLANNER_PASSED: on/off control, fail-closed regular cuts, semantic J/L/match policy, paced durations, adjacency validation, preview isolation');
