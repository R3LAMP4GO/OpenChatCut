import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcribePath } from '../../transcript/provider.js';
import { newTranscriptGeneration } from '../../transcript/identity.js';
import { isTranscriptionProviderId } from '../../transcript/types.js';
import { analyzeTranscriptTakes } from '../transcriptTakeAnalysis.js';
import { evaluateTakeBenchmark, groupSignature } from './evaluate.js';
import { validateBenchmarkGroundTruth } from './groundTruth.js';
import { mutateRawWords } from './mutations.js';
import type { BenchmarkGroundTruth, RawAsrArtifact } from './types.js';

const arg = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const contained = (root: string, target: string) => target === root || target.startsWith(`${root}${sep}`);
async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')); }

export async function runTakeDetectionBenchmark(): Promise<void> {
  const video = arg('--video'); const provider = arg('--provider'); const language = arg('--language'); const labelsPath = arg('--labels') ?? 'src/takes/benchmark/ground-truth/mock-talking-head.v1.json';
  if (!video || !provider || !language || !isTranscriptionProviderId(provider)) throw new Error('Usage: --video <path> --provider <supported provider> --language <code> [--labels <path>]');
  const videoPath = await realpath(video); if (!(await stat(videoPath)).isFile()) throw new Error('video must be a regular file');
  const root = resolve(arg('--output') ?? 'take-benchmark-output'); await mkdir(root, { recursive: true });
  const revision = createHash('sha256').update(await readFile(videoPath)).digest('hex'); const recordingId = createHash('sha256').update(videoPath).digest('hex').slice(0, 16);
  const result = await transcribePath(videoPath, undefined, { languageCode: language }, provider); if (!result.words.length) throw new Error('provider returned no raw ASR words');
  const identity = newTranscriptGeneration(result.words); const artifact: RawAsrArtifact = { recordingId, sourceRevision: revision, transcriptGenerationId: identity.transcriptGenerationId, provider, language, words: identity.transcript };
  const destination = resolve(root, `${recordingId}-${Date.now()}`); if (!contained(root, destination)) throw new Error('output path escapes benchmark directory'); await mkdir(destination);
  await writeFile(resolve(destination, 'raw-asr.json'), JSON.stringify(artifact, null, 2));
  const labels = await json(resolve(labelsPath)); validateBenchmarkGroundTruth(labels, artifact);
  const analysis = analyzeTranscriptTakes({ sourceItemId: recordingId, transcriptGenerationId: identity.transcriptGenerationId, words: identity.transcript }); const report = evaluateTakeBenchmark(analysis, labels as BenchmarkGroundTruth);
  const mutations = mutateRawWords(identity.transcript).map((mutation) => ({ name: mutation.name, changedGroups: groupSignature(analyzeTranscriptTakes({ sourceItemId: recordingId, transcriptGenerationId: identity.transcriptGenerationId, words: mutation.words })), baselineGroups: groupSignature(analysis) }));
  await writeFile(resolve(destination, 'report.json'), JSON.stringify({ artifact: { ...artifact, words: undefined }, report, mutations }, null, 2));
  await writeFile(resolve(destination, 'report.md'), `# Take-detection benchmark\n\nTP ${report.truePositives}; FP ${report.falsePositives}; FN ${report.falseNegatives}; weighted error ${report.weightedError}.\n`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) runTakeDetectionBenchmark().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
