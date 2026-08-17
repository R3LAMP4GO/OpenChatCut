import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cutStrategyEnabled, setCutStrategyEnabled } from './cutStrategyPreference';

setCutStrategyEnabled(false);
assert.equal(cutStrategyEnabled(), false);
setCutStrategyEnabled(true);
assert.equal(cutStrategyEnabled(), true);
setCutStrategyEnabled(false);
assert.equal(cutStrategyEnabled(), false);

const panel = await readFile(new URL('../library/SkillsTabPanel.tsx', import.meta.url), 'utf8');
assert.match(panel, /role="switch"/);
assert.match(panel, /aria-checked=\{automaticCutStrategy\}/);
assert.match(panel, /setCutStrategyEnabled\(enabled\)/);
assert.match(panel, /Automatic cut strategy|自动剪辑策略/);

console.log('CUT_STRATEGY_TOGGLE_PASSED: Skills panel exposes an accessible persistent on/off switch with off default');
