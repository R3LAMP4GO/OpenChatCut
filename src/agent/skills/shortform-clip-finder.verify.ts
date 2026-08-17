import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const skill = await readFile(fileURLToPath(new URL('./shortform-clip-finder/SKILL.md', import.meta.url)), 'utf8');
for (const required of [
  'name: shortform-clip-finder',
  'whole operational transcript',
  '`curiosity`', '`contrarian`', '`high-value`', '`emotional`', '`story`', '`newsworthy`',
  '`hookStrength`', '`contextCompleteness`', '`misleadingPenalty`', '`incompletePenalty`',
  '`plan_shortform_clips`', '`apply_shortform_clips`', '`approvedCandidateIds`', '`planRef`',
  'source reference', 'word timestamps', 'overlap', 'captions', '`contain` framing',
]) assert.ok(skill.includes(required), `short-form skill must include ${required}`);
assert.match(skill, /not a prediction or guarantee of virality/i);
assert.doesNotMatch(skill, /guarantee(?:d|s)? (?:that a clip will go )?viral/i);

console.log('SHORTFORM_CLIP_SKILL_PASSED: whole-context presets, scored approval workflow, deterministic apply, no virality guarantee');
