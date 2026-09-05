import assert from 'node:assert/strict';
import { canStartSpeechReorder } from './speechReorder';

assert.equal(canStartSpeechReorder(true, null, 1), false, 'word or gap drag is never armed');
assert.equal(canStartSpeechReorder(false, 1, 1), false, 'a handle cannot reorder a single block');
assert.equal(canStartSpeechReorder(true, 0, 1), false, 'another block handle cannot reorder this block');
assert.equal(canStartSpeechReorder(true, 1, 1), true, 'the pressed six-dot handle may reorder its block');
console.log('speechReorder.verify: ok');
