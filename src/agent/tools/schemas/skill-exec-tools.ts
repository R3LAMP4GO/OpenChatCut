import type { AgentToolSchema } from '../../tool-schema';

export const RUN_SKILL_SCRIPT_TOOL_NAMES = new Set(['run_skill_script']);

export const RUN_SKILL_SCRIPT_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    name: 'run_skill_script',
    description: 'Run a deterministic script inside an installed local skill. Prefer a workflow.json entrypoint with typed values; its binary/script are fixed and cannot be authored by the model. Legacy command remains only for external skills without a manifest. Execution uses an allowlisted binary, no shell, skill-locked cwd, a 120-second maximum timeout, and a 512 KB output cap.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        skill: { type: 'string', description: 'Installed skill slug returned by load_skill.' },
        entrypoint: { type: 'string', description: 'Preferred deterministic workflow.json entrypoint.' },
        values: { type: 'object', description: 'Typed argument values declared by the selected entrypoint.' },
        command: { type: 'string', description: 'Legacy compatibility command for an external skill without workflow.json.' },
        args: { type: 'array', maxItems: 100, items: { type: 'string' }, description: 'Legacy argv appended to command without a shell.' },
        timeout: { type: 'number', minimum: 1000, maximum: 120000, description: 'Optional timeout in milliseconds.' },
      },
      required: ['skill'],
      oneOf: [
        { required: ['entrypoint'] },
        { required: ['command'] },
      ],
    },
  },
];
