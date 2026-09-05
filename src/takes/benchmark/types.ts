import type { TranscriptWord } from '../../transcript/types.js';

export const CASE_TYPES = ['exact-restart', 'partial-restart', 'paraphrase', 'similar-opening-different-ending', 'near-repeat', 'distant-repeat', 'intentional-non-retake', 'filler-loss', 'punctuation-loss', 'low-information-loss', 'proper-noun-corruption', 'duplicate-token', 'removed-token', 'timestamp-shift'] as const;
export type CaseType = (typeof CASE_TYPES)[number];
export interface Span { start: number; end: number; }
export interface GoldMember extends Span { repeatedSpan?: Span; }
export interface GoldGroup { id: string; caseType: CaseType; members: GoldMember[]; ambiguity?: string; }
export interface NegativePair { left: Span; right: Span; caseType: CaseType; note: string; }
export interface BenchmarkGroundTruth { schemaVersion: 1; recordingId: string; sourceRevision: string; transcriptGenerationId: string; sourceTimeUnit: 'milliseconds'; takeGroups: GoldGroup[]; negativePairs: NegativePair[]; }
export interface RawAsrArtifact { recordingId: string; sourceRevision: string; transcriptGenerationId: string; provider: string; language: string; words: TranscriptWord[]; }
