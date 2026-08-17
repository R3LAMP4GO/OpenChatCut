import type { AgentToolSchema } from '../../tool-schema';

const BASE_PROPERTIES = {
  type: { type: 'string', enum: ['j-cut', 'l-cut'], description: 'j-cut: incoming audio leads picture. l-cut: outgoing audio continues after picture.' },
  outgoingId: { type: 'string', description: 'Outgoing video item ID.' },
  incomingId: { type: 'string', description: 'Incoming adjacent video item ID.' },
  durationSeconds: { type: 'number', minimum: 0.1, maximum: 5, description: 'Audio lead/tail duration in seconds; quantized to timeline frames.' },
  audioTrack: { type: 'string', description: 'Optional compatible audio track ID/alias. Defaults to the first unlocked non-overlapping audio track.' },
} as const;

export const SPLIT_EDIT_TOOL_NAMES = new Set(['plan_split_edit', 'apply_split_edit']);

export const SPLIT_EDIT_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    name: 'plan_split_edit',
    description: 'Build a deterministic, read-only J-cut or L-cut plan. Validates adjacency, source handles, track locks, audio overlap, source alignment, and duplicate-audio prevention. Returns planRef for apply_split_edit.',
    input_schema: {
      type: 'object', additionalProperties: false, properties: BASE_PROPERTIES,
      required: ['type', 'outgoingId', 'incomingId', 'durationSeconds'],
    },
  },
  {
    name: 'apply_split_edit',
    description: 'Recompute and atomically apply a deterministic J-cut or L-cut plan. Requires the fresh planRef from plan_split_edit and rejects stale timeline state.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: { ...BASE_PROPERTIES, planRef: { type: 'string', description: 'Opaque planRef returned by plan_split_edit.' } },
      required: ['type', 'outgoingId', 'incomingId', 'durationSeconds', 'planRef'],
    },
  },
];
