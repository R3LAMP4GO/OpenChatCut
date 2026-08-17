import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOURCE_URL = 'https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov';
const work = mkdtempSync(join(tmpdir(), 'openchatcut-l-cut-real-video-'));
const source = join(work, 'tears-of-steel-dialogue.mp4');
const result = join(work, 'l-cut.mov');

function run(command, args, timeout = 120_000) {
  return execFileSync(command, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
}
function probe(path) {
  return JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name', '-of', 'json', path], 15_000));
}
function extractPcm(input, start, end, output) {
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-af', `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS`, '-f', 's16le', '-ac', '1', '-ar', '48000', output]);
  const bytes = readFileSync(output);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
}
function correlationWithSmallLag(left, right) {
  let best = -1;
  for (let lag = -512; lag <= 512; lag += 1) {
    let xy = 0; let xx = 0; let yy = 0;
    for (let index = Math.max(0, -lag); index < Math.min(left.length, right.length - lag); index += 1) {
      const x = left[index]; const y = right[index + lag];
      xy += x * y; xx += x * x; yy += y * y;
    }
    best = Math.max(best, xy / Math.sqrt(xx * yy));
  }
  return best;
}
function ssim(outputAt, sourceAt) {
  const checked = spawnSync('ffmpeg', [
    '-hide_banner', '-ss', String(outputAt), '-i', result, '-ss', String(sourceAt), '-i', source,
    '-filter_complex', '[0:v][1:v]ssim[v]', '-map', '[v]', '-an', '-t', '0.25', '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(checked.status, 0, checked.stderr);
  const matches = [...checked.stderr.matchAll(/All:([0-9.]+)/g)];
  assert(matches.length > 0, 'SSIM metric missing');
  return Number(matches.at(-1)[1]);
}

try {
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', '22', '-i', SOURCE_URL, '-t', '24',
    '-vf', 'scale=640:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', source,
  ]);
  assert(statSync(source).size < 10_000_000, 'bounded source extraction exceeded 10 MB');
  const sourceInfo = probe(source);
  assert(sourceInfo.streams.some((stream) => stream.codec_type === 'video'), 'online source video stream missing');
  assert(sourceInfo.streams.some((stream) => stream.codec_type === 'audio'), 'online source audio stream missing');

  // Picture cuts at output 8 s. Outgoing source audio continues until output 9 s.
  // Incoming picture begins at source 9.433333 s; its audio resumes one second later
  // from source 10.433333 s, so the overlap contains exactly one audible source.
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
    '-filter_complex',
    '[0:v]trim=start=0:end=8,setpts=PTS-STARTPTS[v0];'
      + '[0:v]trim=start=9.433333:end=16,setpts=PTS-STARTPTS[v1];'
      + '[v0][v1]concat=n=2:v=1:a=0[v];'
      + '[0:a]atrim=start=0:end=9,asetpts=PTS-STARTPTS[a0];'
      + '[0:a]atrim=start=10.433333:end=16,asetpts=PTS-STARTPTS[a1];'
      + '[a0][a1]concat=n=2:v=0:a=1[a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'pcm_s16le', result,
  ]);
  const resultInfo = probe(result);
  assert.equal(resultInfo.streams.filter((stream) => stream.codec_type === 'audio').length, 1, 'L-cut output must have exactly one audio stream');

  const outgoingSource = extractPcm(source, 8.2, 8.3, join(work, 'source-outgoing.pcm'));
  const outgoingResult = extractPcm(result, 8.2, 8.3, join(work, 'result-outgoing.pcm'));
  const outgoingTailCorrelation = correlationWithSmallLag(outgoingSource, outgoingResult);
  assert(outgoingTailCorrelation > 0.98, `outgoing L-cut tail correlation too low: ${outgoingTailCorrelation}`);

  const incomingSource = extractPcm(source, 10.633333, 10.733333, join(work, 'source-incoming.pcm'));
  const incomingResult = extractPcm(result, 9.2, 9.3, join(work, 'result-incoming.pcm'));
  const incomingResumeCorrelation = correlationWithSmallLag(incomingSource, incomingResult);
  assert(incomingResumeCorrelation > 0.98, `incoming post-tail correlation too low: ${incomingResumeCorrelation}`);

  const preCutOutgoingSsim = ssim(7.7, 7.7);
  const postCutIncomingSsim = ssim(8.2, 9.633333);
  assert(preCutOutgoingSsim > 0.95, `outgoing picture mismatch before cut: ${preCutOutgoingSsim}`);
  assert(postCutIncomingSsim > 0.95, `incoming picture mismatch after cut: ${postCutIncomingSsim}`);

  console.log(JSON.stringify({
    status: 'L_CUT_REAL_VIDEO_AUDIO_PASSED', source: 'Blender Tears of Steel (CC BY 3.0)',
    outgoingAudioTailSeconds: 1, incomingEmbeddedAudioDuplicated: false, renderedAudioStreams: 1,
    outgoingTailCorrelation, incomingResumeCorrelation, preCutOutgoingSsim, postCutIncomingSsim,
  }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
