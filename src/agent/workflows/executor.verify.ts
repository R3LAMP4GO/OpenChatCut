import assert from 'node:assert/strict';
import type { AgentContext } from '../context';
import { executeDeterministicWorkflow } from './executor';
import type { DeterministicWorkflow } from './types';

type Input = { value: number };
type Plan = { doubled: number };
type Output = { committed: number };

let planCalls = 0;
let applyCalls = 0;
const workflow: DeterministicWorkflow<Input, Plan, Output> = {
  id: 'verify-workflow',
  description: 'Verify deterministic workflow phases.',
  inputSchema: { type: 'object' },
  maxPlanAttempts: 2,
  parseInput: (args) => typeof args.value === 'number' ? { value: args.value } : { error: 'value required' },
  plan: (input) => {
    planCalls += 1;
    return planCalls === 1 ? { error: 'transient snapshot', retryable: true } : { plan: { doubled: input.value * 2 } };
  },
  apply: (plan) => {
    applyCalls += 1;
    return { output: { committed: plan.doubled } };
  },
  accept: (output, plan) => output.committed === plan.doubled || 'commit mismatch',
};
const ctx = {} as AgentContext;

const bad = executeDeterministicWorkflow(workflow, {}, ctx, false);
assert.deepEqual(bad, { ok: false, workflow: 'verify-workflow', phase: 'input', error: 'value required', attempts: 0 });

const preview = executeDeterministicWorkflow(workflow, { value: 4 }, ctx, true);
assert.equal(preview.ok, true);
assert.equal(preview.phase, 'preview');
assert.equal(preview.attempts, 2);
assert.equal(applyCalls, 0, 'preview must not mutate');

planCalls = 0;
const applied = executeDeterministicWorkflow(workflow, { value: 5 }, ctx, false);
assert.equal(applied.ok, true);
assert.equal(applied.phase, 'applied');
assert.equal(applied.attempts, 2);
assert.equal(applyCalls, 1, 'apply runs once and is never retried');
if (applied.ok && applied.phase === 'applied') assert.equal(applied.output.committed, 10);

const rejecting: DeterministicWorkflow<Input, Plan, Output> = {
  ...workflow,
  id: 'rejecting-workflow',
  maxPlanAttempts: 1,
  plan: (input) => ({ plan: { doubled: input.value * 2 } }),
  apply: (plan) => ({ output: { committed: plan.doubled + 1 } }),
  accept: () => 'acceptance check failed',
};
const rejected = executeDeterministicWorkflow(rejecting, { value: 2 }, ctx, false);
assert.equal(rejected.ok, false);
assert.equal(rejected.phase, 'acceptance');

console.log('DETERMINISTIC_WORKFLOW_PASSED: bounded planning, preview isolation, single apply, acceptance checks');
