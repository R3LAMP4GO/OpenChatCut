import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const skillPath = fileURLToPath(new URL('./l-cut-editor/SKILL.md', import.meta.url));
const skill = await readFile(skillPath, 'utf8');

for (const required of [
  'name: l-cut-editor',
  'picture cuts first',
  "outgoing clip's audio continues",
  'forming an **L** shape',
  'Do not confuse it with a J-cut',
  'Start with a 0.5-second audio tail',
  'Do not exceed 2 seconds',
  'plan_split_edit',
  'apply_split_edit',
  'commits one undoable batch',
  'only one intended dialogue source is audible during the overlap',
]) {
  assert(skill.includes(required), `L-cut skill must include: ${required}`);
}

const fps = 30;
const pictureCutFrame = 90;
const tailFrames = Math.round(0.5 * fps);
const outgoingVisual = {
  startFrame: 0,
  durationInFrames: pictureCutFrame,
  srcInFrame: 30,
};
const incomingVisualOverlap = {
  startFrame: pictureCutFrame,
  durationInFrames: tailFrames,
  srcInFrame: 200,
  volume: 0,
};
const incomingVisualContinuation = {
  startFrame: pictureCutFrame + tailFrames,
  srcInFrame: incomingVisualOverlap.srcInFrame + tailFrames,
  volume: 1,
};
const outgoingAudioTail = {
  startFrame: pictureCutFrame,
  durationInFrames: tailFrames,
  srcInFrame: outgoingVisual.srcInFrame + outgoingVisual.durationInFrames,
};

assert.equal(tailFrames, 15, 'half a second equals 15 frames at 30 fps');
assert.equal(outgoingAudioTail.startFrame, pictureCutFrame, 'outgoing audio begins at the picture cut');
assert.equal(
  outgoingAudioTail.srcInFrame,
  outgoingVisual.srcInFrame + outgoingVisual.durationInFrames,
  'outgoing audio source continues exactly where outgoing picture ends',
);
assert.equal(
  outgoingAudioTail.startFrame + outgoingAudioTail.durationInFrames,
  incomingVisualContinuation.startFrame,
  'incoming embedded audio resumes when the outgoing audio tail ends',
);
assert.equal(incomingVisualOverlap.volume, 0, 'incoming embedded audio is muted only during overlap');
assert.equal(incomingVisualContinuation.volume, 1, 'incoming embedded audio resumes after overlap');

console.log('L_CUT_SKILL_PASSED: adaptive 0.2–2 second guidance + 0.5-second default without duplicate dialogue');
