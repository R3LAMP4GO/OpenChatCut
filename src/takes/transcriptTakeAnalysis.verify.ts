import assert from 'node:assert/strict';
import { analyzeTranscriptTakes, isTakeAnalysisCurrent } from './transcriptTakeAnalysis';
import { TAKE_DETECTION_FIXTURES, verifyOracleParity, verifyTakeDetectionCorpus } from './takeDetectionFixtures';
import { validateTakeGroundTruth } from './groundTruth';

const exact = TAKE_DETECTION_FIXTURES[0]!;
const before = JSON.stringify(exact.words);
const baseline = analyzeTranscriptTakes(exact);
assert.equal(JSON.stringify(exact.words), before, 'analysis must not mutate words');
assert.deepEqual(baseline, analyzeTranscriptTakes(exact), 'analysis must be deterministic');
assert.ok(Object.isFrozen(baseline) && Object.isFrozen(baseline.pairs) && Object.isFrozen(baseline.groups));
assert.equal(isTakeAnalysisCurrent(baseline, exact.transcriptGenerationId), true);
assert.equal(isTakeAnalysisCurrent(baseline, 'changed'), false);
assert.equal(analyzeTranscriptTakes({ sourceItemId: '', transcriptGenerationId: '', words: [] }).groups.length, 0);
assert.throws(() => validateTakeGroundTruth({}), /metadata/);
validateTakeGroundTruth({ schemaVersion: 1, recordingId: 'example', sourceRevision: 'r1', transcriptGenerationId: 'g1', sourceTimeUnit: 'milliseconds', takeGroups: [[{ start: 0, end: 100 }]], intentionalNonRetakes: [{ start: 200, end: 300 }], pairLabels: [] });
assert.deepEqual(verifyOracleParity(), [], 'bounded fixtures must preserve exhaustive groups');
const report = verifyTakeDetectionCorpus();
assert.equal(report.falsePositives, 0, report.disagreements.join('\n'));
assert.equal(report.falseNegatives, 0, report.disagreements.join('\n'));
assert.deepEqual(report.disagreements, [], report.disagreements.join('\n'));
assert.ok(Math.min(...report.scoreDistributions.GROUPED) >= 0.72, 'grouping threshold must be supported by labeled positives');
const paraphrase = TAKE_DETECTION_FIXTURES.find((fixture) => fixture.sourceItemId === 'paraphrase')!;
const addition = TAKE_DETECTION_FIXTURES.find((fixture) => fixture.sourceItemId === 'addition')!;
const rhetoricalRepeat = TAKE_DETECTION_FIXTURES.find((fixture) => fixture.sourceItemId === 'emphasis')!;
assert.equal(analyzeTranscriptTakes(paraphrase).groups.length, 1, 'full-span paraphrases can be safe retakes');
assert.equal(analyzeTranscriptTakes(paraphrase, { semanticScorer: () => 0 }).groups.length, 0, 'paraphrases require strong semantic agreement');
assert.equal(analyzeTranscriptTakes(addition, { semanticScorer: () => 1 }).groups.length, 0, 'added information stays review-only even with semantic agreement');
assert.equal(analyzeTranscriptTakes(rhetoricalRepeat).groups.length, 0, 'rapid rhetorical repetition is never grouped');
for (const mutation of [
  { groupingThreshold: 0.99 },
  { semanticScorer: () => 0 },
  { alignmentScorer: () => 0 },
]) assert.ok(TAKE_DETECTION_FIXTURES.some((fixture) => analyzeTranscriptTakes(fixture, mutation).groups.length < analyzeTranscriptTakes(fixture).groups.length), `mutation must lose a labeled positive: ${JSON.stringify(mutation)}`);
console.log(JSON.stringify(report, null, 2));
