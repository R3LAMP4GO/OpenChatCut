export { SHORTFORM_CLIP_TOOL_NAMES, SHORTFORM_CLIP_TOOL_SCHEMAS } from './schemas/shortform-clip-tools';
import type { AgentContext } from '../context';
import type { Action } from '../../editor/reducerActions';
import type { ProjectDoc, Timeline } from '../../editor/types';
import { ASPECT_PRESETS, captionTrackEntries } from '../../editor/types';
import { reduce } from '../../editor/reducerTimeline';
import { sourceWindowForTimelineRange } from '../../editor/sourceLimit';
import { createTranscriptCaptions } from '../../captions/transcriptCaptions';
import { hasOperationalTranscript, msToFrame } from '../../transcript/types';

type Args = Record<string, unknown>;
export type ShortformPreset = 'curiosity' | 'contrarian' | 'high-value' | 'emotional' | 'story' | 'newsworthy';
type PositiveScore = 'hookStrength' | 'curiosity' | 'contextCompleteness' | 'payoff' | 'specificity' | 'emotion' | 'visualSupport';
export interface ShortformScores extends Record<PositiveScore, number> { misleadingPenalty: number; incompletePenalty: number }
export interface ShortformCandidateInput {
  sourceItemId: string; startWordIndex: number; endWordIndex: number; title: string; reason: string; scores: ShortformScores;
}
export interface PlannedShortformClip extends ShortformCandidateInput {
  candidateId: string; startFrame: number; endFrame: number; durationSeconds: number; score: number;
  sourceReference: { timelineId: string; itemId: string; startWordIndex: number; endWordIndex: number };
}
export interface ShortformPlan {
  preset: ShortformPreset; ratio: string; safeFraming: 'contain'; captions: true;
  candidates: PlannedShortformClip[]; rejected: Array<{ index: number; reason: string }>;
  planRef: string;
}

type PlanResult = { ok: true; plan: ShortformPlan } | { error: string };
const PRESETS = new Set<ShortformPreset>(['curiosity', 'contrarian', 'high-value', 'emotional', 'story', 'newsworthy']);
const SCORE_KEYS: PositiveScore[] = ['hookStrength', 'curiosity', 'contextCompleteness', 'payoff', 'specificity', 'emotion', 'visualSupport'];
const WEIGHTS: Record<ShortformPreset, Partial<Record<PositiveScore, number>>> = {
  curiosity: { hookStrength: 2, curiosity: 2, payoff: 1.5 },
  contrarian: { hookStrength: 2, specificity: 1.5, payoff: 1.5 },
  'high-value': { contextCompleteness: 1.5, payoff: 2, specificity: 2 },
  emotional: { hookStrength: 1.5, emotion: 2, payoff: 1.5 },
  story: { contextCompleteness: 2, emotion: 1.5, payoff: 2 },
  newsworthy: { hookStrength: 1.5, specificity: 2, contextCompleteness: 1.5 },
};

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(36);
}
function revision(doc: ProjectDoc): string {
  const timeline = doc.timelines.find((candidate) => candidate.id === doc.activeTimelineId);
  return stableHash(JSON.stringify({
    activeTimelineId: doc.activeTimelineId,
    timeline: timeline && {
      id: timeline.id, width: timeline.width, height: timeline.height, fit: timeline.fit,
      items: timeline.items.map((item) => ({
        id: item.id, startFrame: item.startFrame, durationInFrames: item.durationInFrames, srcInFrame: item.srcInFrame,
        transcript: item.transcript?.map((word) => [word.id, word.text, word.start, word.end]),
      })),
    },
  }));
}
function finiteScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}
function parseScores(value: unknown): ShortformScores | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const parsed = Object.fromEntries([...SCORE_KEYS, 'misleadingPenalty', 'incompletePenalty'].map((key) => [key, finiteScore(raw[key])])) as unknown as ShortformScores;
  return Object.values(parsed).every((score) => score !== null) ? parsed : null;
}
function weightedScore(preset: ShortformPreset, scores: ShortformScores): number {
  let sum = 0; let weights = 0;
  for (const key of SCORE_KEYS) { const weight = WEIGHTS[preset][key] ?? 1; sum += scores[key] * weight; weights += weight; }
  const positive = sum / weights;
  return Math.round(Math.max(0, Math.min(10, positive - scores.misleadingPenalty * 0.6 - scores.incompletePenalty * 0.6)) * 10) / 10;
}
function overlaps(a: PlannedShortformClip, b: PlannedShortformClip): boolean {
  return a.startFrame < b.endFrame && b.startFrame < a.endFrame;
}
function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
}

