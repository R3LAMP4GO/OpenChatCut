import type { AgentContext } from '../context';
import type { DeterministicWorkflow, WorkflowExecution, WorkflowPlanResult } from './types';

const MAX_PLAN_ATTEMPTS = 3;

function planAttempts(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_PLAN_ATTEMPTS, Math.round(value!)));
}

export function executeDeterministicWorkflow<INPUT extends object, PLAN, OUTPUT>(
  workflow: DeterministicWorkflow<INPUT, PLAN, OUTPUT>,
  args: Record<string, unknown>,
  ctx: AgentContext,
  preview: boolean,
): WorkflowExecution<PLAN, OUTPUT> {
  const input = workflow.parseInput(args);
  if ('error' in input) {
    return { ok: false, workflow: workflow.id, phase: 'input', error: input.error, attempts: 0 };
  }

  const limit = planAttempts(workflow.maxPlanAttempts);
  let planned: WorkflowPlanResult<PLAN> = { error: 'workflow did not produce a plan' };
  let attempts = 0;
  while (attempts < limit) {
    attempts += 1;
    planned = workflow.plan(input, ctx);
    if ('plan' in planned || !planned.retryable) break;
  }
  if ('error' in planned) {
    return { ok: false, workflow: workflow.id, phase: 'plan', error: planned.error, attempts };
  }
  if (preview) {
    return { ok: true, workflow: workflow.id, phase: 'preview', plan: planned.plan, attempts };
  }

  const applied = workflow.apply(planned.plan, ctx);
  if ('error' in applied) {
    return { ok: false, workflow: workflow.id, phase: 'apply', error: applied.error, attempts };
  }
  const accepted = workflow.accept?.(applied.output, planned.plan, ctx) ?? true;
  if (accepted !== true) {
    return { ok: false, workflow: workflow.id, phase: 'acceptance', error: accepted, attempts };
  }
  return {
    ok: true,
    workflow: workflow.id,
    phase: 'applied',
    plan: planned.plan,
    output: applied.output,
    attempts,
  };
}
