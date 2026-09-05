import type { MediaAsset } from '../editor/types.js';
import type { TakeRange } from './takeRanges.js';

export function isTakeRange(value: unknown): value is TakeRange {
  if (!value || typeof value !== 'object') return false;
  const range = value as Partial<TakeRange>;
  return typeof range.id === 'string' && typeof range.assetId === 'string' && typeof range.sourceRevision === 'string'
    && typeof range.startFrame === 'number' && Number.isInteger(range.startFrame) && range.startFrame >= 0
    && typeof range.endFrame === 'number' && Number.isInteger(range.endFrame) && range.endFrame > range.startFrame
    && Array.isArray(range.evidence) && range.evidence.every((item) => item === 'scene' || item === 'silence');
}

export const TAKE_REVIEW_SESSION_VERSION = 1 as const;

export interface TakeReviewCandidate {
  assetId: string;
  sourceRevision: string;
  startFrame: number;
  endFrame: number;
}

/** Persisted, non-destructive source review state. No candidate implies an edit. */
export interface TakeReviewSession {
  version: typeof TAKE_REVIEW_SESSION_VERSION;
  id: string;
  createdAt: number;
  status: 'ready' | 'stale';
  candidates: TakeReviewCandidate[];
  selectedAssetId?: string;
  ranges?: TakeRange[];
  selectedRangeId?: string;
}

export function isTakeReviewCandidate(value: unknown): value is TakeReviewCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TakeReviewCandidate>;
  const { assetId, sourceRevision, startFrame, endFrame } = candidate;
  return typeof assetId === 'string' && assetId.length > 0
    && typeof sourceRevision === 'string' && sourceRevision.length > 0
    && typeof startFrame === 'number' && Number.isInteger(startFrame) && startFrame >= 0
    && typeof endFrame === 'number' && Number.isInteger(endFrame) && endFrame > startFrame;
}

export function isTakeReviewSession(value: unknown): value is TakeReviewSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<TakeReviewSession>;
  const { id, createdAt, status, candidates } = session;
  const validCandidates = Array.isArray(candidates) && candidates.every(isTakeReviewCandidate);
  const validRanges = session.ranges === undefined || (Array.isArray(session.ranges) && session.ranges.every(isTakeRange));
  return validCandidates && validRanges
    && (session.selectedAssetId === undefined || (typeof session.selectedAssetId === 'string' && candidates.some((candidate) => candidate.assetId === session.selectedAssetId)))
    && (session.selectedRangeId === undefined || (typeof session.selectedRangeId === 'string' && !!session.ranges?.some((range) => range.id === session.selectedRangeId)))
    && session.version === TAKE_REVIEW_SESSION_VERSION
    && typeof id === 'string' && id.length > 0
    && typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt >= 0
    && (status === 'ready' || status === 'stale');
}

export function isTakeReviewEligible(asset: MediaAsset): boolean {
  return asset.kind === 'video' && asset.durationInFrames > 0;
}
