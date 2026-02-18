import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { discoverBruFiles } from '../../src/discover.js';

test('discoverBruFiles recursively finds .bru files in stable sorted order', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-discover-'));
  await mkdir(path.join(root, 'a'));
  await mkdir(path.join(root, 'b'));
  await writeFile(path.join(root, 'b', 'z.bru'), 'z');
  await writeFile(path.join(root, 'a', 'x.bru'), 'x');
  await writeFile(path.join(root, 'a', 'ignore.txt'), 'ignored');

  const files = await discoverBruFiles(root);
  const rootReal = await realpath(root);
  const rel = files.map((f) => path.relative(rootReal, f).split(path.sep).join('/'));

  assert.deepEqual(rel, ['a/x.bru', 'b/z.bru']);
});

test('discoverBruFiles skips symlinks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-discover-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-outside-'));

  await writeFile(path.join(outside, 'outside.bru'), 'x');
  await symlink(path.join(outside, 'outside.bru'), path.join(root, 'linked.bru'));

  const files = await discoverBruFiles(root);
  assert.deepEqual(files, []);
});

test('discoverBruFiles excludes files under environments folder', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-discover-'));
  await mkdir(path.join(root, 'environments'));
  await mkdir(path.join(root, 'api'));
  await writeFile(path.join(root, 'environments', 'production.bru'), 'prod');
  await writeFile(path.join(root, 'environments', 'staging.bru'), 'staging');
  await writeFile(path.join(root, 'api', 'get-users.bru'), 'get users');

  const files = await discoverBruFiles(root);
  const rootReal = await realpath(root);
  const rel = files.map((f) => path.relative(rootReal, f).split(path.sep).join('/'));

  assert.deepEqual(rel, ['api/get-users.bru']);
});
