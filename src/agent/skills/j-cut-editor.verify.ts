import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillPath = fileURLToPath(new URL('./j-cut-editor/SKILL.md', import.meta.url));
const skill = readFileSync(skillPath, 'utf8');

for (const required of [
  'name: j-cut-editor',
  'incoming clip\'s audio before its picture appears',
  'Default audio lead: **0.5 seconds**',
  'Never leave both embedded audio and an added audio-only copy audible at the same time',
  'plan_split_edit',
  'apply_split_edit',
  'commits one undoable batch',
  'no duplicated dialogue occurs at the visual cut',
  'When uncertain, use a clean hard cut rather than a bad J-cut',
]) {
  assert.match(skill, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `J-cut skill must retain its safety rule: ${required}`);
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const temporaryRoot = join(root, '.tmp');
mkdirSync(temporaryRoot, { recursive: true });
const work = mkdtempSync(join(temporaryRoot, 'j-cut-simulation-'));
const outgoing = join(work, 'outgoing.mp4');
const incoming = join(work, 'incoming.mp4');
const result = join(work, 'j-cut.mp4');
const preVisual = join(work, 'pre-visual.rgb');
const postVisual = join(work, 'post-visual.rgb');
const audioProbe = join(work, 'audio-probe.s16le');

function run(command: string, args: string[]) {
  execFileSync(command, args, { stdio: 'pipe' });
}

function rms(samples: Int16Array): number {
  let sum = 0;
  for (const value of samples) sum += value * value;
  return Math.sqrt(sum / samples.length);
}

/** Energy at one frequency, used to prove the incoming 660 Hz audio begins before its picture. */
function goertzel(samples: Int16Array, frequency: number, sampleRate: number): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let previous = 0;
  let previous2 = 0;
  for (const sample of samples) {
    const current = sample + coefficient * previous - previous2;
    previous2 = previous;
    previous = current;
  }
  return previous2 * previous2 + previous * previous - coefficient * previous * previous2;
}

try {
  // Deterministic, generated footage: blue/440 Hz outgoing and red/660 Hz incoming.
  // The incoming visual starts one second after its incoming audio, modelling a noticeable
  // J-cut that uses source preroll rather than incorrectly offsetting lip-synced source audio.
  run('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', outgoing,
  ]);
  run('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=4',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', incoming,
  ]);
  run('ffmpeg', [
    '-y', '-i', outgoing, '-i', incoming,
    '-filter_complex',
    '[0:v]trim=duration=3,setpts=PTS-STARTPTS[v0];'
      + '[1:v]trim=start=1:end=4,setpts=PTS-STARTPTS[v1];'
      + '[v0][v1]concat=n=2:v=1:a=0[v];'
      + '[0:a]atrim=duration=2,asetpts=PTS-STARTPTS[a0];'
      + '[1:a]atrim=duration=4,asetpts=PTS-STARTPTS,adelay=2000:all=1[a1];'
      + '[a0][a1]amix=inputs=2:duration=longest:normalize=0[a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', result,
  ]);

  // The picture is still outgoing at 2.90s but changes to incoming at 3.10s.
  run('ffmpeg', ['-y', '-ss', '2.90', '-i', result, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', preVisual]);
  run('ffmpeg', ['-y', '-ss', '3.10', '-i', result, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', postVisual]);
  const pre = readFileSync(preVisual);
  const post = readFileSync(postVisual);
  const midpoint = ((90 * 320) + 160) * 3;
  assert(pre[midpoint + 2] > pre[midpoint], '2.90s must retain the outgoing blue visual');
  assert(post[midpoint] > post[midpoint + 2], '3.10s must show the incoming red visual');

  // Probe 2.30–2.40 seconds. 660 Hz energy proves incoming audio is already established
  // while the outgoing visual is still present. RMS guards against an empty/silent probe.
  run('ffmpeg', ['-y', '-ss', '2.30', '-t', '0.10', '-i', result, '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', '48000', audioProbe]);
  const bytes = readFileSync(audioProbe);
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2));
  assert(samples.length >= 4_000, 'audio probe must contain the J-cut lead window');
  assert(rms(samples) > 1_000, 'audio probe must not be silent');
  assert(goertzel(samples, 660, 48_000) > goertzel(samples, 550, 48_000) * 8,
    'incoming 660 Hz audio must be present before the incoming picture');

  console.log('J_CUT_SKILL_PASSED: adaptive 0.2–2 second guidance + validated 1-second cinematic simulation');
} finally {
  rmSync(work, { recursive: true, force: true });
}
