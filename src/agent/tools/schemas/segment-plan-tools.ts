import type { AgentToolSchema } from '../../tool-schema';

export const SEGMENT_PLAN_TOOL_NAMES = new Set(['read_segment_plan', 'apply_segment_plan']);

export const SEGMENT_PLAN_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    name: 'read_segment_plan',
    description: 'Read sentence-bound transcript segments with stable composite IDs and a revision. Use these IDs for bounded semantic decisions; timing remains deterministic. Results are paged.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        track: { type: 'string', description: 'Optional transcript track ID/alias. Defaults to the first track containing a current transcript.' },
        offset: { type: 'integer', minimum: 0, description: 'Segment offset. Default 0.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum segments. Default 100, max 200.' },
      },
    },
  },
  {
    name: 'apply_segment_plan',
    description: 'Deterministically apply a bounded semantic segment decision as one undoable batch. Validates revision, stable IDs, whole-sentence boundaries, duplicates, ordering, and track safety.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        track: { type: 'string', description: 'Transcript track ID/alias used for read_segment_plan.' },
        revision: { type: 'string', description: 'Exact revision returned by read_segment_plan.' },
        keepSegmentIds: { type: 'array', minItems: 1, maxItems: 500, uniqueItems: true, items: { type: 'string' }, description: 'Stable segment IDs to retain.' },
        order: { type: 'array', minItems: 1, maxItems: 500, uniqueItems: true, items: { type: 'string' }, description: 'Optional exact permutation of keepSegmentIds.' },
        preview: { type: 'boolean', description: 'When true, validate and return the deterministic action summary without mutation.' },
      },
      required: ['revision', 'keepSegmentIds'],
    },
  },
];
