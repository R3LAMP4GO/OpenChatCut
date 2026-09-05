import type { RawAsrArtifact } from './types.js';
export const FIXTURE: RawAsrArtifact = { recordingId: 'fixture', sourceRevision: 'fixture-v1', transcriptGenerationId: 'tg-fixture', provider: 'captured-production', language: 'en', words: [
  { text: 'make', start: 0, end: 300 }, { text: 'the', start: 310, end: 500 }, { text: 'message', start: 510, end: 900 },
  { text: 'make', start: 3000, end: 3300 }, { text: 'the', start: 3310, end: 3500 }, { text: 'message', start: 3510, end: 3900 },
  { text: 'editing', start: 5000, end: 5300 }, { text: 'helps', start: 5310, end: 5600 }, { text: 'publish', start: 5610, end: 5900 },
  { text: 'editor', start: 7000, end: 7300 }, { text: 'lets', start: 7310, end: 7600 }, { text: 'release', start: 7610, end: 7900 },
] };
