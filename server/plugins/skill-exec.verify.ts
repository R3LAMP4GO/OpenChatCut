import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInDirectory } from './skill-exec';

const root = await mkdtemp(join(tmpdir(), 'openchatcut-skill-exec-'));
try {
  const skill = join(root, 'manifest-skill');
  await mkdir(join(skill, 'scripts'), { recursive: true });
  await writeFile(join(skill, 'SKILL.md'), '# Manifest skill\n');
  await writeFile(join(skill, 'scripts', 'echo.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)))\n');
  await writeFile(join(skill, 'workflow.json'), JSON.stringify({
    version: 1,
    entrypoints: {
      analyze: {
        binary: 'node', script: 'scripts/echo.mjs', fixedArgs: ['fixed'], timeoutMs: 5_000,
        args: {
          preset: { type: 'enum', values: ['curiosity', 'story'], required: true, flag: '--preset' },
          limit: { type: 'number', min: 1, max: 10, flag: '--limit' },
          verbose: { type: 'boolean', flag: '--verbose' },
        },
      },
    },
  }));

  const manifest = await runInDirectory(skill, {
    entrypoint: 'analyze', values: { preset: 'curiosity', limit: 3, verbose: true }, args: [],
  }) as { ok: boolean; mode: string; stdout: string };
  assert.equal(manifest.ok, true);
  assert.equal(manifest.mode, 'manifest');
  assert.deepEqual(JSON.parse(manifest.stdout), ['fixed', '--preset', 'curiosity', '--limit', '3', '--verbose']);

  const rejected = await runInDirectory(skill, {
    entrypoint: 'analyze', values: { preset: 'fabricated' }, args: [],
  }) as { ok: boolean; error: string };
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /not an allowed value/);

  const legacy = await runInDirectory(skill, {
    command: 'node scripts/echo.mjs', values: {}, args: ['legacy'],
  }) as { ok: boolean; mode: string; stdout: string };
  assert.equal(legacy.ok, true);
  assert.equal(legacy.mode, 'legacy');
  assert.deepEqual(JSON.parse(legacy.stdout), ['legacy']);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('SKILL_ENTRYPOINT_MANIFEST_PASSED: fixed binary/script, typed argv, legacy compatibility, bounded local execution');
