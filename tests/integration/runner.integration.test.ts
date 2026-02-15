import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runBrunoTool } from '../../src/runner.js';
import type { ToolTarget } from '../../src/naming.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_COLLECTION = path.resolve(HERE, '../fixtures/collection');

async function startMockServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end('missing url');
      return;
    }

    if (req.url.startsWith('/ok')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url.startsWith('/error')) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
      return;
    }

    if (req.url.startsWith('/delay')) {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ delayed: true }));
      }, 1500);
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve server address');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  };
}

async function setupFakeBruBin(baseUrl: string): Promise<{ binDir: string }> {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-bin-'));
  const bruPath = path.join(binDir, 'bru');

const script = `#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const envIndex = args.indexOf('--env');
const runTarget = args[1];

if (outputIndex < 0 || !runTarget) {
  console.error('missing required args');
  process.exit(2);
}

const outputPath = args[outputIndex + 1];
const requestId = path.basename(runTarget, '.bru');
const envName = envIndex >= 0 ? args[envIndex + 1] : '';
const envVarArgs = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--env-var' && args[i + 1]) {
    envVarArgs.push(args[i + 1]);
    i += 1;
  }
}

if (requestId === 'exit_non_zero') {
  console.error('simulated failure');
  process.exit(9);
}

const urlPath = requestId.includes('/') ? '/' + requestId.split('/').pop() : '/' + requestId;
const url = '${baseUrl}' + urlPath;

http.get(url, (res) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const report = {
      results: [
        {
          response: {
            statusCode: res.statusCode,
            headers: res.headers,
            body: [
              body,
              envName ? ' env=' + envName : '',
              envVarArgs.length > 0 ? ' vars=' + envVarArgs.join(',') : ''
            ].join('')
          }
        }
      ]
    };
    fs.writeFileSync(outputPath, JSON.stringify(report), 'utf8');
    process.exit(0);
  });
}).on('error', (err) => {
  console.error(String(err));
  process.exit(3);
});
`;

  await writeFile(bruPath, script, 'utf8');
  await chmod(bruPath, 0o755);

  return { binDir };
}

function makeTarget(request: string, requiresEnv = false): ToolTarget {
  const bruFileAbs = path.join(FIXTURE_COLLECTION, `${request}.bru`);
  return {
    toolName: `billing.${request.replace('/', '.')}`,
    bruFileAbs,
    collectionRootAbs: FIXTURE_COLLECTION,
    requestPathNoExt: request,
    requiresEnv,
    templateVars: requiresEnv ? ['query'] : []
  };
}

test('runBrunoTool succeeds and formats parsed response', async () => {
  const server = await startMockServer();
  const { binDir } = await setupFakeBruBin(server.baseUrl);
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath || ''}`;

  try {
    const out = await runBrunoTool(makeTarget('auth/ok'), {
      timeoutMs: 2_000,
      bodyLimitBytes: 65_536,
      vars: { token: 'abc' }
    });

    assert.match(out, /Status: 200/);
    assert.match(out, /Headers:/);
    assert.match(out, /Body:/);
    assert.match(out, /"ok":true/);
    assert.match(out, /vars=token=abc/);
  } finally {
    process.env.PATH = originalPath;
    await server.close();
  }
});

test('runBrunoTool surfaces non-zero Bruno exits', async () => {
  const server = await startMockServer();
  const { binDir } = await setupFakeBruBin(server.baseUrl);
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath || ''}`;

  try {
    await assert.rejects(
      () =>
        runBrunoTool(makeTarget('exit_non_zero'), {
          timeoutMs: 2_000,
          bodyLimitBytes: 65_536
        }),
      /E_BRU_EXIT/
    );
  } finally {
    process.env.PATH = originalPath;
    await server.close();
  }
});

test('runBrunoTool handles 500 responses and env pass-through', async () => {
  const server = await startMockServer();
  const { binDir } = await setupFakeBruBin(server.baseUrl);
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath || ''}`;

  try {
    const out = await runBrunoTool(makeTarget('auth/error'), {
      envName: 'dev',
      timeoutMs: 2_000,
      bodyLimitBytes: 65_536
    });

    assert.match(out, /Status: 500/);
    assert.match(out, /env=dev/);
  } finally {
    process.env.PATH = originalPath;
    await server.close();
  }
});

test('runBrunoTool times out long requests', async () => {
  const server = await startMockServer();
  const { binDir } = await setupFakeBruBin(server.baseUrl);
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath || ''}`;

  try {
    await assert.rejects(
      () =>
        runBrunoTool(makeTarget('invoices/delay'), {
          timeoutMs: 200,
          bodyLimitBytes: 65_536
        }),
      /E_TIMEOUT/
    );
  } finally {
    process.env.PATH = originalPath;
    await server.close();
  }
});

test('runBrunoTool fails when request requires env and --env is missing', async () => {
  await assert.rejects(
    () =>
      runBrunoTool(makeTarget('auth/ok', true), {
        timeoutMs: 200,
        bodyLimitBytes: 65_536
      }),
    /E_ENV_REQUIRED/
  );
});

test('runBrunoTool allows vars-only execution for template vars without --env', async () => {
  const server = await startMockServer();
  const { binDir } = await setupFakeBruBin(server.baseUrl);
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath || ''}`;

  try {
    const out = await runBrunoTool(makeTarget('auth/ok', true), {
      timeoutMs: 2_000,
      bodyLimitBytes: 65_536,
      vars: { query: 'air' }
    });

    assert.match(out, /Status: 200/);
  } finally {
    process.env.PATH = originalPath;
    await server.close();
  }
});
