import { useEffect, useState } from 'react';
import { startSceneDetectionJob, getSceneDetectionJob } from '../scene-detection/jobs.js';
import { buildTakeRanges, type TakeRange } from './takeRanges.js';
import type { MediaAsset } from '../editor/types.js';
import type { TakeReviewSession } from './takeReviewTypes.js';

export function TakeReviewPanel({ session, assets, onClose, onSelect, onRanges, onSelectRange, onInsertRange, fps = 30 }: {
  session: TakeReviewSession;
  assets: readonly MediaAsset[];
  onClose: () => void;
  onSelect: (assetId: string) => void;
  onRanges?: (ranges: TakeRange[]) => void;
  onSelectRange?: (rangeId: string) => void;
  onInsertRange?: (range: TakeRange) => void;
  fps?: number;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const analyze = async () => { const candidate = session.candidates.find((item) => item.assetId === session.selectedAssetId) ?? session.candidates[0]; const asset = candidate && assetById.get(candidate.assetId); if (!asset) return; setAnalyzing(true); setAnalysisError(null); try { let job = await startSceneDetectionJob({ src: asset.src }); while (!job.result && !job.error && job.status !== 'cancelled') { await new Promise((resolve) => setTimeout(resolve, 400)); job = await getSceneDetectionJob(job.id); } if (!job.result) throw new Error(job.error ?? 'Range detection was cancelled'); onRanges?.(buildTakeRanges({ assetId: asset.id, sourceRevision: candidate.sourceRevision, durationInFrames: asset.durationInFrames, fps, scenes: job.result.scenes })); } catch (error) { setAnalysisError(error instanceof Error ? error.message : 'Range detection failed'); } finally { setAnalyzing(false); } };
  return <div className="cc-modal-backdrop" role="dialog" aria-modal="true" aria-label="Take review" onMouseDown={onClose}>
    <section onMouseDown={(event) => event.stopPropagation()} style={{ width: 'min(720px, calc(100vw - 32px))', maxHeight: 'min(680px, calc(100vh - 32px))', overflow: 'auto', background: 'var(--cc-panel)', border: '1px solid var(--cc-border)', borderRadius: 8, padding: 20 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 16 }}>
        <div><h2 style={{ margin: 0, fontSize: 16 }}>Take review</h2><p style={{ margin: '4px 0 0', color: 'var(--cc-text-dim)', fontSize: 13 }}>Choose source material only. This never adds clips to the timeline.</p></div>
        <button type="button" autoFocus onClick={onClose} aria-label="Close take review">Close</button>
      </header>
      <button type="button" onClick={() => void analyze()} disabled={analyzing}>{analyzing ? 'Detecting ranges…' : 'Detect ranges'}</button>
      {analysisError && <p role="alert">{analysisError}</p>}
      {session.ranges?.map((range) => <div key={range.id} style={{ marginTop: 8 }}><button type="button" aria-pressed={session.selectedRangeId === range.id} onClick={() => onSelectRange?.(range.id)}>{range.startFrame}–{range.endFrame} frames ({range.evidence.join(', ') || 'full source'})</button>{session.selectedRangeId === range.id && <button type="button" onClick={() => onInsertRange?.(range)}>Add selected range to timeline</button>}</div>)}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
        {session.candidates.map((candidate) => {
          const asset = assetById.get(candidate.assetId);
          const selected = session.selectedAssetId === candidate.assetId;
          return <button key={candidate.assetId} type="button" aria-pressed={selected} onClick={() => onSelect(candidate.assetId)} style={{ padding: 10, border: `1px solid ${selected ? 'var(--cc-accent)' : 'var(--cc-border)'}`, borderRadius: 6, background: 'var(--cc-bg)', color: 'var(--cc-text)', textAlign: 'left', cursor: 'pointer' }}>
            {asset?.kind === 'video' ? <video src={asset.src} muted preload="metadata" playsInline style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'contain', background: '#000', display: 'block', marginBottom: 8 }} /> : null}
            <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset?.name ?? candidate.assetId}</strong>
            <span style={{ color: 'var(--cc-text-dim)', fontSize: 12 }}>{candidate.endFrame - candidate.startFrame} frames{selected ? ' · Selected' : ''}</span>
          </button>;
        })}
      </div>
    </section>
  </div>;
}
