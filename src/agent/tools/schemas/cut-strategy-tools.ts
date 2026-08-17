import type { AgentToolSchema } from '../../tool-schema';

const OBSERVATION = {
  type: 'object', additionalProperties: false,
  properties: {
    outgoingId: { type: 'string', description: 'Outgoing video item at the existing picture boundary.' },
    incomingId: { type: 'string', description: 'Adjacent incoming video item at the existing picture boundary.' },
    audioMotivation: { type: 'string', enum: ['incoming', 'outgoing', 'none'], description: 'Whose audio meaningfully benefits from crossing the picture boundary.' },
    outgoingVisualUseful: { type: 'boolean', description: 'Whether the outgoing image remains useful while incoming audio begins.' },
    incomingVisualAddsContext: { type: 'boolean', description: 'Whether the incoming image adds context while outgoing audio continues.' },
    reactionValue: { type: 'number', minimum: 0, maximum: 10, description: 'Editorial value of seeing a listener/reaction across this boundary.' },
    lipSyncRisk: { type: 'number', minimum: 0, maximum: 10, description: 'Risk that an overlap exposes visibly mismatched spoken lips.' },
    visualMatch: { type: 'number', minimum: 0, maximum: 10, description: 'Verified similarity of motion, shape, framing, or action.' },
    pacing: { type: 'string', enum: ['quick', 'natural', 'deliberate'] },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence in these semantic/visual observations.' },
    rationale: { type: 'string', maxLength: 500, description: 'Short evidence-based editorial rationale.' },
    userRequestedDurationSeconds: { type: 'number', minimum: 0.1, maximum: 5, description: 'Only when the user explicitly requested an overlap duration.' },
  },
  required: ['outgoingId', 'incomingId', 'audioMotivation', 'outgoingVisualUseful', 'incomingVisualAddsContext', 'reactionValue', 'lipSyncRisk', 'visualMatch', 'pacing', 'confidence', 'rationale'],
} as const;

export const CUT_STRATEGY_TOOL_SCHEMAS: AgentToolSchema[] = [{
  name: 'configure_cut_strategy',
  description: 'Turn automatic semantic cut-strategy recommendations on or off on this device. Off is the default and leaves ordinary editing plus explicitly requested J/L cuts unchanged.',
  input_schema: {
    type: 'object', additionalProperties: false,
    properties: { enabled: { type: 'boolean' } },
    required: ['enabled'],
  },
}, {
  name: 'plan_cut_strategy',
  description: 'Turn AI semantic/visual observations at existing adjacent video boundaries into deterministic regular-cut, J-cut, L-cut, or match-cut recommendations. Regular cut is the fail-closed default. Validates timeline adjacency, confidence, lip-sync risk, and bounded durations; does not mutate the timeline.',
  input_schema: {
    type: 'object', additionalProperties: false,
    properties: { boundaries: { type: 'array', minItems: 1, maxItems: 50, items: OBSERVATION } },
    required: ['boundaries'],
  },
}];

export const CUT_STRATEGY_TOOL_NAMES = new Set(CUT_STRATEGY_TOOL_SCHEMAS.map((tool) => tool.name));
