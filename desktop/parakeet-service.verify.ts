import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { PARAKEET_INFERENCE_CONTRACT, type ParakeetInferenceRequest } from '../shared/parakeet-inference.ts';
import { ParakeetService, parseParakeetJson } from './parakeet-service.ts';

const request: ParakeetInferenceRequest = {
  requestId: 'parakeet-1234',
  contractId: PARAKEET_INFERENCE_CONTRACT.id,
  sourcePath: '/media/uploads/clip.wav',
  language: 'en',
};
const json = JSON.stringify({
  text: 'Hello world',
  sentences: [{ tokens: [{ text: 'Hello', start: 0, end: 0.3 }, { text: ' world', start: 0.3, end: 0.7 }] }],
});

assert.deepEqual(parseParakeetJson(JSON.parse(json), request.requestId).chunks, [
  { text: 'Hello', start: 0, end: 0.3 },
  { text: 'world', start: 0.3, end: 0.7 },
]);
assert.deepEqual(parseParakeetJson({
  text: 'testing 123 testing',
  sentences: [{ tokens: [
    { text: 'T', start: 0, end: 0.1 },
    { text: 'est', start: 0.1, end: 0.2 },
    { text: 'ing', start: 0.2, end: 0.3 },
    { text: ' ', start: 0.3, end: 0.4 },
    { text: '1', start: 0.4, end: 0.5 },
    { text: '2', start: 0.5, end: 0.6 },
    { text: '3', start: 0.6, end: 0.7 },
    { text: ' test', start: 0.7, end: 0.8 },
    { text: 'ing', start: 0.8, end: 0.9 },
  ] }],
}, request.requestId).chunks, [
  { text: 'Testing', start: 0, end: 0.3 },
  { text: '123', start: 0.4, end: 0.7 },
  { text: 'testing', start: 0.7, end: 0.9 },
]);
assert.throws(() => parseParakeetJson({ text: 'bad', sentences: [{ tokens: [{ text: 'bad', start: 1 }] }] }, request.requestId));

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;
  readonly signals: string[] = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.signals.push(signal ?? 'SIGTERM');
    return true;
  }
}

async function waitForJob(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function testService(
  child: FakeChild,
  overrides: Partial<ConstructorParameters<typeof ParakeetService>[1]> = {},
): { service: ParakeetService; removed: string[]; spawnCalls: Array<{ binary: string; args: readonly string[]; options: SpawnOptions }>; timers: Array<() => void> } {
  const removed: string[] = [];
  const spawnCalls: Array<{ binary: string; args: readonly string[]; options: SpawnOptions }> = [];
  const timers: Array<() => void> = [];
  const service = new ParakeetService({ binaryPath: '/bin/parakeet-mlx', modelPath: '/models/parakeet' }, {
    resolveSourcePath: () => '/uploads/clip.wav',
    access: async () => undefined,
    mkdtemp: async () => '/tmp/parakeet-job',
    readdir: async () => ['clip.json'],
    readFile: async () => json,
    rm: async (path) => { removed.push(path); },
    ffmpegPath: () => '/ffmpeg/bin/ffmpeg',
    spawn: (binary, args, options) => {
      spawnCalls.push({ binary, args, options });
      return child as unknown as ChildProcess;
    },
    schedule: (callback) => {
      timers.push(callback);
      return () => undefined;
    },
    ...overrides,
  });
  return { service, removed, spawnCalls, timers };
}

{
  const child = new FakeChild();
  const { service, removed, spawnCalls } = testService(child);
  const promise = service.transcribe(request);
  await waitForJob();
  child.emit('close', 0, null);
  const response = await promise;
  assert.equal(response.text, 'Hello world');
  assert.deepEqual(spawnCalls[0]?.args, ['/uploads/clip.wav', '--model', '/models/parakeet', '--output-dir', '/tmp/parakeet-job', '--output-format', 'json']);
  assert.equal(spawnCalls[0]?.options.shell, false);
  assert.equal(spawnCalls[0]?.options.env?.HF_HUB_OFFLINE, '1');
  assert.match(spawnCalls[0]?.options.env?.PATH ?? '', /^\/ffmpeg\/bin:/);
  assert.deepEqual(removed, ['/tmp/parakeet-job']);
}

{
  const child = new FakeChild();
  const { service, removed } = testService(child);
  const promise = service.transcribe(request);
  await waitForJob();
  child.stderr.write('model exploded');
  child.emit('close', 1, null);
  await assert.rejects(promise, /Parakeet failed \(1\): model exploded/);
  assert.deepEqual(removed, ['/tmp/parakeet-job']);
}

{
  const child = new FakeChild();
  const { service, removed } = testService(child);
  const promise = service.transcribe(request);
  await waitForJob();
  service.cancel(request.requestId);
  child.emit('close', null, 'SIGTERM');
  await assert.rejects(promise, { name: 'AbortError' });
  assert.deepEqual(child.signals, ['SIGTERM']);
  assert.deepEqual(removed, ['/tmp/parakeet-job']);
}

{
  const child = new FakeChild();
  const { service, removed, timers } = testService(child);
  const promise = service.transcribe(request);
  await waitForJob();
  timers[0]!();
  timers[1]!();
  child.emit('close', null, 'SIGKILL');
  await assert.rejects(promise, /timed out/);
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(removed, ['/tmp/parakeet-job']);
}

{
  const child = new FakeChild();
  const { service } = testService(child);
  const promise = service.transcribe(request);
  await waitForJob();
  service.dispose();
  child.emit('close', null, 'SIGTERM');
  await assert.rejects(promise, { name: 'AbortError' });
}

{
  const child = new FakeChild();
  const service = new ParakeetService({ binaryPath: '/missing', modelPath: '/models/parakeet' }, {
    resolveSourcePath: () => '/uploads/clip.wav',
    access: async (path) => { if (path === '/missing') throw new Error('ENOENT'); },
    mkdtemp: async () => '/tmp/parakeet-job',
    readdir: async () => ['clip.json'],
    readFile: async () => json,
    rm: async () => undefined,
    spawn: () => child as unknown as ChildProcess,
    ffmpegPath: () => '/ffmpeg/bin/ffmpeg',
    schedule: () => () => undefined,
  });
  await assert.rejects(service.transcribe(request), /configured binary was not found/);
}
