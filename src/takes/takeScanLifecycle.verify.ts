import assert from 'node:assert/strict';
import { createTakeScanLifecycle } from './takeScanLifecycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const firstResult = deferred<string>();
const secondResult = deferred<string>();
const state = { analysis: 'old result', highlights: new Set(['old highlight']), pending: 'old pending', resets: 0 };
const lifecycle = createTakeScanLifecycle<string>();
const scan = (result: ReturnType<typeof deferred<string>>) => lifecycle.start({
  reset: () => { state.analysis = ''; state.highlights.clear(); state.pending = ''; state.resets += 1; },
  run: () => result.promise,
  apply: (analysis) => { state.analysis = analysis; state.highlights.add(analysis); },
  reject: (error) => { throw error; },
});

const first = scan(firstResult);
assert.equal(state.analysis, '', 'starting a scan clears prior analysis');
assert.equal(state.highlights.size, 0, 'starting a scan clears prior highlights');
assert.equal(state.pending, '', 'starting a scan clears pending deletion');
const second = scan(secondResult);
assert.equal(state.resets, 2, 'each Takes-tab activation starts clean');
assert.equal(first.signal.aborted, true, 'a newer scan aborts the older request');
firstResult.resolve('stale result');
await Promise.resolve();
assert.equal(state.analysis, '', 'stale completion cannot restore prior results');
secondResult.resolve('fresh result');
await Promise.resolve();
assert.equal(state.analysis, 'fresh result', 'latest completion applies');
assert.equal(second.signal.aborted, false, 'latest request stays active');

console.log('takeScanLifecycle.verify: clean scans reject stale completions');
