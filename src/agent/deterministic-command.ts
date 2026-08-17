import type { AgentContext, AgentReference } from './context';
import type { AgentSendOptions } from './useAgentRun';
import type { Action } from '../editor/reducerActions';
import { buildSplitEditPlan, execSplitEditTool } from './tools/split-edit-tools';
import { execCaptionsTool } from './tools/captions-tools';
import { execSilenceTool } from './tools/silence-tools';

type FastResult = { readonly handled: false } | { readonly handled: true; readonly ok: boolean; readonly summary: string };

const SPLIT_RE = /^\s*(?:split|cut)\s+(?:the\s+)?selected\s+clip\s+at\s+(?:the\s+)?playhead[.!]?\s*$/i;
const SILENCE_RE = /^\s*(?:remove|cut)\s+(?:the\s+)?(?:silence|dead\s+air)(?:\s+from\s+(?:the\s+)?selected\s+clip)?[.!]?\s*$/i;
const CAPTIONS_RE = /^\s*(?:generate|create|add)\s+(?:captions|subtitles)[.!]?\s*$/i;
const SPLIT_EDIT_RE = /^\s*(?:add|apply|create)\s+(?:a\s+)?(?:(\d+(?:\.\d+)?)\s*[- ]?second\s+)?([jl])[- ]?cut[.!]?\s*$/i;

function itemReferences(references: readonly AgentReference[] | undefined): string[] {
  return (references ?? []).flatMap((reference) => reference.kind === 'item' ? [reference.metadata.itemId] : []);
}

function timepoint(references: readonly AgentReference[] | undefined): number | null {
  const points = (references ?? []).flatMap((reference) => reference.kind === 'timepoint'
    ? [reference.metadata.timelineFrameStart] : []);
  return points.length === 1 ? points[0]! : null;
}

function selectedItemIds(ctx: AgentContext, references: readonly AgentReference[] | undefined): string[] {
  const referenced = itemReferences(references);
  if (referenced.length) return [...new Set(referenced)];
  const state = ctx.getState();
  return [...new Set(state.selectedIds?.length ? state.selectedIds : state.selectedId ? [state.selectedId] : [])];
}

function errorSummary(result: unknown): string {
  if (result && typeof result === 'object' && 'error' in result) return String(result.error);
  return 'deterministic command failed';
}

export async function executeDeterministicCommand(
  text: string,
  options: AgentSendOptions,
  ctx: AgentContext,
): Promise<FastResult> {
  if (options.askOnly || options.references?.some((reference) => reference.kind !== 'item' && reference.kind !== 'timepoint')) {
    return { handled: false };
  }
  if (ctx.getCreativeMode() || ctx.getApprovalMode?.() !== 'auto') return { handled: false };

  if (SPLIT_RE.test(text)) {
    const ids = selectedItemIds(ctx, options.references);
    const frame = timepoint(options.references);
    if (ids.length !== 1 || frame === null) return { handled: false };
    const item = ctx.getState().items.find((candidate) => candidate.id === ids[0]);
    if (!item || frame <= item.startFrame || frame >= item.startFrame + item.durationInFrames) return { handled: false };
    const actions: Action[] = [{ type: 'split', id: item.id, atFrame: frame, newId: crypto.randomUUID() }];
    ctx.commands.batch(actions, 'Split selected clip at playhead');
    return { handled: true, ok: true, summary: `Split ${item.name} at frame ${frame} in one undoable edit.` };
  }

  if (SILENCE_RE.test(text)) {
    const ids = selectedItemIds(ctx, options.references);
    if (ids.length > 1) return { handled: false };
    const result = await execSilenceTool('remove_silence', ids.length ? { itemId: ids[0] } : {}, ctx);
    if (result && typeof result === 'object' && 'ok' in result && result.ok === true) {
      return { handled: true, ok: true, summary: 'Removed detected dead air with deterministic on-device analysis in one undoable batch.' };
    }
    return { handled: true, ok: false, summary: errorSummary(result) };
  }

  if (CAPTIONS_RE.test(text)) {
    const result = await execCaptionsTool('edit_captions', { action: 'enable' }, ctx);
    if (result && typeof result === 'object' && 'ok' in result && result.ok === true) {
      return { handled: true, ok: true, summary: 'Generated transcript-timed captions deterministically.' };
    }
    return { handled: true, ok: false, summary: errorSummary(result) };
  }

  const splitEdit = SPLIT_EDIT_RE.exec(text);
  if (splitEdit) {
    const ids = selectedItemIds(ctx, options.references);
    if (ids.length !== 2) return { handled: false };
    const items = ids.map((id) => ctx.getState().items.find((item) => item.id === id)).filter(Boolean);
    if (items.length !== 2) return { handled: false };
    items.sort((left, right) => left!.startFrame - right!.startFrame);
    const args = {
      type: splitEdit[2]!.toLowerCase() === 'j' ? 'j-cut' : 'l-cut',
      outgoingId: items[0]!.id,
      incomingId: items[1]!.id,
      durationSeconds: splitEdit[1] ? Number(splitEdit[1]) : 0.5,
    };
    const planned = buildSplitEditPlan(args, ctx);
    if ('error' in planned) return { handled: true, ok: false, summary: planned.error };
    const result = execSplitEditTool('apply_split_edit', { ...args, planRef: planned.plan.planRef }, ctx);
    if (result && typeof result === 'object' && 'ok' in result && result.ok === true) {
      return { handled: true, ok: true, summary: `Applied a deterministic ${args.type} with a ${planned.plan.durationSeconds}-second audio ${args.type === 'j-cut' ? 'lead' : 'tail'}.` };
    }
    return { handled: true, ok: false, summary: errorSummary(result) };
  }

  return { handled: false };
}

export function isDeterministicCommandCandidate(text: string): boolean {
  return SPLIT_RE.test(text) || SILENCE_RE.test(text) || CAPTIONS_RE.test(text) || SPLIT_EDIT_RE.test(text);
}
