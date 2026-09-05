import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PlayerRef } from '@remotion/player';
import type { TimelineItem } from '../editor/types';
import { wordTimelineFrame } from '../transcript/edit';
import { useT } from '../i18n/locale';
import { analyzeSemanticTranscriptTakes } from './takeSemanticScan';
import { TakeSemanticClient, TakeSemanticPackUnavailableError } from './takeSemanticClient';
import { createTakeScanLifecycle } from './takeScanLifecycle';
import type { TakeAnalysis, TakeGroup, TakeMember } from './transcriptTakeAnalysis';

export interface TakeWordHighlight { label: string; onKeep: () => void; }
interface Props { item: TimelineItem; fps: number; playerRef: RefObject<PlayerRef | null>; onDeleteWords: (id: string, indexes: number[]) => void; onHighlights?: (highlights: ReadonlyMap<number, TakeWordHighlight>) => void; }
const rangeIndexes = (ranges: readonly (readonly [number, number])[]) => ranges.flatMap(([start, end]) => Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset));
const seconds = (milliseconds: number) => `${(milliseconds / 1_000).toFixed(1)}s`;

export function TranscriptTakeReview({ item, fps, playerRef, onDeleteWords, onHighlights }: Props) {
  const t = useT();
  const client = useRef<TakeSemanticClient | undefined>(undefined);
  const scans = useRef(createTakeScanLifecycle<TakeAnalysis>()).current;
  const generation = item.transcriptGenerationId ?? '';
  const words = item.transcript ?? [];
  const transcriptIdentity = `${item.id}:${generation}`;
  const currentTranscriptIdentity = useRef(transcriptIdentity);
  currentTranscriptIdentity.current = transcriptIdentity;
  const [analysis, setAnalysis] = useState<TakeAnalysis | null>(null);
  const [takesOpen, setTakesOpen] = useState(true);
  const [status, setStatus] = useState<'idle' | 'scanning' | 'unavailable' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<{ group: TakeGroup; keep: TakeMember } | null>(null);

  useEffect(() => () => { scans.cancel(); client.current?.dispose(); onHighlights?.(new Map()); }, [onHighlights, scans]);
  useEffect(() => { scans.cancel(); setAnalysis(null); setPending(null); setStatus('idle'); onHighlights?.(new Map()); }, [generation, words, onHighlights, scans]);
  if (!generation || !words.length) return null;

  const scan = () => {
    scans.start({
      reset: () => { setStatus('scanning'); setMessage(''); setAnalysis(null); setPending(null); onHighlights?.(new Map()); },
      run: (signal) => analyzeSemanticTranscriptTakes({ sourceItemId: item.id, transcriptGenerationId: generation, words }, client.current ??= new TakeSemanticClient(), undefined, signal),
      apply: (result) => {
        if (currentTranscriptIdentity.current !== transcriptIdentity) return;
        setAnalysis(result); setStatus('idle');
        const highlights = new Map<number, TakeWordHighlight>();
        result.groups.forEach((group) => group.members.forEach((member, memberIndex) => rangeIndexes(member.matchedWordRanges).forEach((index) => highlights.set(index, { label: `Take ${memberIndex + 1}`, onKeep: () => setPending({ group, keep: member }) }))));
        onHighlights?.(highlights);
      },
      reject: (error) => {
        if (currentTranscriptIdentity.current !== transcriptIdentity) return;
        setStatus(error instanceof TakeSemanticPackUnavailableError ? 'unavailable' : 'error');
        setMessage(error instanceof Error ? error.message : t('重录扫描失败'));
      },
    });
  };
  const preview = (member: TakeMember) => {
    const index = member.matchedWordRanges[0]?.[0] ?? member.wordRanges[0]?.[0];
    const frame = index === undefined ? null : wordTimelineFrame(item, words[index]!, fps);
    if (frame !== null) playerRef.current?.seekTo(frame);
  };
  const possibleMatches = analysis?.pairs.filter((pair) => pair.score.disposition === 'POSSIBLE_MATCH') ?? [];
  const apply = () => {
    if (!pending || item.transcriptGenerationId !== generation) return;
    const deleted = new Set(item.deletedWordIdx ?? []);
    const indexes = pending.group.members.filter((member) => member !== pending.keep).flatMap((member) => rangeIndexes(member.matchedWordRanges)).filter((index) => !deleted.has(index) && index >= 0 && index < words.length);
    if (indexes.length) onDeleteWords(item.id, [...new Set(indexes)].sort((a, b) => a - b));
    setPending(null); setAnalysis(null); onHighlights?.(new Map());
  };

  return <section className="cc-tx-editbar" aria-label={t('重录审阅')} aria-live="polite">
    <div role="tablist" aria-label={t('转写工具')} style={{ display: 'flex', gap: 4 }}>
      <button type="button" role="tab" aria-selected={!takesOpen} className="cc-tx-btn sm" onClick={() => setTakesOpen(false)}>{t('转写')}</button>
      <button type="button" role="tab" aria-selected={takesOpen} className="cc-tx-btn sm" onClick={() => { setTakesOpen(true); scan(); }}>{t('重录')}</button>
    </div>
    {takesOpen && <>
    <button type="button" className="cc-tx-btn" onClick={scan} disabled={status === 'scanning'}>{status === 'scanning' ? t('正在查找重录…') : t('查找重录')}</button>
    {status === 'unavailable' && <span className="cc-tx-muted">{t('请在本地模型中安装转写复述匹配模型，以审阅改述内容。')}</span>}
    {status === 'error' && <span className="cc-tx-error">{message} <button type="button" className="cc-tx-btn sm" onClick={() => void scan()}>{t('重试')}</button></span>}
    {analysis?.telemetry.pairTruncated && <span className="cc-tx-muted">{t('已达到扫描上限；请缩短片段后重新扫描。')}</span>}
    {analysis?.groups.map((group) => <div key={group.id} style={{ width: '100%', marginTop: 8 }}>
      <b>{t('匹配的重录')} · {Math.round(Math.max(...group.scores.map((score) => score.overall)) * 100)}% {t('置信度')}</b>
      {group.members.map((member) => <div key={`${member.start}-${member.end}`} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button type="button" className="cc-tx-btn sm" onClick={() => preview(member)}>{t('预览')} {seconds(member.start)}</button>
        <mark style={{ background: 'rgba(250, 204, 21, .28)', color: 'inherit', padding: '0 2px' }}>{member.text}</mark>
        <button type="button" className="cc-tx-btn sm" onClick={() => setPending({ group, keep: member })}>{t('保留此版本')}</button>
      </div>)}
    </div>)}
    {possibleMatches.map((pair) => <div key={`${pair.left.first}:${pair.left.last}-${pair.right.first}:${pair.right.last}`} className="cc-tx-muted" style={{ width: '100%', marginTop: 8 }}>
      <b>{t('可能匹配（仅供审阅；不会删除任何词）')}</b> <mark>{pair.left.text}</mark> ↔ <mark>{pair.right.text}</mark>
    </div>)}
    {analysis && !analysis.groups.length && <span className="cc-tx-muted">{t('未找到可安全删除的匹配重录。')}</span>}
    {pending && <div role="dialog" aria-modal="true" aria-label={t('确认删除重录')} style={{ width: '100%', marginTop: 8 }}>
      <span>{t('仅删除其他版本中已匹配的词吗？独有内容将保持不变。')}</span>
      <button type="button" className="cc-tx-btn primary sm" onClick={apply}>{t('确认删除')}</button>
      <button type="button" className="cc-tx-btn sm" onClick={() => setPending(null)}>{t('取消')}</button>
    </div>}
    </>}
  </section>;
}
