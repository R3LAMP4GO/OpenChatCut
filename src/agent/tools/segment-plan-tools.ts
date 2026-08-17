export { SEGMENT_PLAN_TOOL_NAMES, SEGMENT_PLAN_TOOL_SCHEMAS } from './schemas/segment-plan-tools';
import type { AgentContext } from '../context';
import type { Action } from '../../editor/reducerActions';
import type { TimelineItem, TrackId } from '../../editor/types';
import { resolveTrackId } from '../../editor/types';
import { joinWords, serializeTimeline } from '../../script/serialize';
import { toSegments } from '../../transcript/segment';
import { hasOperationalTranscript } from '../../transcript/types';

type Args = Record<string, unknown>;

interface DecisionSegment {
  readonly id: string;
  readonly itemId: string;
  readonly segmentNumber: number;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly wordIndices: number[];
}

interface SegmentContext {
  readonly track: TrackId;
  readonly revision: string;
  readonly segments: DecisionSegment[];
  readonly items: TimelineItem[];
  readonly allTrackItems: TimelineItem[];
}

function targetTrack(args: Args, ctx: AgentContext): TrackId | string {
  const state = ctx.getState();
  if (typeof args.track === 'string' && args.track.trim()) {
    return resolveTrackId(state, args.track.trim()) ?? `no track ${args.track}`;
  }
  return (state.trackOrder ?? []).find((track) => state.items.some((item) => item.track === track && hasOperationalTranscript(item)))
    ?? 'no track contains a current transcript';
}

function segmentContext(args: Args, ctx: AgentContext): SegmentContext | { error: string } {
  const track = targetTrack(args, ctx);
  if (typeof track === 'string' && !(track in (ctx.getState().tracks ?? {}))) return { error: track };
  if (ctx.getState().tracks?.[track]?.locked) return { error: `track ${track} is locked` };
  const allTrackItems = ctx.getState().items
    .filter((item) => item.track === track)
    .sort((left, right) => left.startFrame - right.startFrame);
  const items = allTrackItems.filter((item) => hasOperationalTranscript(item));
  if (!items.length) return { error: `no current transcript on track ${track}` };
  const segments = items.flatMap((item) => {
    const deleted = new Set(item.deletedWordIdx ?? []);
    return toSegments(item.transcript!).flatMap((segment, index) => {
      const kept = segment.words.filter((word) => !deleted.has(word.gi));
      if (!kept.length) return [];
      return [{
        id: `${item.id}:s${index + 1}`,
        itemId: item.id,
        segmentNumber: index + 1,
        text: joinWords(kept.map((word) => word.text)),
        startMs: Math.min(...kept.map((word) => word.start)),
        endMs: Math.max(...kept.map((word) => word.end)),
        wordIndices: segment.words.map((word) => word.gi),
      }];
    });
  });
  const revision = serializeTimeline(ctx.getState(), { trackId: track }).stamp;
  return { track, revision, segments, items, allTrackItems };
}

function stringList(value: unknown, field: string): string[] | { error: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) return { error: `${field} must contain 1–500 segment IDs` };
  const values = value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean);
  if (values.length !== value.length) return { error: `${field} contains an invalid segment ID` };
  if (new Set(values).size !== values.length) return { error: `${field} contains duplicate segment IDs` };
  return values;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function buildActions(context: SegmentContext, keepIds: readonly string[], order: readonly string[]): { actions: Action[]; removedSegments: number; reordered: boolean } | { error: string } {
  const segmentById = new Map(context.segments.map((segment) => [segment.id, segment]));
  for (const id of keepIds) if (!segmentById.has(id)) return { error: `unknown or unavailable segment ID ${id}` };
  if (!sameSet(keepIds, order)) return { error: 'order must be an exact permutation of keepSegmentIds' };

  const trackItems = context.items;
  const keep = new Set(keepIds);
  const actions: Action[] = [];
  let removedSegments = 0;
  const keptItemIds = new Set(order.map((id) => segmentById.get(id)!.itemId));

  for (const item of trackItems) {
    const itemSegments = context.segments.filter((segment) => segment.itemId === item.id);
    const keptSegments = itemSegments.filter((segment) => keep.has(segment.id));
    if (!keptSegments.length) {
      actions.push({ type: 'remove', id: item.id });
      removedSegments += itemSegments.length;
      continue;
    }
    const deletedWords = itemSegments.filter((segment) => !keep.has(segment.id)).flatMap((segment) => segment.wordIndices);
    removedSegments += itemSegments.length - keptSegments.length;
    if (deletedWords.length) actions.push({ type: 'deleteWords', id: item.id, idxs: deletedWords });
    const playOrder = order.filter((id) => segmentById.get(id)!.itemId === item.id)
      .flatMap((id) => segmentById.get(id)!.wordIndices);
    actions.push({ type: 'setTranscriptPlayOrder', id: item.id, playOrder });
  }

  const orderedItemIds = order.map((id) => segmentById.get(id)!.itemId)
    .filter((id, index, values) => values.indexOf(id) === index);
  const currentItemIds = trackItems.map((item) => item.id).filter((id) => keptItemIds.has(id));
  const reordered = orderedItemIds.some((id, index) => currentItemIds[index] !== id);
  if (reordered && context.allTrackItems.some((item) => !hasOperationalTranscript(item))) {
    return { error: 'cross-item semantic reordering requires a transcript-only track' };
  }
  if (orderedItemIds.length) actions.push({ type: 'reorderTrackItems', track: context.track, orderedIds: orderedItemIds });
  return { actions, removedSegments, reordered };
}

export function execSegmentPlanTool(name: string, args: Args, ctx: AgentContext): unknown {
  if (name !== 'read_segment_plan' && name !== 'apply_segment_plan') return { error: `unknown tool ${name}` };
  const context = segmentContext(args, ctx);
  if ('error' in context) return context;
  if (name === 'read_segment_plan') {
    const offset = Math.max(0, Math.round(Number(args.offset) || 0));
    const limit = Math.max(1, Math.min(200, Math.round(Number(args.limit) || 100)));
    const page = context.segments.slice(offset, offset + limit).map(({ wordIndices: _wordIndices, ...segment }) => segment);
    return {
      ok: true, track: context.track, revision: context.revision,
      total: context.segments.length, offset, nextOffset: offset + page.length < context.segments.length ? offset + page.length : null,
      segments: page,
      decisionContract: { keepSegmentIds: 'required stable IDs', order: 'optional exact permutation', viralGuarantee: false },
    };
  }

  if (args.revision !== context.revision) return { error: 'stale segment plan; call read_segment_plan again' };
  const keepIds = stringList(args.keepSegmentIds, 'keepSegmentIds');
  if ('error' in keepIds) return keepIds;
  const order = args.order === undefined ? keepIds : stringList(args.order, 'order');
  if ('error' in order) return order;
  const built = buildActions(context, keepIds, order);
  if ('error' in built) return built;
  const summary = {
    track: context.track, revision: context.revision, keptSegments: keepIds.length,
    removedSegments: built.removedSegments, reordered: built.reordered, actions: built.actions.length,
  };
  if (args.preview === true) return { ok: true, preview: true, ...summary };
  ctx.commands.batch(built.actions, 'Apply semantic segment plan');
  const afterRevision = serializeTimeline(ctx.getState(), { trackId: context.track }).stamp;
  if (afterRevision === context.revision && built.actions.length) return { error: 'segment plan acceptance failed: timeline did not change' };
  return { ok: true, preview: false, ...summary, afterRevision };
}
