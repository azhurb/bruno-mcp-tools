import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { AppError } from './errors.js';
import type { ToolTarget } from './naming.js';
import { runBrunoTool } from './runner.js';

const TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    vars: {
      type: 'object',
      additionalProperties: { type: 'string' }
    }
  },
  additionalProperties: false
} as const;

export function validateVars(input: unknown): Record<string, string> | undefined {
  if (input == null) {
    return undefined;
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('E_INPUT', 'Tool input must be an object.');
  }

  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  for (const key of keys) {
    if (key !== 'vars') {
      throw new AppError('E_INPUT', `Unsupported input key: ${key}. Only "vars" is allowed.`);
    }
  }

  if (obj.vars == null) {
    return undefined;
  }

  if (typeof obj.vars !== 'object' || Array.isArray(obj.vars)) {
    throw new AppError('E_INPUT', '"vars" must be an object of string values.');
  }

  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj.vars as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new AppError('E_INPUT', `vars.${key} must be a string.`);
    }
    vars[key] = value;
  }

  return vars;
}

export function resolveToolTarget(tools: Map<string, ToolTarget>, name: string): ToolTarget {
  const target = tools.get(name);
  if (!target) {
    throw new AppError('E_TOOL_NOT_FOUND', `Unknown tool: ${name}`);
  }
  return target;
}

export async function createAndRunMcpServer(params: {
  tools: Map<string, ToolTarget>;
  envName?: string;
  timeoutMs: number;
  bodyLimitBytes: number;
}): Promise<void> {
  const server = new Server(
    {
      name: 'bruno-mcp-server',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [...params.tools.values()].map((target) => ({
      name: target.toolName,
      description: `Execute Bruno request: ${target.requestPathNoExt}`,
      inputSchema: TOOL_INPUT_SCHEMA
    }));

    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const target = resolveToolTarget(params.tools, request.params.name);
      const vars = validateVars(request.params.arguments);
      const runOptions = {
        timeoutMs: params.timeoutMs,
        bodyLimitBytes: params.bodyLimitBytes
      };
      const runOptionsWithMaybe = {
        ...runOptions,
        ...(params.envName !== undefined ? { envName: params.envName } : {}),
        ...(vars !== undefined ? { vars } : {})
      };

      const text = await runBrunoTool(target, runOptionsWithMaybe);

      return {
        content: [
          {
            type: 'text',
            text
          }
        ]
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: message
          }
        ]
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
