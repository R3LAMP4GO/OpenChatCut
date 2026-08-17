// Skill script execution on the LOCAL machine. Manifest entrypoints are preferred:
// fixed binary/script + typed argv, cwd locked to the skill directory, bounded time/output,
// and no shell. Legacy command remains for external skills that have not migrated.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { skillDirFor, skillFilesRoot } from '../skills-files.ts';

const execFileAsync = promisify(execFile);
const ALLOWED_BINARIES = new Set([
  'bash', 'sh', 'node', 'npm', 'npx', 'python3', 'python', 'uv', 'uvx',
  'ffmpeg', 'ffprobe', 'mkdir', 'cp', 'chmod',
]);
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const ENTRYPOINT_RE = /^[A-Za-z0-9_-]{1,80}$/;

interface ExecRequest {
  command?: string;
  args: string[];
  entrypoint?: string;
  values: Record<string, unknown>;
  timeout?: number;
}

interface ManifestArg {
  type: 'string' | 'number' | 'boolean' | 'enum';
  required?: boolean;
  flag?: string;
  values?: string[];
  min?: number;
  max?: number;
  maxLength?: number;
}
interface ManifestEntrypoint {
  binary: string;
  script?: string;
  fixedArgs?: string[];
  args?: Record<string, ManifestArg>;
  timeoutMs?: number;
}
interface SkillWorkflowManifest {
  version: 1;
  entrypoints: Record<string, ManifestEntrypoint>;
}
interface ResolvedInvocation { binary: string; args: string[]; timeout: number; mode: 'manifest' | 'legacy'; script?: string }

function readJson(req: IncomingMessage): Promise<ExecRequest> {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024) { rejectPromise(new Error('request too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Partial<ExecRequest>;
        const command = typeof parsed.command === 'string' ? parsed.command.trim() : '';
        const entrypoint = typeof parsed.entrypoint === 'string' ? parsed.entrypoint.trim() : '';
        if (!command && !entrypoint) throw new Error('entrypoint or legacy command is required');
        if (command && entrypoint) throw new Error('provide entrypoint or command, not both');
        resolvePromise({
          ...(command ? { command } : {}),
          ...(entrypoint ? { entrypoint } : {}),
          args: Array.isArray(parsed.args) ? parsed.args.filter((arg): arg is string => typeof arg === 'string') : [],
          values: parsed.values && typeof parsed.values === 'object' && !Array.isArray(parsed.values) ? parsed.values : {},
          timeout: typeof parsed.timeout === 'number' ? parsed.timeout : undefined,
        });
      } catch (error) {
        rejectPromise(error instanceof Error ? error : new Error('invalid JSON'));
      }
    });
    req.on('error', rejectPromise);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
function truncateOutput(text: string): string {
  return text.length <= MAX_OUTPUT_BYTES ? text : `${text.slice(0, MAX_OUTPUT_BYTES)}\n…[truncated]`;
}
function timeout(value: number | undefined): number {
  return Math.min(Math.max(value ?? 60_000, 1_000), MAX_TIMEOUT_MS);
}
function safeScript(dir: string, script: string): string {
  if (!script || isAbsolute(script)) throw new Error('manifest script must be a relative path');
  const path = resolve(dir, script);
  const rel = relative(dir, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('manifest script escapes the skill directory');
  return rel;
}
function validateFlag(flag: unknown): string | undefined {
  if (flag === undefined) return undefined;
  if (typeof flag !== 'string' || !/^--?[A-Za-z0-9][A-Za-z0-9-]*$/.test(flag)) throw new Error(`invalid manifest flag ${String(flag)}`);
  return flag;
}
function argumentValue(name: string, spec: ManifestArg, raw: unknown): string[] {
  const flag = validateFlag(spec.flag);
  if (raw === undefined || raw === null || raw === '') {
    if (spec.required) throw new Error(`entrypoint argument ${name} is required`);
    return [];
  }
  if (spec.type === 'boolean') {
    if (typeof raw !== 'boolean') throw new Error(`entrypoint argument ${name} must be boolean`);
    if (!flag) throw new Error(`boolean entrypoint argument ${name} requires a flag`);
    return raw ? [flag] : [];
  }
  let value: string;
  if (spec.type === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`entrypoint argument ${name} must be a finite number`);
    if ((spec.min !== undefined && raw < spec.min) || (spec.max !== undefined && raw > spec.max)) throw new Error(`entrypoint argument ${name} is out of range`);
    value = String(raw);
  } else {
    if (typeof raw !== 'string') throw new Error(`entrypoint argument ${name} must be a string`);
    if (raw.length > Math.min(spec.maxLength ?? 1_000, 4_000)) throw new Error(`entrypoint argument ${name} is too long`);
    if (spec.type === 'enum' && (!Array.isArray(spec.values) || !spec.values.includes(raw))) throw new Error(`entrypoint argument ${name} is not an allowed value`);
    value = raw;
  }
  return flag ? [flag, value] : [value];
}

