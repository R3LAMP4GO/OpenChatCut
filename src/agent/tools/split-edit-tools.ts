export { SPLIT_EDIT_TOOL_NAMES, SPLIT_EDIT_TOOL_SCHEMAS } from './schemas/split-edit-tools';
import type { AgentContext } from '../context';
import type { Action } from '../../editor/reducerActions';
import type { TimelineItem, TrackId } from '../../editor/types';
import { resolveTrackId } from '../../editor/types';

type Args = Record<string, unknown>;
type SplitEditType = 'j-cut' | 'l-cut';

export interface SplitEditPlan {
  readonly type: SplitEditType;
  readonly outgoingId: string;
  readonly incomingId: string;
  readonly audioTrack: TrackId;
  readonly cutFrame: number;
  readonly durationFrames: number;
  readonly durationSeconds: number;
  readonly audioStartFrame: number;
  readonly audioDurationInFrames: number;
  readonly audioSrcInFrame: number;
  readonly sourceItemId: string;
  readonly mutedItemId: string;
  readonly splitFrame: number | null;
  readonly planRef: string;
}

type PlanResult = { readonly ok: true; readonly plan: SplitEditPlan } | { readonly error: string };

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function resolveItem(items: readonly TimelineItem[], ref: unknown): TimelineItem | string {
  const value = typeof ref === 'string' ? ref.trim() : '';
  if (!value) return 'item ID is required';
  const exact = items.find((item) => item.id === value);
  if (exact) return exact;
  const matches = items.filter((item) => item.id.startsWith(value));
  if (matches.length === 1) return matches[0]!;
  return matches.length ? `ambiguous item ID ${value}` : `no item ${value}`;
}

function endFrame(item: TimelineItem): number {
  return item.startFrame + item.durationInFrames;
}

function sourceDuration(ctx: AgentContext, item: TimelineItem): number | null {
  const sourceId = item.sourceAssetId;
  const asset = sourceId ? (ctx.getDoc().assets ?? []).find((candidate) => candidate.id === sourceId) : undefined;
  return asset?.durationInFrames ?? null;
}

function trackHasRoom(ctx: AgentContext, track: TrackId, fromFrame: number, toFrame: number): boolean {
  return !ctx.getState().items.some((item) => item.track === track
    && item.startFrame < toFrame && endFrame(item) > fromFrame);
}

function resolveAudioTrack(
  ctx: AgentContext,
  requested: unknown,
  fromFrame: number,
  toFrame: number,
): { track: TrackId } | { error: string } {
  const state = ctx.getState();
  const tracks = state.tracks ?? {};
  if (typeof requested === 'string' && requested.trim()) {
    const track = resolveTrackId(state, requested.trim(), 'audio');
    if (!track) return { error: `no compatible audio track ${requested}` };
    if (tracks[track]?.locked) return { error: `audio track ${track} is locked` };
    if (!trackHasRoom(ctx, track, fromFrame, toFrame)) return { error: `audio track ${track} overlaps the planned split edit` };
    return { track };
  }
  const track = (state.trackOrder ?? []).find((id) => tracks[id]?.kind === 'audio'
    && !tracks[id]?.locked && trackHasRoom(ctx, id, fromFrame, toFrame));
  return track ? { track } : { error: 'no unlocked non-overlapping audio track; create one with edit_track first' };
}

export function buildSplitEditPlan(args: Args, ctx: AgentContext): PlanResult {
  const type = args.type === 'j-cut' || args.type === 'l-cut' ? args.type : null;
  if (!type) return { error: 'type must be j-cut or l-cut' };
  const outgoing = resolveItem(ctx.getState().items, args.outgoingId);
  if (typeof outgoing === 'string') return { error: outgoing };
  const incoming = resolveItem(ctx.getState().items, args.incomingId);
  if (typeof incoming === 'string') return { error: incoming };
  if (outgoing.kind !== 'video' || incoming.kind !== 'video') return { error: 'split edits require two video items' };
  const cutFrame = incoming.startFrame;
  if (endFrame(outgoing) !== cutFrame) return { error: 'outgoing and incoming items must be exactly adjacent at the picture cut' };
  if (ctx.getState().tracks?.[outgoing.track]?.locked || ctx.getState().tracks?.[incoming.track]?.locked) {
    return { error: 'split edit cannot modify a locked video track' };
  }
  const seconds = Number(args.durationSeconds);
  if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 5) return { error: 'durationSeconds must be between 0.1 and 5' };
  const durationFrames = Math.max(1, Math.round(seconds * ctx.getState().fps));
  const source = type === 'j-cut' ? incoming : outgoing;
  if (!source.src) return { error: `source item ${source.id} has no playable media` };

  const audioStartFrame = type === 'j-cut' ? cutFrame - durationFrames : cutFrame;
  if (audioStartFrame < outgoing.startFrame) return { error: 'requested J-cut lead exceeds the outgoing picture duration' };
  const audioSrcInFrame = type === 'j-cut'
    ? (incoming.srcInFrame ?? 0) - durationFrames
    : (outgoing.srcInFrame ?? 0) + outgoing.durationInFrames;
  if (audioSrcInFrame < 0) return { error: 'incoming source has insufficient audio preroll for this J-cut' };
  const audioDurationInFrames = type === 'j-cut'
    ? incoming.durationInFrames + durationFrames
    : durationFrames;
  const available = sourceDuration(ctx, source);
  if (available !== null && audioSrcInFrame + audioDurationInFrames > available) {
    return { error: type === 'j-cut' ? 'incoming source window exceeds available media' : 'outgoing source has insufficient audio after the picture cut' };
  }
  const resolvedAudioTrack = resolveAudioTrack(ctx, args.audioTrack, audioStartFrame, audioStartFrame + audioDurationInFrames);
  if ('error' in resolvedAudioTrack) return resolvedAudioTrack;
  const audioTrack = resolvedAudioTrack.track;

  const splitFrame = type === 'j-cut'
    ? (audioStartFrame > outgoing.startFrame ? audioStartFrame : null)
    : (cutFrame + durationFrames < endFrame(incoming) ? cutFrame + durationFrames : null);
  const mutedItemId = type === 'j-cut' ? outgoing.id : incoming.id;
  const fingerprint = JSON.stringify({
    type, outgoing: [outgoing.id, outgoing.startFrame, outgoing.durationInFrames, outgoing.srcInFrame, outgoing.volume],
    incoming: [incoming.id, incoming.startFrame, incoming.durationInFrames, incoming.srcInFrame, incoming.volume],
    audioTrack, durationFrames, available,
  });
  return {
    ok: true,
    plan: {
      type, outgoingId: outgoing.id, incomingId: incoming.id, audioTrack,
      cutFrame, durationFrames, durationSeconds: durationFrames / ctx.getState().fps,
      audioStartFrame, audioDurationInFrames, audioSrcInFrame,
      sourceItemId: source.id, mutedItemId, splitFrame,
      planRef: `split-edit:${stableHash(fingerprint)}`,
    },
  };
}

