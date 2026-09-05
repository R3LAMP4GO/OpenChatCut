import type { MediaAsset } from '../editor/types.js';
import { sourceRevisionOf } from '../editor/mediaSourceRevision.js';
import { isTakeReviewEligible, type TakeReviewCandidate } from './takeReviewTypes.js';

/**
 * First-pass take detection deliberately treats each imported video as one
 * candidate. Scene splitting and ranking require evidence gathered later.
 */
export function detectCandidateTakes(assets: readonly MediaAsset[]): TakeReviewCandidate[] {
  const seen = new Set<string>();
  return assets
    .filter((asset) => isTakeReviewEligible(asset) && !seen.has(asset.id) && !!seen.add(asset.id))
    .map((asset) => ({
      assetId: asset.id,
      sourceRevision: sourceRevisionOf(asset),
      startFrame: 0,
      endFrame: Math.floor(asset.durationInFrames),
    }));
}
