export { CUT_STRATEGY_TOOL_NAMES, CUT_STRATEGY_TOOL_SCHEMAS } from './schemas/cut-strategy-tools';
import type { AgentContext } from '../context';
import { trackKind } from '../../editor/types';
import { cutStrategyEnabled, setCutStrategyEnabled } from '../cutStrategyPreference';

type Args = Record<string, unknown>;
type CutType = 'regular-cut' | 'j-cut' | 'l-cut' | 'match-cut';
type Pacing = 'quick' | 'natural' | 'deliberate';
const PACING_SECONDS: Record<Pacing, number> = { quick: 0.3, natural: 0.5, deliberate: 1 };
function numberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function nonEmpty(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}
function regular(reason: string): { type: CutType; durationSeconds: null; reason: string } {
  return { type: 'regular-cut', durationSeconds: null, reason };
}

export function planCutStrategy(args: Args, ctx: Pick<AgentContext, 'getState'>): unknown {
  if (!cutStrategyEnabled()) return { ok: false, enabled: false, error: 'Automatic cut strategy is off. Use configure_cut_strategy with enabled=true to turn it on.' };
  if (!Array.isArray(args.boundaries) || args.boundaries.length < 1 || args.boundaries.length > 50) return { error: 'boundaries must contain 1 to 50 observations' };
  const state = ctx.getState();
  const seen = new Set<string>();
  const recommendations = [];
  for (let index = 0; index < args.boundaries.length; index += 1) {
    const raw = args.boundaries[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `boundary ${index} must be an object` };
    const observation = raw as Record<string, unknown>;
    if (!nonEmpty(observation.outgoingId, 160) || !nonEmpty(observation.incomingId, 160)) return { error: `boundary ${index} has invalid item IDs` };
    const outgoing = state.items.find((item) => item.id === observation.outgoingId);
    const incoming = state.items.find((item) => item.id === observation.incomingId);
    if (!outgoing || !incoming || outgoing.kind !== 'video' || incoming.kind !== 'video') return { error: `boundary ${index} must reference two existing video items` };
    if (outgoing.track !== incoming.track || trackKind(state, outgoing.track) !== 'video'
      || outgoing.startFrame + outgoing.durationInFrames !== incoming.startFrame) return { error: `boundary ${index} items must be adjacent on the same video track` };
    const boundaryId = `${outgoing.id}>${incoming.id}`;
    if (seen.has(boundaryId)) return { error: `duplicate boundary ${boundaryId}` };
    seen.add(boundaryId);
    const audioMotivation = observation.audioMotivation;
    const pacing = observation.pacing;
    if (!['incoming', 'outgoing', 'none'].includes(String(audioMotivation)) || !['quick', 'natural', 'deliberate'].includes(String(pacing))) return { error: `boundary ${index} has an invalid motivation or pacing` };
    if (typeof observation.outgoingVisualUseful !== 'boolean' || typeof observation.incomingVisualAddsContext !== 'boolean'
      || !numberIn(observation.reactionValue, 0, 10) || !numberIn(observation.lipSyncRisk, 0, 10)
      || !numberIn(observation.visualMatch, 0, 10) || !numberIn(observation.confidence, 0, 1)
      || !nonEmpty(observation.rationale, 500)) return { error: `boundary ${index} has invalid semantic evidence` };
    const explicit = observation.userRequestedDurationSeconds;
    if (explicit !== undefined && !numberIn(explicit, 0.1, 5)) return { error: `boundary ${index} has an invalid explicit duration` };
    const durationSeconds = explicit ?? PACING_SECONDS[pacing as Pacing];
    let decision: { type: CutType; durationSeconds: number | null; reason: string };
    if (observation.confidence < 0.75) decision = regular('Low-confidence evidence; regular cut is the fail-closed default.');
    else if (observation.lipSyncRisk >= 7) decision = regular('High lip-sync risk makes an audio overlap unsafe.');
    else if (observation.visualMatch >= 8 && audioMotivation === 'none') decision = { type: 'match-cut', durationSeconds: null, reason: 'Verified motion/shape/framing similarity supports a visual match cut.' };
    else if (audioMotivation === 'incoming' && observation.outgoingVisualUseful) decision = { type: 'j-cut', durationSeconds, reason: 'Incoming audio motivates the transition while the outgoing image remains useful.' };
    else if (audioMotivation === 'outgoing' && (observation.incomingVisualAddsContext || observation.reactionValue >= 6)) decision = { type: 'l-cut', durationSeconds, reason: 'Outgoing audio remains useful while the incoming image adds context or reaction value.' };
    else decision = regular('No strong cross-boundary audio or visual benefit was established.');
    recommendations.push({
      boundaryId, outgoingId: outgoing.id, incomingId: incoming.id,
      ...decision, pacing, confidence: observation.confidence,
      autoApplyEligible: decision.type !== 'regular-cut' && observation.confidence >= 0.9 && observation.lipSyncRisk <= 3,
      evidence: observation.rationale.trim(),
      nextTool: decision.type === 'j-cut' || decision.type === 'l-cut' ? 'plan_split_edit' : null,
    });
  }
  return { ok: true, enabled: true, mutated: false, recommendations };
}

export { cutStrategyEnabled, setCutStrategyEnabled };

export async function execCutStrategyTool(name: string, args: Args, ctx: AgentContext): Promise<unknown> {
  if (name === 'configure_cut_strategy') {
    if (typeof args.enabled !== 'boolean') return { error: 'enabled must be boolean' };
    setCutStrategyEnabled(args.enabled);
    return { ok: true, enabled: args.enabled, message: `Automatic cut strategy is ${args.enabled ? 'on' : 'off'}.` };
  }
  if (name === 'plan_cut_strategy') return planCutStrategy(args, ctx);
  return { error: `unknown cut strategy tool: ${name}` };
}
