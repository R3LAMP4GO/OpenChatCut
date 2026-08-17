import assert from 'node:assert/strict';
import { CURRENT_PROJECT_VERSION } from '../../../shared/project-version';
import type { AgentContext } from '../context';
import { historyReduce, type AtomicAction, type History } from '../../editor/reduce';
import type { EditorCommands } from '../../editor/store';
import { activeEditorState, type ProjectDoc } from '../../editor/types';
import { buildSplitEditPlan, execSplitEditTool } from './split-edit-tools';

function context() {
  const initial: ProjectDoc = {
    version: CURRENT_PROJECT_VERSION,
    assets: [
      { id: 'outgoing_asset', name: 'Outgoing', kind: 'video', src: '/outgoing.mp4', durationInFrames: 300, width: 1920, height: 1080 },
      { id: 'incoming_asset', name: 'Incoming', kind: 'video', src: '/incoming.mp4', durationInFrames: 300, width: 1920, height: 1080 },
    ],
    mediaFolders: [], activeTimelineId: 'main',
    timelines: [{
      id: 'main', name: 'Main', order: 0, fps: 30, width: 1920, height: 1080,
      selectedId: null, trackOrder: ['video_main', 'audio_main'],
      tracks: { video_main: { kind: 'video' }, audio_main: { kind: 'audio' } },
      items: [
        { id: 'outgoing', name: 'Outgoing', kind: 'video', track: 'video_main', startFrame: 0, durationInFrames: 90, srcInFrame: 0, src: '/outgoing.mp4', sourceAssetId: 'outgoing_asset', volume: 1 },
        { id: 'incoming', name: 'Incoming', kind: 'video', track: 'video_main', startFrame: 90, durationInFrames: 90, srcInFrame: 60, src: '/incoming.mp4', sourceAssetId: 'incoming_asset', volume: 1 },
      ],
    }],
  };
  let history: History = { past: [], present: structuredClone(initial), future: [] };
  const commands = {
    batch: (actions: AtomicAction[], label?: string) => {
      history = historyReduce(history, { type: 'batch', actions, label });
    },
  } as EditorCommands;
  const ctx = {
    commands,
    getState: () => activeEditorState(history.present),
    getDoc: () => history.present,
    getCreativeMode: () => null,
    templates: [], audio: [],
  } satisfies AgentContext;
  return { ctx, history: () => history };
}

{
  const test = context();
  const args = { type: 'j-cut', outgoingId: 'outgoing', incomingId: 'incoming', durationSeconds: 0.5 };
  const preview = execSplitEditTool('plan_split_edit', args, test.ctx) as { ok: true; planRef: string };
  assert.equal(preview.ok, true);
  const result = execSplitEditTool('apply_split_edit', { ...args, planRef: preview.planRef }, test.ctx) as { ok: true; audioItemId: string };
  assert.equal(result.ok, true);
  const state = test.ctx.getState();
  const audio = state.items.find((item) => item.id === result.audioItemId)!;
  assert.equal(audio.kind, 'audio');
  assert.equal(audio.startFrame, 75, 'incoming audio leads picture by 15 frames');
  assert.equal(audio.srcInFrame, 45, 'source preroll remains aligned at the picture cut');
  assert.equal(audio.durationInFrames, 105);
  assert.equal(state.items.find((item) => item.id === 'incoming')?.volume, 0, 'incoming embedded audio is muted');
  const outgoingTail = state.items.find((item) => item.id !== 'outgoing' && item.kind === 'video' && item.startFrame === 75)!;
  assert.equal(outgoingTail.volume, 0, 'outgoing audio stops when incoming lead begins');
  assert.equal(test.history().past.length, 1, 'linked J-cut changes are one undo step');
}

{
  const test = context();
  const args = { type: 'l-cut', outgoingId: 'outgoing', incomingId: 'incoming', durationSeconds: 0.5 };
  const planned = buildSplitEditPlan(args, test.ctx);
  assert('plan' in planned);
  if (!('plan' in planned)) throw new Error('L-cut planning failed');
  const result = execSplitEditTool('apply_split_edit', { ...args, planRef: planned.plan.planRef }, test.ctx) as { ok: true; audioItemId: string };
  assert.equal(result.ok, true);
  const state = test.ctx.getState();
  const audio = state.items.find((item) => item.id === result.audioItemId)!;
  assert.equal(audio.startFrame, 90, 'outgoing audio tail begins at picture cut');
  assert.equal(audio.srcInFrame, 90, 'outgoing source audio continues exactly after its visual source');
  assert.equal(audio.durationInFrames, 15);
  assert.equal(state.items.find((item) => item.id === 'incoming')?.volume, 0, 'incoming audio is muted only during overlap');
  const continuation = state.items.find((item) => item.kind === 'video' && item.startFrame === 105)!;
  assert.notEqual(continuation.volume, 0, 'incoming embedded audio resumes after L-cut tail');
  assert.equal(test.history().past.length, 1, 'linked L-cut changes are one undo step');
}

{
  const test = context();
  const stale = execSplitEditTool('apply_split_edit', {
    type: 'j-cut', outgoingId: 'outgoing', incomingId: 'incoming', durationSeconds: 0.5, planRef: 'split-edit:stale',
  }, test.ctx) as { error: string };
  assert.match(stale.error, /stale split-edit plan/);
}

console.log('DETERMINISTIC_SPLIT_EDIT_PASSED: J/L frame math, source alignment, duplicate-audio prevention, stale plans, atomic undo');
