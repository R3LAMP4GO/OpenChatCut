import type { ProjectDoc } from '../editor/types.js';
import { detectCandidateTakes } from './takeReviewAnalysis.js';
import type { TakeReviewSession } from './takeReviewTypes.js';
import type { TakeRange } from './takeRanges.js';

export function createTakeReviewSession(
  doc: ProjectDoc,
  assetIds: readonly string[],
  now = Date.now(),
): TakeReviewSession | null {
  const ids = new Set(assetIds);
  const candidates = detectCandidateTakes(doc.assets.filter((asset) => ids.has(asset.id)));
  if (!candidates.length) return null;
  return {
    version: 1,
    id: `take-review-${now}-${candidates.map((candidate) => candidate.assetId).join('-')}`,
    createdAt: now,
    status: 'ready',
    candidates,
  };
}

export function setTakeReviewRanges(doc: ProjectDoc, sessionId: string, ranges: TakeRange[]): ProjectDoc {
  const sessions = doc.takeReviewSessions?.map((session) => session.id === sessionId ? { ...session, ranges } : session);
  return sessions ? { ...doc, takeReviewSessions: sessions } : doc;
}

export function selectTakeReviewRange(doc: ProjectDoc, sessionId: string, rangeId: string): ProjectDoc {
  const sessions = doc.takeReviewSessions?.map((session) => session.id === sessionId && session.ranges?.some((range) => range.id === rangeId) ? { ...session, selectedRangeId: rangeId } : session);
  return sessions ? { ...doc, takeReviewSessions: sessions } : doc;
}

export function selectTakeReviewCandidate(doc: ProjectDoc, sessionId: string, assetId: string): ProjectDoc {
  const sessions = doc.takeReviewSessions?.map((session) => (
    session.id === sessionId && session.candidates.some((candidate) => candidate.assetId === assetId)
      ? { ...session, selectedAssetId: assetId } : session
  ));
  return sessions ? { ...doc, takeReviewSessions: sessions } : doc;
}

export function addTakeReviewSession(doc: ProjectDoc, session: TakeReviewSession): ProjectDoc {
  if (doc.takeReviewSessions?.some((item) => item.id === session.id)) return doc;
  return { ...doc, takeReviewSessions: [...(doc.takeReviewSessions ?? []), session] };
}
