import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const skill = await readFile(fileURLToPath(new URL('./cut-strategy-planner/SKILL.md', import.meta.url)), 'utf8');
for (const required of [
  'name: cut-strategy-planner', 'off by default', '`configure_cut_strategy`', '`plan_cut_strategy`',
  'Regular cut', 'J-cut', 'L-cut', 'Match cut', 'lip-sync risk', 'reaction', 'B-roll',
  '`quick`: 0.3 seconds', '`natural`: 0.5 seconds', '`deliberate`: 1 second',
  '`plan_split_edit`', '`apply_split_edit`',
]) assert.ok(skill.includes(required), `cut strategy skill must include ${required}`);
assert.match(skill, /Selecting this skill.+does not silently enable it/);
assert.match(skill, /Never exceed 2 seconds automatically/);

console.log('CUT_STRATEGY_SKILL_PASSED: explicit on/off, podcast decision policy, fail-closed defaults, deterministic split-edit handoff');
