import { CASE_TYPES, type BenchmarkGroundTruth, type Span } from './types.js';

const own = (value: object, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));
const span = (value: unknown): value is Span => !!value && typeof value === 'object' && Number.isInteger((value as Span).start) && Number.isInteger((value as Span).end) && (value as Span).start >= 0 && (value as Span).end > (value as Span).start;
const key = (value: Span) => `${value.start}:${value.end}`;

export function validateBenchmarkGroundTruth(value: unknown, binding?: Pick<BenchmarkGroundTruth, 'recordingId' | 'sourceRevision' | 'transcriptGenerationId'>): asserts value is BenchmarkGroundTruth {
  if (!value || typeof value !== 'object' || !own(value, ['schemaVersion', 'recordingId', 'sourceRevision', 'transcriptGenerationId', 'sourceTimeUnit', 'takeGroups', 'negativePairs'])) throw new Error('ground truth has unknown or missing fields');
  const data = value as BenchmarkGroundTruth;
  if (data.schemaVersion !== 1 || !data.recordingId.trim() || !data.sourceRevision.trim() || !data.transcriptGenerationId.trim() || data.sourceTimeUnit !== 'milliseconds' || !Array.isArray(data.takeGroups) || !Array.isArray(data.negativePairs)) throw new Error('ground truth metadata is invalid');
  if (binding && (data.recordingId !== binding.recordingId || data.sourceRevision !== binding.sourceRevision || data.transcriptGenerationId !== binding.transcriptGenerationId)) throw new Error('ground truth binding does not match this ASR generation');
  const members: Span[] = [];
  for (const group of data.takeGroups) {
    if (!group || typeof group !== 'object' || !own(group, ['id', 'caseType', 'members', 'ambiguity']) || !group.id?.trim() || !CASE_TYPES.includes(group.caseType) || !Array.isArray(group.members) || group.members.length < 2 || (group.ambiguity !== undefined && typeof group.ambiguity !== 'string')) throw new Error('ground truth group is invalid');
    for (const member of group.members) { if (!member || typeof member !== 'object' || !own(member, ['start', 'end', 'repeatedSpan']) || !span(member) || (member.repeatedSpan !== undefined && !span(member.repeatedSpan))) throw new Error('ground truth member is invalid'); members.push(member); }
  }
  const ordered = [...members].sort((a, b) => a.start - b.start); for (let i = 1; i < ordered.length; i += 1) if (ordered[i]!.start < ordered[i - 1]!.end) throw new Error('ground truth member ranges overlap');
  const known = new Set(members.map(key));
  for (const pair of data.negativePairs) if (!pair || typeof pair !== 'object' || !own(pair, ['left', 'right', 'caseType', 'note']) || !span(pair.left) || !span(pair.right) || !CASE_TYPES.includes(pair.caseType) || !pair.note.trim() || !known.has(key(pair.left)) || !known.has(key(pair.right))) throw new Error('negative pair is invalid or unreferenced');
}
