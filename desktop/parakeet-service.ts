import { access } from 'node:fs/promises';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { ffmpegBin } from '../server/media-binaries.ts';
import { resolveUploadFile } from '../server/media-dir.ts';
import {
  isParakeetInferenceResponse,
  type ParakeetInferenceRequest,
  type ParakeetInferenceResponse,
  type ParakeetWordTimestamp,
} from '../shared/parakeet-inference.ts';

const REQUEST_TIMEOUT_MS = 90 * 60_000;
const FORCE_KILL_GRACE_MS = 250;
const MAX_PROCESS_OUTPUT_BYTES = 16 * 1024;
const MODEL_REPOSITORY_CACHE = 'models--mlx-community--parakeet-tdt-0.6b-v3';

interface ParakeetJob {
  readonly child: ChildProcess;
  readonly clearTimeout: () => void;
  forceKill?: () => void;
  canceled: boolean;
  timedOut: boolean;
}

type SpawnProcess = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface ParakeetServiceOptions {
  readonly binaryPath?: string;
  readonly modelPath?: string;
  readonly timeoutMs?: number;
}

export interface ParakeetServiceDependencies {
  readonly resolveSourcePath: (sourcePath: string) => string;
  readonly access: (path: string) => Promise<void>;
  readonly mkdtemp: (prefix: string) => Promise<string>;
  readonly readdir: (path: string) => Promise<string[]>;
  readonly readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  readonly rm: (path: string, options: { readonly recursive: true; readonly force: true }) => Promise<void>;
  readonly spawn: SpawnProcess;
  readonly ffmpegPath: () => string;
  readonly schedule: (callback: () => void, delayMs: number) => () => void;
}

export function resolveParakeetSourcePath(sourcePath: string): string {
  const encodedName = sourcePath.slice('/media/uploads/'.length);
  let name: string;
  try {
    name = decodeURIComponent(encodedName);
  } catch {
    throw new Error('Parakeet source is invalid');
  }
  const file = resolveUploadFile(name);
  if (!file) throw new Error('Parakeet source is not a local uploaded file');
  return file;
}

function limitedOutput(current: string, chunk: Buffer): string {
  if (current.length >= MAX_PROCESS_OUTPUT_BYTES) return current;
  return `${current}${chunk.toString('utf8')}`.slice(0, MAX_PROCESS_OUTPUT_BYTES);
}

