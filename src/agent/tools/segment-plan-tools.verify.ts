import assert from 'node:assert/strict';
import { CURRENT_PROJECT_VERSION } from '../../../shared/project-version';
import type { AgentContext } from '../context';
import { historyReduce, type AtomicAction, type History } from '../../editor/reduce';
import type { EditorCommands } from '../../editor/store';
import { activeEditorState, type ProjectDoc } from '../../editor/types';
import { execSegmentPlanTool } from './segment-plan-tools';

const initial: ProjectDoc = {
  version: CURRENT_PROJECT_VERSION, assets: [], mediaFolders: [], activeTimelineId: 'main',
  timelines: [{
    id: 'main', name: 'Main', order: 0, fps: 30, width: 1920, height: 1080,
    selectedId: null, trackOrder: ['video_main'], tracks: { video_main: { kind: 'video' } },
    items: [
      {
        id: 'clip_one', name: 'One', kind: 'video', track: 'video_main', startFrame: 0, durationInFrames: 90, src: '/one.mp4',
        transcript: [
          { text: 'First.', start: 0, end: 500 },
          { text: 'Second.', start: 600, end: 1_200 },
        ],
      },
      {
        id: 'clip_two', name: 'Two', kind: 'video', track: 'video_main', startFrame: 90, durationInFrames: 90, src: '/two.mp4',
        transcript: [
          { text: 'Third.', start: 0, end: 500 },
          { text: 'Fourth.', start: 600, end: 1_200 },
        ],
      },
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

const read = execSegmentPlanTool('read_segment_plan', { track: 'V1', limit: 100 }, ctx) as {
  ok: true; revision: string; segments: Array<{ id: string; text: string; startMs: number; endMs: number }>;
};
assert.equal(read.ok, true);
assert.deepEqual(read.segments.map((segment) => segment.id), ['clip_one:s1', 'clip_one:s2', 'clip_two:s1', 'clip_two:s2']);
assert.deepEqual(read.segments.map((segment) => segment.text), ['First.', 'Second.', 'Third.', 'Fourth.']);

const decision = {
  track: 'V1', revision: read.revision,
  keepSegmentIds: ['clip_one:s2', 'clip_two:s1'],
  order: ['clip_two:s1', 'clip_one:s2'],
};
const preview = execSegmentPlanTool('apply_segment_plan', { ...decision, preview: true }, ctx) as { ok: true; preview: true };
assert.equal(preview.ok, true);
assert.equal(history.past.length, 0, 'preview must not mutate');

const applied = execSegmentPlanTool('apply_segment_plan', decision, ctx) as { ok: true; removedSegments: number; reordered: boolean };
assert.equal(applied.ok, true);
assert.equal(applied.removedSegments, 2);
assert.equal(applied.reordered, true);
assert.equal(history.past.length, 1, 'segment plan is one undo step');
const state = ctx.getState();
assert.deepEqual(state.items.find((item) => item.id === 'clip_one')?.deletedWordIdx, [0]);
assert.deepEqual(state.items.find((item) => item.id === 'clip_two')?.deletedWordIdx, [1]);
assert(state.items.find((item) => item.id === 'clip_two')!.startFrame < state.items.find((item) => item.id === 'clip_one')!.startFrame,
  'requested cross-item order is applied');

const stale = execSegmentPlanTool('apply_segment_plan', decision, ctx) as { error: string };
assert.match(stale.error, /stale segment plan/);

const duplicate = execSegmentPlanTool('apply_segment_plan', {
  track: 'V1', revision: 'unused', keepSegmentIds: ['clip_one:s1', 'clip_one:s1'],
}, { ...ctx, getState: () => activeEditorState(initial), getDoc: () => initial }) as { error: string };
assert.match(duplicate.error, /stale segment plan|duplicate/);

console.log('DETERMINISTIC_SEGMENT_PLAN_PASSED: stable IDs, sentence boundaries, preview, stale rejection, ordering, atomic apply');
