import type { SilenceSpan } from '../audio/silence.js';
import type { SceneChange } from '../scene-detection/detect.js';

export interface TakeRange { id: string; assetId: string; sourceRevision: string; startFrame: number; endFrame: number; evidence: Array<'scene' | 'silence'>; }

export function buildTakeRanges(input: { assetId: string; sourceRevision: string; durationInFrames: number; fps: number; scenes?: readonly SceneChange[]; silence?: readonly SilenceSpan[]; minFrames?: number }): TakeRange[] {
  const { assetId, sourceRevision, durationInFrames, fps } = input;
  if (!Number.isInteger(durationInFrames) || durationInFrames <= 0 || !Number.isFinite(fps) || fps <= 0) return [];
  const minimum = input.minFrames ?? Math.max(1, Math.round(fps));
  if (durationInFrames < minimum) return [];
  const boundaries = new Map<number, Set<'scene' | 'silence'>>([[0, new Set()], [durationInFrames, new Set()]]);
  const add = (frame: number, evidence: 'scene' | 'silence') => { const value = Math.max(0, Math.min(durationInFrames, Math.round(frame))); if (value > 0 && value < durationInFrames) (boundaries.get(value) ?? boundaries.set(value, new Set()).get(value)!).add(evidence); };
  input.scenes?.forEach((scene) => add((scene.timeMs / 1000) * fps, 'scene'));
  input.silence?.forEach((span) => { add((span.startMs / 1000) * fps, 'silence'); add((span.endMs / 1000) * fps, 'silence'); });
  const points = [...boundaries.keys()].sort((a, b) => a - b);
  const accepted = [0];
  for (const point of points.slice(1, -1)) if (point - accepted[accepted.length - 1]! >= minimum && durationInFrames - point >= minimum) accepted.push(point);
  accepted.push(durationInFrames);
  return accepted.slice(0, -1).map((startFrame, index) => {
    const endFrame = accepted[index + 1]!;
    const evidence = [...(boundaries.get(startFrame) ?? []), ...(boundaries.get(endFrame) ?? [])];
    return { id: `${assetId}:${startFrame}-${endFrame}`, assetId, sourceRevision, startFrame, endFrame, evidence };
  });
}
