import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { AppError, assert } from './errors.js';
import type { ToolTarget } from './naming.js';

export type RunnerOptions = {
  envName?: string;
  timeoutMs: number;
  bodyLimitBytes: number;
  vars?: Record<string, string>;
};

type BrunoReportView = {
  statusCode: number;
  headers: Record<string, string>;
  bodyText: string;
};

function toHeaders(input: unknown): Record<string, string> {
  if (Array.isArray(input)) {
    const out: Record<string, string> = {};
    for (const item of input) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const name = (item as { name?: unknown }).name;
      const value = (item as { value?: unknown }).value;
      if (typeof name === 'string') {
        out[name] = value == null ? '' : String(value);
      }
    }
    return out;
  }

  if (input && typeof input === 'object') {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = v == null ? '' : String(v);
    }
    return out;
  }

  return {};
}

function toBodyText(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input == null) {
    return '';
  }
  if (typeof input === 'number' || typeof input === 'boolean') {
    return String(input);
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function extractReportView(report: unknown): BrunoReportView {
  const reportRoot = Array.isArray(report) ? report[0] : report;
  const r = (reportRoot ?? {}) as Record<string, unknown>;
  const nestedResults = Array.isArray(r.results) ? r.results : undefined;
  const firstResult = nestedResults && nestedResults.length > 0 ? nestedResults[0] : undefined;
  const firstObject =
    firstResult && typeof firstResult === 'object'
      ? (firstResult as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const response =
    firstObject.response && typeof firstObject.response === 'object'
      ? (firstObject.response as Record<string, unknown>)
      : undefined;

  const statusSource = response ?? firstObject;
  const statusCandidate = statusSource.statusCode ?? statusSource.status ?? r.statusCode ?? r.status;
  const statusCode = typeof statusCandidate === 'number' ? statusCandidate : Number(statusCandidate);

  assert(Number.isFinite(statusCode), 'E_REPORT', 'Unable to parse response status from Bruno JSON report.');

  const headers = toHeaders(response?.headers ?? firstObject.headers ?? r.headers);
  const bodyText = toBodyText(
    response?.body ?? response?.data ?? firstObject.body ?? firstObject.data ?? r.body ?? r.data
  );

  return { statusCode, headers, bodyText };
}

export function formatToolOutput(view: BrunoReportView, bodyLimitBytes: number): string {
  let body = view.bodyText;
  const bodyBytes = Buffer.byteLength(body, 'utf8');

  if (bodyBytes > bodyLimitBytes) {
    const limited = Buffer.from(body, 'utf8').subarray(0, bodyLimitBytes).toString('utf8');
    body = `${limited}\n[truncated to ${bodyLimitBytes} bytes]`;
  }

  return `Status: ${view.statusCode}\n\nHeaders:\n${JSON.stringify(view.headers, null, 2)}\n\nBody:\n${body}`;
}

function sanitizeEnvVarName(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function buildVarsPassThrough(vars: Record<string, string> | undefined): {
  envMap: Record<string, string>;
  envVarArgs: string[];
} {
  if (!vars) {
    return { envMap: {}, envVarArgs: [] };
  }

  const envMap: Record<string, string> = {};
  const seen = new Set<string>();
  const envVarArgs: string[] = [];

  for (const [key, value] of Object.entries(vars)) {
    assert(key.length > 0, 'E_VARS', 'Vars key cannot be empty.');
    assert(!key.includes('='), 'E_VARS', `Invalid vars key (must not include '='): ${key}`);

    // Keep backward compatibility for requests/scripts that read process env.
    const normalized = sanitizeEnvVarName(key);
    assert(normalized.length > 0, 'E_VARS', `Invalid vars key: ${key}`);
    const envKey = `MCP_VAR_${normalized}`;
    if (seen.has(envKey)) {
      throw new AppError('E_VARS', `Vars key collision after normalization: ${key}`);
    }
    seen.add(envKey);
    envMap[envKey] = value;

    // Bruno v3-compatible dynamic variable override for {{var}} placeholders.
    envVarArgs.push('--env-var', `${key}=${value}`);
  }

  return { envMap, envVarArgs };
}

export async function runBrunoTool(target: ToolTarget, options: RunnerOptions): Promise<string> {
  if (target.requiresEnv && !options.envName) {
    const providedVars = new Set(Object.keys(options.vars ?? {}));
    const missingVars = target.templateVars.filter((name) => !providedVars.has(name));
    if (missingVars.length > 0) {
      throw new AppError(
        'E_ENV_REQUIRED',
        `Request ${target.toolName} references template variables (${missingVars.join(', ')}). Provide --env <name> or pass all missing values via vars.`
      );
    }
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-'));
  const reportPath = path.join(tmpDir, `${randomUUID()}.json`);
  const requestBruPath = `${target.requestPathNoExt}.bru`;
  const args = ['run', requestBruPath];
  const { envMap, envVarArgs } = buildVarsPassThrough(options.vars);

  if (options.envName) {
    args.push('--env', options.envName);
  }

  args.push(...envVarArgs);
  args.push('--output', reportPath, '--format', 'json');

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...envMap
  };

  const runResult = await new Promise<{ code: number | null; stderr: string; timedOut: boolean }>(
    (resolve, reject) => {
      let stderr = '';
      let timedOut = false;
      const child = spawn('bru', args, {
        cwd: target.collectionRootAbs,
        env: childEnv,
        stdio: ['ignore', 'ignore', 'pipe']
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        reject(new AppError('E_RUNNER', `Failed to spawn Bruno CLI: ${err.message}`));
      });

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
      }, options.timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeoutHandle);
        resolve({ code, stderr, timedOut });
      });
    }
  );

  if (runResult.timedOut) {
    throw new AppError('E_TIMEOUT', `Bruno request timed out after ${options.timeoutMs}ms.`);
  }

  if (runResult.code !== 0) {
    const stderrTail = runResult.stderr.trim().split('\n').slice(-10).join('\n');
    throw new AppError(
      'E_BRU_EXIT',
      `Bruno CLI exited with code ${runResult.code}. ${stderrTail || 'No stderr output.'}`
    );
  }

  let reportRaw: string;
  try {
    reportRaw = await fs.readFile(reportPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError('E_REPORT', `Bruno JSON report not found at ${reportPath}: ${message}`);
  }

  let report: unknown;
  try {
    report = JSON.parse(reportRaw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError('E_REPORT', `Bruno JSON report is invalid: ${message}`);
  }

  const view = extractReportView(report);
  return formatToolOutput(view, options.bodyLimitBytes);
}
