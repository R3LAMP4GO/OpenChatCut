import assert from 'node:assert/strict';
import {
  clampInspectorWidth,
  DEFAULT_INSPECTOR_WIDTH,
  MIN_INSPECTOR_WIDTH,
  MIN_PREVIEW_WIDTH,
} from './inspectorWidth';

assert.equal(clampInspectorWidth(DEFAULT_INSPECTOR_WIDTH, 1200), DEFAULT_INSPECTOR_WIDTH);
assert.equal(clampInspectorWidth(10, 1200), MIN_INSPECTOR_WIDTH, 'the inspector remains operable at its minimum width');
assert.equal(
  clampInspectorWidth(1200, 900),
  900 - MIN_PREVIEW_WIDTH,
  'resizing cannot consume the preview viewport',
);
assert.equal(
  clampInspectorWidth(1200, 300),
  MIN_INSPECTOR_WIDTH,
  'a narrow workspace maintains the inspector minimum without a negative preview width',
);

console.log('inspectorWidth.verify: inspector resizing preserves preview viewport space');
