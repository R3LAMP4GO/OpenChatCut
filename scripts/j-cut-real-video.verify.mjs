import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEARS_OF_STEEL_720P = 'https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov';
const work = mkdtempSync(join(tmpdir(), 'openchatcut-j-cut-real-video-'));
const source = join(work, 'tears-of-steel-dialogue.mp4');
const result = join(work, 'j-cut.mov');
const sourcePcm = join(work, 'source-lead.pcm');
const resultPcm = join(work, 'result-lead.pcm');

function run(command, args, timeout = 120_000) {
  return execFileSync(command, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
}

function probe(path) {
  return JSON.parse(run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name', '-of', 'json', path,
  ], 15_000));
}

function pcm(path) {
  const bytes = readFileSync(path);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
}

function correlationWithSmallLag(left, right) {
  let best = -1;
  for (let lag = -512; lag <= 512; lag += 1) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let index = Math.max(0, -lag); index < Math.min(left.length, right.length - lag); index += 1) {
      const x = left[index];
      const y = right[index + lag];
      xy += x * y;
      xx += x * x;
      yy += y * y;
    }
    best = Math.max(best, xy / Math.sqrt(xx * yy));
  }
  return best;
}

function ssim(outputAt, sourceAt) {
  const checked = spawnSync('ffmpeg', [
    '-hide_banner', '-ss', String(outputAt), '-i', result,
    '-ss', String(sourceAt), '-i', source,
    '-filter_complex', '[0:v][1:v]ssim[v]', '-map', '[v]', '-an', '-t', '0.25', '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(checked.status, 0, checked.stderr);
  const matches = [...checked.stderr.matchAll(/All:([0-9.]+)/g)];
  assert(matches.length > 0, 'SSIM metric missing');
  return Number(matches.at(-1)[1]);
}

try {
  // Bounded extraction from Blender's CC BY 3.0 open movie; output is capped after transcoding.
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', '22', '-i', TEARS_OF_STEEL_720P, '-t', '24',
    '-vf', 'scale=640:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', source,
  ]);
  assert(statSync(source).size < 10_000_000, 'bounded source extraction exceeded 10 MB');
  const sourceInfo = probe(source);
  assert(sourceInfo.streams.some((stream) => stream.codec_type === 'video'), 'online source video stream missing');
  assert(sourceInfo.streams.some((stream) => stream.codec_type === 'audio'), 'online source audio stream missing');

  // Picture cuts at 8 s. Incoming audio starts at 7 s from source 8.433 s;
  // incoming picture starts at source 9.433 s, exactly one second later.
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
    '-filter_complex',
    '[0:v]trim=start=0:end=8,setpts=PTS-STARTPTS[v0];'
      + '[0:v]trim=start=9.433333:end=16,setpts=PTS-STARTPTS[v1];'
      + '[v0][v1]concat=n=2:v=1:a=0[v];'
      + '[0:a]atrim=start=0:end=7,asetpts=PTS-STARTPTS[a0];'
      + '[0:a]atrim=start=8.433333:end=16,asetpts=PTS-STARTPTS[a1];'
      + '[a0][a1]concat=n=2:v=0:a=1[a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'pcm_s16le', result,
  ]);
  const resultInfo = probe(result);
  assert.equal(resultInfo.streams.filter((stream) => stream.codec_type === 'audio').length, 1,
    'J-cut output must have exactly one audio stream');

  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
    '-af', 'atrim=start=8.633333:end=8.733333,asetpts=PTS-STARTPTS',
    '-f', 's16le', '-ac', '1', '-ar', '48000', sourcePcm,
  ]);
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', result,
    '-af', 'atrim=start=7.2:end=7.3,asetpts=PTS-STARTPTS',
    '-f', 's16le', '-ac', '1', '-ar', '48000', resultPcm,
  ]);
  const audioCorrelation = correlationWithSmallLag(pcm(sourcePcm), pcm(resultPcm));
  assert(audioCorrelation > 0.98, `incoming audio lead correlation too low: ${audioCorrelation}`);

  const preCutOutgoingSsim = await ssim(7.7, 7.7);
  const postCutIncomingSsim = await ssim(8.2, 9.633333);
  assert(preCutOutgoingSsim > 0.95, `outgoing picture mismatch before cut: ${preCutOutgoingSsim}`);
  assert(postCutIncomingSsim > 0.95, `incoming picture mismatch after cut: ${postCutIncomingSsim}`);

  console.log(JSON.stringify({
    status: 'J_CUT_REAL_VIDEO_AUDIO_PASSED',
    source: 'Blender Tears of Steel (CC BY 3.0)',
    incomingAudioLeadSeconds: 1,
    incomingEmbeddedAudioDuplicated: false,
    renderedAudioStreams: 1,
    audioCorrelation,
    preCutOutgoingSsim,
    postCutIncomingSsim,
  }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