function audioItem(source: TimelineItem, plan: SplitEditPlan, id: string): Omit<TimelineItem, 'startFrame'> {
  return {
    id,
    kind: 'audio',
    name: `${plan.type === 'j-cut' ? 'Incoming lead' : 'Outgoing tail'} · ${source.name}`,
    track: plan.audioTrack,
    durationInFrames: plan.audioDurationInFrames,
    srcInFrame: plan.audioSrcInFrame,
    src: source.src,
    sourceAssetId: source.sourceAssetId,
    sourceFilename: source.sourceFilename,
    volume: 1,
  };
}

function applyPlan(plan: SplitEditPlan, ctx: AgentContext): { ok: true; audioItemId: string; changedItemIds: string[] } | { error: string } {
  const state = ctx.getState();
  const outgoing = state.items.find((item) => item.id === plan.outgoingId)!;
  const incoming = state.items.find((item) => item.id === plan.incomingId)!;
  const source = state.items.find((item) => item.id === plan.sourceItemId)!;
  const audioItemId = crypto.randomUUID();
  const actions: Action[] = [];
  const changedItemIds = [plan.outgoingId, plan.incomingId];

  if (plan.type === 'j-cut') {
    if (plan.splitFrame !== null) {
      const mutedTailId = crypto.randomUUID();
      actions.push({ type: 'split', id: outgoing.id, atFrame: plan.splitFrame, newId: mutedTailId });
      actions.push({ type: 'setVolume', id: mutedTailId, volume: 0 });
      changedItemIds.push(mutedTailId);
    } else {
      actions.push({ type: 'setVolume', id: outgoing.id, volume: 0 });
    }
    actions.push({ type: 'setVolume', id: incoming.id, volume: 0 });
  } else {
    if (plan.splitFrame !== null) {
      const continuationId = crypto.randomUUID();
      actions.push({ type: 'split', id: incoming.id, atFrame: plan.splitFrame, newId: continuationId });
      changedItemIds.push(continuationId);
    }
    actions.push({ type: 'setVolume', id: incoming.id, volume: 0 });
  }
  actions.push({ type: 'add', item: audioItem(source, plan, audioItemId), startFrame: plan.audioStartFrame });
  ctx.commands.batch(actions, plan.type === 'j-cut' ? 'Apply J-cut' : 'Apply L-cut');

  const after = ctx.getState();
  const added = after.items.find((item) => item.id === audioItemId);
  if (!added || added.startFrame !== plan.audioStartFrame || added.srcInFrame !== plan.audioSrcInFrame) {
    return { error: 'split edit acceptance failed: audio item timing mismatch' };
  }
  if (after.items.find((item) => item.id === plan.incomingId)?.volume !== 0) {
    return { error: 'split edit acceptance failed: overlapping embedded audio remains audible' };
  }
  return { ok: true, audioItemId, changedItemIds };
}

export function execSplitEditTool(name: string, args: Args, ctx: AgentContext): unknown {
  if (name !== 'plan_split_edit' && name !== 'apply_split_edit') return { error: `unknown tool ${name}` };
  const planned = buildSplitEditPlan(args, ctx);
  if ('error' in planned) return planned;
  if (name === 'plan_split_edit') return { ok: true, ...planned.plan };
  const planRef = typeof args.planRef === 'string' ? args.planRef : '';
  if (!planRef) return { error: 'planRef from plan_split_edit is required' };
  if (planRef !== planned.plan.planRef) return { error: 'stale split-edit plan; call plan_split_edit again' };
  const applied = applyPlan(planned.plan, ctx);
  return 'error' in applied ? applied : { plan: planned.plan, ...applied };
}
