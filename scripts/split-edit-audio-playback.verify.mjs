import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const work = mkdtempSync(join(tmpdir(), 'openchatcut-split-audio-playback-'));
const source = join(work, 'source.mp4');
const sampleRate = 48_000;

function run(command, args, timeout = 30_000) {
  return execFileSync(command, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
}
function render(type) {
  const output = join(work, `${type}.mov`);
  const pcm = join(work, `${type}.pcm`);
  const jCut = type === 'j-cut';
  const incomingPicture = 226 / 24;
  const incomingAudio = (jCut ? 214 : 238) / 24;
  const outgoingAudioEnd = jCut ? 7.5 : 8.5;
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
    '-filter_complex',
    `[0:v]trim=start=0:end=8,setpts=PTS-STARTPTS[v0];`
      + `[0:v]trim=start=${incomingPicture}:end=16,setpts=PTS-STARTPTS[v1];`
      + '[v0][v1]concat=n=2:v=1:a=0[v];'
      + `[0:a]atrim=start=0:end=${outgoingAudioEnd},asetpts=PTS-STARTPTS[a0];`
      + `[0:a]atrim=start=${incomingAudio}:end=16,asetpts=PTS-STARTPTS[a1];`
      + '[a0][a1]concat=n=2:v=0:a=1[a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32',
    '-c:a', 'pcm_s16le', output,
  ]);
  const probe = JSON.parse(run('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', output,
  ]));
  assert.equal(probe.streams.filter((stream) => stream.codec_type === 'audio').length, 1, `${type} must render exactly one audio stream`);
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', output,
    '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', String(sampleRate), pcm,
  ]);
  const bytes = readFileSync(pcm);
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const rmsAt = (seconds) => {
    const start = Math.round(seconds * sampleRate);
    const end = Math.min(samples.length, start + Math.round(0.2 * sampleRate));
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += samples[index] ** 2;
    return Math.sqrt(sum / Math.max(1, end - start));
  };
  // Cover ordinary playback plus the actual split overlap: J incoming lead at
  // 7.75s; L outgoing tail at 8.25s. A late window proves audio resumes.
  const windows = jCut ? [2, 7.75, 10] : [2, 8.25, 10];
  const rms = windows.map(rmsAt);
  assert(rms.every((level) => level > 1_000), `${type} contains a silent playback window: ${rms.join(', ')}`);
  return { durationSeconds: Number(probe.format.duration), windowsSeconds: windows, rms };
}

try {
  // Bounded deterministic source: 16 seconds, 24 fps, mono tone. The changing
  // tone prevents a zero-filled audio path from passing merely via metadata.
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=16',
    '-f', 'lavfi', '-i', 'sine=frequency=523:sample_rate=48000:duration=16',
    '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-c:a', 'aac', source,
  ]);
  const jCut = render('j-cut');
  const lCut = render('l-cut');
  console.log(JSON.stringify({ status: 'SPLIT_EDIT_AUDIO_PLAYBACK_PASSED', fps: 24, overlapFrames: 12, jCut, lCut }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
