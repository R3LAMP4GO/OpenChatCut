import type { TranscriptWord } from '../../transcript/types.js';

export type MutationName = 'punctuation-removal' | 'filler-loss' | 'low-information-deletion' | 'proper-noun-corruption' | 'duplicate-token' | 'remove-token' | 'timestamp-shift';
export interface MutationResult { name: MutationName; words: TranscriptWord[]; }
const random = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
const clone = (words: readonly TranscriptWord[]) => words.map((word) => ({ ...word }));

export function mutateRawWords(words: readonly TranscriptWord[], seed = 1): MutationResult[] {
  const pick = random(seed); const index = () => Math.floor(pick() * Math.max(1, words.length));
  const punctuation = clone(words).map((word) => ({ ...word, text: word.text.replace(/[^\p{L}\p{N}'\s]/gu, '') }));
  const fillers = clone(words).filter((word) => !/^(uh|um|erm|ah|like)$/iu.test(word.text));
  const lowInformation = clone(words).filter((word) => !/^(the|a|an|and|so|well|just)$/iu.test(word.text));
  const proper = clone(words); if (proper.length) { const at = index(); proper[at] = { ...proper[at]!, text: 'Doro' }; }
  const duplicate = clone(words); if (duplicate.length) { const at = index(); const word = duplicate[at]!; duplicate.splice(at, 0, { ...word, id: undefined, start: word.end, end: word.end + 1 }); }
  const removed = clone(words); if (removed.length) removed.splice(index(), 1);
  const shifted = clone(words).map((word) => { const delta = Math.floor(pick() * 401) - 200; return { ...word, start: Math.max(0, word.start + delta), end: Math.max(1, word.end + delta) }; }).map((word) => word.end > word.start ? word : { ...word, end: word.start + 1 });
  return [{ name: 'punctuation-removal', words: punctuation }, { name: 'filler-loss', words: fillers }, { name: 'low-information-deletion', words: lowInformation }, { name: 'proper-noun-corruption', words: proper }, { name: 'duplicate-token', words: duplicate }, { name: 'remove-token', words: removed }, { name: 'timestamp-shift', words: shifted }];
}
