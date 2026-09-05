import { analyzeTranscriptTakes, type TakeAnalysis, type TakeAnalysisInput, type TakeDetectionOptions } from './transcriptTakeAnalysis';
import { TakeSemanticClient } from './takeSemanticClient';

/** Bounded embeddings stay off the render thread; the detector remains deterministic for supplied vectors. */
export async function analyzeSemanticTranscriptTakes(
  input: TakeAnalysisInput,
  client: TakeSemanticClient,
  options?: Partial<TakeDetectionOptions>,
  signal?: AbortSignal,
): Promise<TakeAnalysis> {
  const lexical = analyzeTranscriptTakes(input, options);
  const texts = [...new Set(lexical.candidates.flatMap((candidate) => [candidate.text, ...candidate.phrases.map((phrase) => phrase.text)]))];
  const vectors = await client.embed(texts, signal);
  if (signal?.aborted) throw new DOMException('Transcript take scan canceled', 'AbortError');
  const vectorByText = new Map(texts.map((text, index) => [text, vectors[index]!]));
  return analyzeTranscriptTakes(input, {
    ...options,
    semanticScorer: (left, right) => cosine(vectorByText.get(left), vectorByText.get(right)),
  });
}

function cosine(left: readonly number[] | undefined, right: readonly number[] | undefined): number {
  if (!left || !right || left.length !== right.length) return 0;
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index]! * right[index]!;
  return Math.max(0, Math.min(1, score));
}
