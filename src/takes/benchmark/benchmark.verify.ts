import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeTranscriptTakes } from '../transcriptTakeAnalysis.js';
import { evaluateTakeBenchmark } from './evaluate.js';
import { FIXTURE } from './fixture.js';
import { validateBenchmarkGroundTruth } from './groundTruth.js';
import { mutateRawWords } from './mutations.js';
import { CASE_TYPES, type BenchmarkGroundTruth } from './types.js';

const analysis = analyzeTranscriptTakes({ sourceItemId: FIXTURE.recordingId, transcriptGenerationId: FIXTURE.transcriptGenerationId, words: FIXTURE.words });
const gold: BenchmarkGroundTruth = { schemaVersion: 1, recordingId: FIXTURE.recordingId, sourceRevision: FIXTURE.sourceRevision, transcriptGenerationId: FIXTURE.transcriptGenerationId, sourceTimeUnit: 'milliseconds', takeGroups: [{ id: 'exact', caseType: 'exact-restart', members: [{ start: 0, end: 900 }, { start: 3000, end: 3900 }] }], negativePairs: [] };
validateBenchmarkGroundTruth(gold, FIXTURE); assert.throws(() => validateBenchmarkGroundTruth({ ...gold, extra: true }), /unknown/); assert.throws(() => validateBenchmarkGroundTruth({ ...gold, transcriptGenerationId: 'wrong' }, FIXTURE), /binding/);
const report = evaluateTakeBenchmark(analysis, gold); assert.ok(report.disagreements.every((item) => typeof item === 'object'), 'disagreements are inspectable payloads'); assert.equal(report.weightedError, report.falsePositives * 2 + report.falseNegatives);
const mutations = mutateRawWords(FIXTURE.words, 42); assert.equal(mutations.length, 7); assert.deepEqual(mutations, mutateRawWords(FIXTURE.words, 42), 'mutations are seeded'); assert.ok(mutations.every((mutation) => mutation.words !== FIXTURE.words), 'mutations retain raw word arrays');
const authored = JSON.parse(await readFile(new URL('./ground-truth/mock-talking-head.v1.json', import.meta.url), 'utf8')); validateBenchmarkGroundTruth(authored); assert.deepEqual(new Set([...authored.takeGroups.map((group: BenchmarkGroundTruth['takeGroups'][number]) => group.caseType), ...authored.negativePairs.map((pair: BenchmarkGroundTruth['negativePairs'][number]) => pair.caseType)]), new Set(CASE_TYPES));
const baseline = analysis.groups.length; const degradations = [{ name: 'threshold', options: { groupingThreshold: .999 } }, { name: 'semantic', options: { semanticScorer: () => 0 } }, { name: 'alignment', options: { alignmentScorer: () => 0 } }, { name: 'temporal', options: { temporalScorer: () => 0 } }];
const deltas = degradations.map(({ name, options }) => ({ name, delta: baseline - analyzeTranscriptTakes({ sourceItemId: FIXTURE.recordingId, transcriptGenerationId: FIXTURE.transcriptGenerationId, words: FIXTURE.words }, options).groups.length })); assert.ok(deltas.some((item) => item.delta > 0), 'at least one targeted degradation must show sensitivity');
console.log(JSON.stringify({ report, mutationNames: mutations.map((mutation) => mutation.name), deltas }, null, 2));
