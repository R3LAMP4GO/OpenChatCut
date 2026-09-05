export function normalizeSelectedWordIndexes(indexes: readonly number[], wordCount: number, deleted: ReadonlySet<number>): number[] {
  return [...new Set(indexes)]
    .filter((index) => Number.isSafeInteger(index) && index >= 0 && index < wordCount && !deleted.has(index))
    .sort((left, right) => left - right);
}
