import type { AgentContext } from '../context';
import type { AgentToolSchema } from '../tool-schema';

export type WorkflowError = {
  readonly error: string;
  readonly retryable?: boolean;
};

export type WorkflowPlanResult<PLAN> = { readonly plan: PLAN } | WorkflowError;
export type WorkflowApplyResult<OUTPUT> = { readonly output: OUTPUT } | WorkflowError;

export interface DeterministicWorkflow<INPUT extends object, PLAN, OUTPUT> {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: AgentToolSchema['input_schema'];
  readonly maxPlanAttempts?: number;
  parseInput(args: Record<string, unknown>): INPUT | WorkflowError;
  plan(input: INPUT, ctx: AgentContext): WorkflowPlanResult<PLAN>;
  apply(plan: PLAN, ctx: AgentContext): WorkflowApplyResult<OUTPUT>;
  accept?(output: OUTPUT, plan: PLAN, ctx: AgentContext): true | string;
}

export type WorkflowExecution<PLAN, OUTPUT> =
  | { readonly ok: true; readonly workflow: string; readonly phase: 'preview'; readonly plan: PLAN; readonly attempts: number }
  | { readonly ok: true; readonly workflow: string; readonly phase: 'applied'; readonly plan: PLAN; readonly output: OUTPUT; readonly attempts: number }
  | { readonly ok: false; readonly workflow: string; readonly phase: 'input' | 'plan' | 'apply' | 'acceptance'; readonly error: string; readonly attempts: number };
