import type { AgentToolSchema } from '../../tool-schema';

const SCORE = { type: 'number', minimum: 0, maximum: 10 } as const;
const CANDIDATE = {
  type: 'object', additionalProperties: false,
  properties: {
    sourceItemId: { type: 'string', description: 'Exact transcribed source item ID.' },
    startWordIndex: { type: 'integer', minimum: 0 },
    endWordIndex: { type: 'integer', minimum: 0 },
    title: { type: 'string', maxLength: 100 },
    reason: { type: 'string', maxLength: 500 },
    scores: {
      type: 'object', additionalProperties: false,
      properties: {
        hookStrength: SCORE, curiosity: SCORE, contextCompleteness: SCORE, payoff: SCORE,
        specificity: SCORE, emotion: SCORE, visualSupport: SCORE,
        misleadingPenalty: SCORE, incompletePenalty: SCORE,
      },
      required: ['hookStrength', 'curiosity', 'contextCompleteness', 'payoff', 'specificity', 'emotion', 'visualSupport', 'misleadingPenalty', 'incompletePenalty'],
    },
  },
  required: ['sourceItemId', 'startWordIndex', 'endWordIndex', 'title', 'reason', 'scores'],
} as const;
const BASE = {
  preset: { type: 'string', enum: ['curiosity', 'contrarian', 'high-value', 'emotional', 'story', 'newsworthy'] },
  ratio: { type: 'string', enum: ['9:16', '16:9', '1:1', '4:3', '3:4'] },
  maxClips: { type: 'integer', minimum: 1, maximum: 10 },
  minSeconds: { type: 'number', minimum: 1, maximum: 180 },
  maxSeconds: { type: 'number', minimum: 1, maximum: 180 },
  candidates: { type: 'array', minItems: 1, maxItems: 30, items: CANDIDATE },
} as const;

export const SHORTFORM_CLIP_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    name: 'plan_shortform_clips',
    description: 'Validate and preview AI-selected short-form candidates without mutation. Deterministically snaps to transcript words, computes preset-weighted scores, penalizes misleading/incomplete excerpts, removes overlaps, enforces durations, and returns candidate IDs plus a stale-state planRef. This ranks candidates; it does not predict or guarantee virality.',
    input_schema: { type: 'object', additionalProperties: false, properties: BASE, required: ['preset', 'candidates'] },
  },
  {
    name: 'apply_shortform_clips',
    description: 'Atomically create only approved candidates from a fresh plan_shortform_clips preview. Duplicates the source timeline, trims to word timestamps, creates transcript captions, uses content-safe contain framing, preserves source references, and rejects stale plans. One call is one undoable project change.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        ...BASE,
        planRef: { type: 'string', description: 'Opaque planRef returned by plan_shortform_clips.' },
        approvedCandidateIds: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { type: 'string' } },
      },
      required: ['preset', 'candidates', 'planRef', 'approvedCandidateIds'],
    },
  },
];

export const SHORTFORM_CLIP_TOOL_NAMES = new Set(SHORTFORM_CLIP_TOOL_SCHEMAS.map((tool) => tool.name));
