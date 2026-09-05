import assert from 'node:assert/strict';
import { normalizeSelectedWordIndexes } from './selectedWords';

assert.deepEqual(normalizeSelectedWordIndexes([5, 3, 3, -1, 9, 2.5], 6, new Set([5])), [3]);
assert.deepEqual(normalizeSelectedWordIndexes([2, 0, 1], 3, new Set()), [0, 1, 2]);
console.log('selectedWords.verify: ok');