export function buildShortformPlan(args: Args, ctx: Pick<AgentContext, 'getDoc'>): PlanResult {
  const doc = ctx.getDoc();
  const timeline = doc.timelines.find((candidate) => candidate.id === doc.activeTimelineId);
  if (!timeline) return { error: 'active timeline is unavailable' };
  const preset = typeof args.preset === 'string' && PRESETS.has(args.preset as ShortformPreset) ? args.preset as ShortformPreset : null;
  if (!preset) return { error: 'preset must be curiosity, contrarian, high-value, emotional, story, or newsworthy' };
  const ratio = typeof args.ratio === 'string' ? args.ratio : '9:16';
  if (!ASPECT_PRESETS.some((candidate) => candidate.label === ratio)) return { error: `unsupported ratio ${ratio}` };
  const maxClips = Number.isInteger(args.maxClips) ? Number(args.maxClips) : 5;
  if (maxClips < 1 || maxClips > 10) return { error: 'maxClips must be between 1 and 10' };
  const minSeconds = args.minSeconds === undefined ? 3 : Number(args.minSeconds);
  const maxSeconds = args.maxSeconds === undefined ? 90 : Number(args.maxSeconds);
  if (!Number.isFinite(minSeconds) || !Number.isFinite(maxSeconds) || minSeconds < 1 || maxSeconds > 180 || minSeconds > maxSeconds) return { error: 'duration bounds must satisfy 1 <= minSeconds <= maxSeconds <= 180' };
  if (!Array.isArray(args.candidates) || !args.candidates.length || args.candidates.length > 30) return { error: 'candidates must contain 1 to 30 proposals' };

  const accepted: PlannedShortformClip[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  args.candidates.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { rejected.push({ index, reason: 'candidate must be an object' }); return; }
    const input = raw as Record<string, unknown>;
    const sourceItemId = boundedString(input.sourceItemId, 160);
    const item = sourceItemId ? timeline.items.find((candidate) => candidate.id === sourceItemId) : undefined;
    if (!item || !hasOperationalTranscript(item)) { rejected.push({ index, reason: 'source item is missing or has no operational transcript' }); return; }
    const startWordIndex = input.startWordIndex;
    const endWordIndex = input.endWordIndex;
    if (!Number.isInteger(startWordIndex) || !Number.isInteger(endWordIndex)) { rejected.push({ index, reason: 'word indices must be integers' }); return; }
    const start = Number(startWordIndex); const end = Number(endWordIndex);
    if (start < 0 || end < start || end >= item.transcript.length) { rejected.push({ index, reason: 'word range is outside the source transcript' }); return; }
    const title = boundedString(input.title, 100); const reason = boundedString(input.reason, 500); const scores = parseScores(input.scores);
    if (!title || !reason || !scores) { rejected.push({ index, reason: 'title, reason, or bounded scores are invalid' }); return; }
    const startFrame = item.startFrame + msToFrame(item.transcript[start]!.start, timeline.fps);
    const endFrame = Math.max(startFrame + 1, item.startFrame + msToFrame(item.transcript[end]!.end, timeline.fps));
    const durationSeconds = (endFrame - startFrame) / timeline.fps;
    if (durationSeconds < minSeconds || durationSeconds > maxSeconds) { rejected.push({ index, reason: 'candidate is outside duration bounds' }); return; }
    const score = weightedScore(preset, scores);
    accepted.push({
      sourceItemId: item.id, startWordIndex: start, endWordIndex: end, title, reason, scores,
      candidateId: `short_${stableHash(`${item.id}:${start}:${end}:${title}`)}`,
      startFrame, endFrame, durationSeconds: Math.round(durationSeconds * 100) / 100, score,
      sourceReference: { timelineId: timeline.id, itemId: item.id, startWordIndex: start, endWordIndex: end },
    });
  });
  accepted.sort((a, b) => b.score - a.score || a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  const deduplicated: PlannedShortformClip[] = [];
  for (const candidate of accepted) {
    if (deduplicated.some((kept) => overlaps(candidate, kept))) {
      const index = args.candidates.findIndex((raw) => raw && typeof raw === 'object'
        && (raw as Record<string, unknown>).sourceItemId === candidate.sourceItemId
        && (raw as Record<string, unknown>).startWordIndex === candidate.startWordIndex
        && (raw as Record<string, unknown>).endWordIndex === candidate.endWordIndex);
      rejected.push({ index, reason: 'overlaps a higher-scoring candidate' });
      continue;
    }
    deduplicated.push(candidate);
    if (deduplicated.length >= maxClips) break;
  }
  if (!deduplicated.length) return { error: `no candidates survived deterministic validation (${rejected.map((entry) => entry.reason).join('; ')})` };
  const basis = { revision: revision(doc), preset, ratio, candidates: deduplicated.map((candidate) => [candidate.candidateId, candidate.score, candidate.startFrame, candidate.endFrame]) };
  return { ok: true, plan: { preset, ratio, safeFraming: 'contain', captions: true, candidates: deduplicated, rejected, planRef: `shortform:${stableHash(JSON.stringify(basis))}` } };
}