function errorOutput(stderr: string, stdout: string): string {
  const output = stderr.trim() || stdout.trim();
  return output ? `: ${output}` : '';
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

function validToken(value: unknown): value is ParakeetWordTimestamp {
  if (typeof value !== 'object' || value === null) return false;
  const text = Reflect.get(value, 'text');
  const start = Reflect.get(value, 'start');
  const end = Reflect.get(value, 'end');
  return typeof text === 'string'
    && typeof start === 'number' && Number.isFinite(start) && start >= 0
    && typeof end === 'number' && Number.isFinite(end) && end >= start;
}

function mergeParakeetTokens(tokens: readonly ParakeetWordTimestamp[]): ParakeetWordTimestamp[] {
  const words: ParakeetWordTimestamp[] = [];
  let wordBreak = false;
  for (const token of tokens) {
    const text = token.text.trim();
    // Parakeet emits whitespace-only alignment tokens between some words and numbers.
    if (!text) {
      wordBreak = true;
      continue;
    }
    const previous = words.at(-1);
    // Parakeet uses leading whitespace to mark a new word; remaining tokens are subword pieces.
    if (!previous || wordBreak || /^\s/.test(token.text)) {
      words.push({ text, start: token.start, end: token.end });
    } else {
      words[words.length - 1] = { text: previous.text + text, start: previous.start, end: token.end };
    }
    wordBreak = false;
  }
  return words;
}

export function parseParakeetJson(value: unknown, requestId: string): ParakeetInferenceResponse {
  if (typeof value !== 'object' || value === null
    || typeof Reflect.get(value, 'text') !== 'string'
    || !Array.isArray(Reflect.get(value, 'sentences'))) {
    throw new Error('Parakeet returned malformed JSON output');
  }
  const tokens: ParakeetWordTimestamp[] = [];
  for (const sentence of Reflect.get(value, 'sentences') as unknown[]) {
    if (typeof sentence !== 'object' || sentence === null || !Array.isArray(Reflect.get(sentence, 'tokens'))) {
      throw new Error('Parakeet returned malformed word timestamps');
    }
    for (const token of Reflect.get(sentence, 'tokens') as unknown[]) {
      if (!validToken(token)) throw new Error('Parakeet returned malformed word timestamps');
      tokens.push({
        text: Reflect.get(token, 'text') as string,
        start: Reflect.get(token, 'start') as number,
        end: Reflect.get(token, 'end') as number,
      });
    }
  }
  const chunks = mergeParakeetTokens(tokens);
  const response = {
    requestId,
    text: (Reflect.get(value, 'text') as string).trim() || chunks.map((chunk) => chunk.text).join(' '),
    chunks,
  };
  if (!isParakeetInferenceResponse(response)) throw new Error('Parakeet returned an invalid transcription response');
  return response;
}

export class ParakeetService {
  private readonly binaryPath?: string;
  private readonly modelPath?: string;
  private readonly timeoutMs: number;
  private readonly resolveSourcePath: (sourcePath: string) => string;
  private readonly access: (path: string) => Promise<void>;
  private readonly createTempDir: (prefix: string) => Promise<string>;
  private readonly readDirectory: (path: string) => Promise<string[]>;
  private readonly readTextFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  private readonly removeDirectory: (path: string, options: { readonly recursive: true; readonly force: true }) => Promise<void>;
  private readonly spawnProcess: SpawnProcess;
  private readonly getFfmpegPath: () => string;
  private readonly schedule: (callback: () => void, delayMs: number) => () => void;
  private readonly jobs = new Map<string, ParakeetJob>();

  constructor(options: ParakeetServiceOptions = {}, dependencies: Partial<ParakeetServiceDependencies> = {}) {
    this.binaryPath = options.binaryPath ?? process.env.OPENCHATCUT_PARAKEET_BIN;
    this.modelPath = options.modelPath ?? process.env.OPENCHATCUT_PARAKEET_MODEL;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.resolveSourcePath = dependencies.resolveSourcePath ?? resolveParakeetSourcePath;
    this.access = dependencies.access ?? ((path) => access(path));
    this.createTempDir = dependencies.mkdtemp ?? mkdtemp;
    this.readDirectory = dependencies.readdir ?? ((path) => readdir(path));
    this.readTextFile = dependencies.readFile ?? ((path, encoding) => readFile(path, encoding));
    this.removeDirectory = dependencies.rm ?? ((path, options) => rm(path, options));
    this.spawnProcess = dependencies.spawn ?? spawn;
    this.getFfmpegPath = dependencies.ffmpegPath ?? ffmpegBin;
    this.schedule = dependencies.schedule ?? ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    });
  }

  async transcribe(request: ParakeetInferenceRequest): Promise<ParakeetInferenceResponse> {
    if (this.jobs.has(request.requestId)) throw new Error('Parakeet request is already active');
    const source = this.resolveSourcePath(request.sourcePath);
    const [binary, model] = await Promise.all([this.resolveBinary(), this.resolveModel()]);
    const outputDir = await this.createTempDir(join(tmpdir(), 'openchatcut-parakeet-'));
    try {
      const response = await this.run(request.requestId, binary, source, model, outputDir);
      return response;
    } finally {
      await this.removeDirectory(outputDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  cancel(requestId: string): void {
    const job = this.jobs.get(requestId);
    if (!job) return;
    job.canceled = true;
    this.stop(job);
  }

  dispose(): void {
    for (const requestId of this.jobs.keys()) this.cancel(requestId);
  }

  private async resolveBinary(): Promise<string> {
    if (this.binaryPath !== undefined) {
      if (!isAbsolute(this.binaryPath)) throw new Error('Parakeet binary override must be an absolute path');
      await this.access(this.binaryPath).catch(() => {
        throw new Error('Parakeet backend unavailable: configured binary was not found');
      });
      return this.binaryPath;
    }
    const installed = join(homedir(), 'Library', 'Application Support', 'OpenChatCut', 'parakeet', 'bin', 'parakeet-mlx');
    try {
      await this.access(installed);
      return installed;
    } catch {
      return 'parakeet-mlx';
    }
  }

  private async resolveModel(): Promise<string> {
    if (this.modelPath !== undefined) {
      if (!isAbsolute(this.modelPath) || !await this.isModelDirectory(this.modelPath)) {
        throw new Error('Parakeet model override is incomplete or unavailable');
      }
      return this.modelPath;
    }
    const installed = join(homedir(), 'Library', 'Application Support', 'OpenChatCut', 'models', 'parakeet-tdt-0.6b-v3');
    if (await this.isModelDirectory(installed)) return installed;
    const snapshots = join(homedir(), '.cache', 'huggingface', 'hub', MODEL_REPOSITORY_CACHE, 'snapshots');
    const candidates = await this.readDirectory(snapshots).catch(() => []);
    for (const candidate of candidates) {
      const model = join(snapshots, candidate);
      if (await this.isModelDirectory(model)) return model;
    }
    throw new Error('Parakeet model is not installed locally');
  }

  private async isModelDirectory(path: string): Promise<boolean> {
    try {
      await Promise.all([this.access(join(path, 'config.json')), this.access(join(path, 'model.safetensors'))]);
      return true;
    } catch {
      return false;
    }
  }

  private async run(
    requestId: string,
    binary: string,
    source: string,
    model: string,
    outputDir: string,
  ): Promise<ParakeetInferenceResponse> {
    const args = [source, '--model', model, '--output-dir', outputDir, '--output-format', 'json'];
    let child: ChildProcess;
    try {
      child = this.spawnProcess(binary, args, {
        cwd: outputDir,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
          PATH: `${dirname(this.getFfmpegPath())}${delimiter}${process.env.PATH ?? ''}`,
        },
      });
    } catch (error) {
      throw new Error(`Parakeet backend unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    return new Promise<ParakeetInferenceResponse>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        const job = this.jobs.get(requestId);
        job?.clearTimeout();
        job?.forceKill?.();
        this.jobs.delete(requestId);
        callback();
      };
      const job: ParakeetJob = {
        child,
        canceled: false,
        timedOut: false,
        clearTimeout: this.schedule(() => {
          const current = this.jobs.get(requestId);
          if (!current) return;
          current.timedOut = true;
          this.stop(current);
        }, this.timeoutMs),
      };
      this.jobs.set(requestId, job);
      child.stdout?.on('data', (chunk: Buffer) => { stdout = limitedOutput(stdout, chunk); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr = limitedOutput(stderr, chunk); });
      child.once('error', (error) => finish(() => reject(new Error(
        `Parakeet backend unavailable: ${error.message}${errorOutput(stderr, stdout)}`,
      ))));
      child.once('close', (code, signal) => void (async () => {
        if (job.canceled) return finish(() => reject(abortError('Parakeet transcription canceled')));
        if (job.timedOut) return finish(() => reject(new Error('Parakeet transcription timed out')));
        if (code !== 0) return finish(() => reject(new Error(
          `Parakeet failed (${code ?? signal ?? 'unknown'})${errorOutput(stderr, stdout)}`,
        )));
        try {
          const files = (await this.readDirectory(outputDir)).filter((file) => file.endsWith('.json'));
          if (files.length !== 1) throw new Error('Parakeet did not produce exactly one JSON result');
          const parsed = parseParakeetJson(JSON.parse(await this.readTextFile(join(outputDir, files[0]!), 'utf8')), requestId);
          finish(() => resolve(parsed));
        } catch (error) {
          finish(() => reject(error));
        }
      })());
    });
  }

  private stop(job: ParakeetJob): void {
    if (job.child.exitCode !== null || job.child.killed) return;
    job.child.kill('SIGTERM');
    job.forceKill = this.schedule(() => {
      if (job.child.exitCode === null) job.child.kill('SIGKILL');
    }, FORCE_KILL_GRACE_MS);
  }
}
