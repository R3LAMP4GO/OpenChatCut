import assert from 'node:assert/strict';
import { CURRENT_PROJECT_VERSION } from '../../shared/project-version';
import type { AgentContext, AgentReference } from './context';
import { historyReduce, type AtomicAction, type History } from '../editor/reduce';
import type { EditorCommands } from '../editor/store';
import { activeEditorState, type ProjectDoc } from '../editor/types';
import { executeDeterministicCommand, isDeterministicCommandCandidate } from './deterministic-command';

function environment(approval: 'auto' | 'manual' = 'auto') {
  const initial: ProjectDoc = {
    version: CURRENT_PROJECT_VERSION,
    assets: [
      { id: 'out_asset', name: 'Out', kind: 'video', src: '/out.mp4', durationInFrames: 300, width: 1920, height: 1080 },
      { id: 'in_asset', name: 'In', kind: 'video', src: '/in.mp4', durationInFrames: 300, width: 1920, height: 1080 },
    ],
    mediaFolders: [], activeTimelineId: 'main',
    timelines: [{
      id: 'main', name: 'Main', order: 0, fps: 30, width: 1920, height: 1080,
      selectedId: 'out', selectedIds: ['out'], trackOrder: ['video_main', 'audio_main'],
      tracks: { video_main: { kind: 'video' }, audio_main: { kind: 'audio' } },
      items: [
        {
          id: 'out', name: 'Out', kind: 'video', track: 'video_main', startFrame: 0, durationInFrames: 90,
          srcInFrame: 0, src: '/out.mp4', sourceAssetId: 'out_asset', volume: 1,
          transcript: [{ text: 'Caption me.', start: 0, end: 1_000 }],
        },
        { id: 'in', name: 'In', kind: 'video', track: 'video_main', startFrame: 90, durationInFrames: 90, srcInFrame: 60, src: '/in.mp4', sourceAssetId: 'in_asset', volume: 1 },
      ],
    }],
  };
  let history: History = { past: [], present: structuredClone(initial), future: [] };
  const dispatch = (action: AtomicAction) => { history = historyReduce(history, action); };
  const commands = {
    batch: (actions: AtomicAction[], label?: string) => { history = historyReduce(history, { type: 'batch', actions, label }); },
    setCaptions: (captions: unknown) => dispatch({ type: 'setCaptions', captions } as AtomicAction),
    updateCaptions: (patch: unknown) => dispatch({ type: 'updateCaptions', patch } as AtomicAction),
  } as EditorCommands;
  const ctx = {
    commands,
    getState: () => activeEditorState(history.present), getDoc: () => history.present,
    getCreativeMode: () => null, getApprovalMode: () => approval,
    templates: [], audio: [],
  } satisfies AgentContext;
  return { ctx, history: () => history };
}

const itemRef = (id: string, start: number, end: number): AgentReference => ({
  id: `ref-${id}`, name: id, kind: 'item',
  metadata: { fps: 30, itemId: id, itemKind: 'video', trackId: 'video_main', timelineFrameStart: start, timelineFrameEnd: end },
});
const timeRef: AgentReference = {
  id: 'ref-time', name: '1 second', kind: 'timepoint', metadata: { fps: 30, timelineFrameStart: 30 },
};

{
  const test = environment();
  const result = await executeDeterministicCommand('split selected clip at playhead', { references: [itemRef('out', 0, 90), timeRef] }, test.ctx);
  assert.equal(result.handled, true);
  assert.equal(test.ctx.getState().items.filter((item) => item.kind === 'video').length, 3);
  assert.equal(test.history().past.length, 1);
}

{
  const test = environment();
  const result = await executeDeterministicCommand('add a 0.5-second J-cut', { references: [itemRef('out', 0, 90), itemRef('in', 90, 180)] }, test.ctx);
  assert.equal(result.handled, true);
  assert.equal(result.handled && result.ok, true);
  assert(test.ctx.getState().items.some((item) => item.kind === 'audio' && item.startFrame === 75));
}

{
  const test = environment();
  const result = await executeDeterministicCommand('generate captions', {}, test.ctx);
  assert.equal(result.handled, true);
  assert.equal(test.ctx.getState().captions?.enabled, true);
}

{
  const test = environment('manual');
  const result = await executeDeterministicCommand('generate captions', {}, test.ctx);
  assert.deepEqual(result, { handled: false }, 'manual approval falls back to the proposal-capable agent path');
  assert.equal(test.history().past.length, 0);
}

assert.equal(isDeterministicCommandCandidate('remove dead air from selected clip'), true);
assert.equal(isDeterministicCommandCandidate('please make this story more emotional'), false);

console.log('DETERMINISTIC_COMMAND_FAST_PATH_PASSED: split, J-cut, captions bypass model only when unambiguous and auto-approved');