function trimTimeline(source: Timeline, clip: PlannedShortformClip, id: string, order: number, width: number, height: number): Timeline {
  let state: Timeline = { ...source, id, name: clip.title, order, width, height, fit: 'contain', selectedId: null, selectedIds: [] };
  const sourceItem = source.items.find((item) => item.id === clip.sourceItemId)!;
  const outside = sourceItem.transcript!.map((_, index) => index).filter((index) => index < clip.startWordIndex || index > clip.endWordIndex);
  if (outside.length) state = { ...reduce(state, { type: 'deleteWords', id: sourceItem.id, idxs: outside }), id, name: clip.title, order };
  state = { ...reduce(state, { type: 'move', id: sourceItem.id, startFrame: 0 }), id, name: clip.title, order };
  for (const item of source.items) {
    if (item.id === sourceItem.id) continue;
    const overlapStart = Math.max(item.startFrame, clip.startFrame);
    const overlapEnd = Math.min(item.startFrame + item.durationInFrames, clip.endFrame);
    let action: Action;
    if (overlapEnd <= overlapStart) action = { type: 'remove', id: item.id };
    else {
      const leftTrim = overlapStart - item.startFrame;
      action = {
        type: 'retime', id: item.id, startFrame: overlapStart - clip.startFrame, durationInFrames: overlapEnd - overlapStart,
        srcInFrame: item.src ? sourceWindowForTimelineRange(item, leftTrim, overlapEnd - overlapStart).startFrame : undefined,
      };
    }
    state = { ...reduce(state, action), id, name: clip.title, order };
  }
  const captionTarget = captionTrackEntries(state)[0];
  createTranscriptCaptions([sourceItem.id], captionTarget, (captions, track) => {
    if (track) state = { ...reduce(state, { type: 'setCaptions', captions, track }), id, name: clip.title, order };
    else {
      const captionTrack = `track_${crypto.randomUUID()}`;
      state = { ...reduce(state, { type: 'track.create', track: { id: captionTrack, kind: 'caption', name: 'Captions' } }), id, name: clip.title, order };
      state = { ...reduce(state, { type: 'setCaptions', captions, track: captionTrack }), id, name: clip.title, order };
    }
  });
  return state;
}

export function applyShortformPlan(args: Args, ctx: AgentContext): unknown {
  const planned = buildShortformPlan(args, ctx);
  if ('error' in planned) return planned;
  if (args.planRef !== planned.plan.planRef) return { error: 'short-form plan is stale; preview again before applying' };
  if (!Array.isArray(args.approvedCandidateIds) || !args.approvedCandidateIds.length || args.approvedCandidateIds.some((id) => typeof id !== 'string')) return { error: 'approvedCandidateIds must contain approved IDs from the preview' };
  const approved = new Set(args.approvedCandidateIds as string[]);
  if (approved.size !== args.approvedCandidateIds.length) return { error: 'approvedCandidateIds contains duplicates' };
  const selected = planned.plan.candidates.filter((candidate) => approved.has(candidate.candidateId));
  if (selected.length !== approved.size) return { error: 'approvedCandidateIds contains an ID outside the fresh plan' };
  const doc = ctx.getDoc();
  const source = doc.timelines.find((timeline) => timeline.id === doc.activeTimelineId);
  if (!source) return { error: 'active timeline is unavailable' };
  const preset = ASPECT_PRESETS.find((candidate) => candidate.label === planned.plan.ratio)!;
  let order = doc.timelines.reduce((max, timeline) => Math.max(max, timeline.order), -1);
  const clips = selected.map((candidate) => trimTimeline(source, candidate, `tl_${crypto.randomUUID()}`, ++order, preset.width, preset.height));
  ctx.commands.applyDoc({ ...doc, timelines: [...doc.timelines, ...clips] });
  const appliedIds = new Set(ctx.getDoc().timelines.map((timeline) => timeline.id));
  if (!clips.every((clip) => appliedIds.has(clip.id))) return { error: 'short-form clips failed acceptance checks' };
  return {
    ok: true, count: clips.length,
    clips: clips.map((clip, index) => ({ timelineId: clip.id, title: clip.name, ratio: planned.plan.ratio, captions: true, safeFraming: 'contain', sourceReference: selected[index]!.sourceReference })),
  };
}

export async function execShortformClipTool(name: string, args: Args, ctx: AgentContext): Promise<unknown> {
  if (name === 'plan_shortform_clips') return buildShortformPlan(args, ctx);
  if (name === 'apply_shortform_clips') return applyShortformPlan(args, ctx);
  return { error: `unknown tool ${name}` };
}
