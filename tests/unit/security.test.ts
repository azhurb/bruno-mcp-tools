import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildCollectionToolMap } from '../../src/naming.js';
import { resolveToolTarget, validateVars } from '../../src/mcp.js';
import type { ToolTarget } from '../../src/naming.js';

test('resolveToolTarget rejects unknown tool names', () => {
  const known = new Map<string, ToolTarget>([
    [
      'billing_auth_login',
      {
        toolName: 'billing_auth_login',
        bruFileAbs: '/tmp/x.bru',
        collectionRootAbs: '/tmp',
        requestPathNoExt: 'x',
        requiresEnv: false,
        templateVars: []
      }
    ]
  ]);

  assert.throws(() => resolveToolTarget(known, 'billing_auth_missing'), /E_TOOL_NOT_FOUND/);
});

test('validateVars enforces object<string,string> only', () => {
  assert.throws(() => validateVars({ bad: 'x' }), /Unsupported input key/);
  assert.throws(() => validateVars({ vars: { n: 1 } }), /must be a string/);
  assert.deepEqual(validateVars({ vars: { token: 'abc' } }), { token: 'abc' });
});

test('buildCollectionToolMap blocks traversal outside collection root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-security-root-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-security-outside-'));
  const outsideBru = path.join(outside, 'escape.bru');
  await writeFile(outsideBru, 'meta {}');

  await assert.rejects(
    () =>
      buildCollectionToolMap({
        bruFilesAbs: [outsideBru],
        collectionRootAbs: root,
        prefix: 'billing'
      }),
    /E_DISCOVERY/
  );
});