export async function resolveManifestInvocation(dir: string, body: ExecRequest): Promise<ResolvedInvocation> {
  if (!body.entrypoint) {
    const command = body.command ?? '';
    const binary = command.split(/\s+/)[0] ?? '';
    if (!ALLOWED_BINARIES.has(binary)) throw new Error(`command not allowed: "${binary}" — whitelist: ${[...ALLOWED_BINARIES].sort().join(', ')}`);
    const rest = command.slice(binary.length).trim();
    return { binary, args: [...(rest ? rest.split(/\s+/) : []), ...body.args], timeout: timeout(body.timeout), mode: 'legacy' };
  }
  if (!ENTRYPOINT_RE.test(body.entrypoint)) throw new Error('invalid entrypoint name');
  const raw = await readFile(resolve(dir, 'workflow.json'));
  if (raw.byteLength > MAX_MANIFEST_BYTES) throw new Error('workflow.json is too large');
  const manifest = JSON.parse(raw.toString('utf8')) as SkillWorkflowManifest;
  if (manifest.version !== 1 || !manifest.entrypoints || typeof manifest.entrypoints !== 'object') throw new Error('invalid workflow.json');
  const entry = manifest.entrypoints[body.entrypoint];
  if (!entry || typeof entry !== 'object') throw new Error(`unknown manifest entrypoint ${body.entrypoint}`);
  if (!ALLOWED_BINARIES.has(entry.binary)) throw new Error(`manifest binary not allowed: ${entry.binary}`);
  const specs = entry.args ?? {};
  const unknown = Object.keys(body.values).filter((name) => !(name in specs));
  if (unknown.length) throw new Error(`unknown entrypoint arguments: ${unknown.join(', ')}`);
  const script = entry.script ? safeScript(dir, entry.script) : undefined;
  const args = [
    ...(script ? [script] : []),
    ...(Array.isArray(entry.fixedArgs) && entry.fixedArgs.every((arg) => typeof arg === 'string') ? entry.fixedArgs : []),
    ...Object.entries(specs).flatMap(([name, spec]) => argumentValue(name, spec, body.values[name])),
  ];
  return { binary: entry.binary, args, timeout: timeout(body.timeout ?? entry.timeoutMs), mode: 'manifest', ...(script ? { script } : {}) };
}

export async function runInDirectory(dir: string, body: ExecRequest): Promise<unknown> {
  try {
    const invocation = await resolveManifestInvocation(dir, body);
    if (invocation.script) await access(resolve(dir, invocation.script));
    const result = await execFileAsync(invocation.binary, invocation.args, {
      cwd: dir, timeout: invocation.timeout, maxBuffer: MAX_OUTPUT_BYTES,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    });
    return { ok: true, mode: invocation.mode, exitCode: 0, stdout: truncateOutput(result.stdout), stderr: truncateOutput(result.stderr), cwd: dir };
  } catch (error) {
    const err = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; message?: string };
    return {
      ok: false, exitCode: typeof err.code === 'number' ? err.code : (err.killed ? -9 : -1), killed: err.killed === true,
      stdout: truncateOutput(err.stdout ?? ''), stderr: truncateOutput(err.stderr ?? ''), error: err.message ?? String(error),
    };
  }
}

export async function runInSkillDir(slug: string, body: ExecRequest): Promise<unknown> {
  const dir = skillDirFor(skillFilesRoot(), slug);
  if (!dir) return { error: `invalid skill slug "${slug}"` };
  try { await access(resolve(dir, 'SKILL.md')); } catch { return { error: `skill "${slug}" is not installed (no SKILL.md in ${dir})` }; }
  return runInDirectory(dir, body);
}

export function skillExecPlugin(): Plugin {
  return {
    name: 'openchatcut-skill-exec',
    configureServer(server) {
      server.middlewares.use('/api/skills', (req, res, next) => {
        if (req.url?.startsWith('/install')) { next(); return; }
        const execMatch = req.url?.match(/^\/([A-Za-z0-9_-]{1,120})\/exec$/);
        if (execMatch && req.method === 'POST') {
          void (async () => {
            try { sendJson(res, 200, await runInSkillDir(execMatch[1]!, await readJson(req))); }
            catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              server.config.logger.error(`[api/skills/exec] ${message}`);
              if (!res.headersSent) sendJson(res, 400, { error: message });
            }
          })();
          return;
        }
        next();
      });
    },
  };
}
