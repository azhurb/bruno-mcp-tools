import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseAndValidateArgs } from '../../src/args.js';

test('parseAndValidateArgs enforces --bru xor --collection', async () => {
  await assert.rejects(() => parseAndValidateArgs([]), /E_ARGS/);

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-args-'));
  const collection = path.join(tmp, 'collection');
  const bru = path.join(tmp, 'req.bru');

  await mkdir(collection);
  await writeFile(bru, 'meta {}');

  await assert.rejects(
    () => parseAndValidateArgs(['--bru', bru, '--collection', collection]),
    /E_ARGS/
  );
});

test('parseAndValidateArgs validates --bru type and extension', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-args-'));
  const nonBru = path.join(tmp, 'req.txt');
  await writeFile(nonBru, 'x');

  await assert.rejects(() => parseAndValidateArgs(['--bru', nonBru]), /must point to a \.bru file/);
});

test('parseAndValidateArgs validates --collection directory', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-args-'));
  const filePath = path.join(tmp, 'file.bru');
  await writeFile(filePath, 'x');

  await assert.rejects(() => parseAndValidateArgs(['--collection', filePath]), /Expected a directory/);
});

test('parseAndValidateArgs parses valid single mode', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-args-'));
  const bru = path.join(tmp, 'login.bru');
  const brunoJson = path.join(tmp, 'bruno.json');
  await writeFile(bru, 'x');
  await writeFile(brunoJson, '{}');

  const parsed = await parseAndValidateArgs(['--bru', bru, '--env', 'dev', '--prefix', 'billing']);

  assert.equal(parsed.mode, 'single');
  const bruReal = await realpath(path.resolve(bru));
  assert.equal(parsed.bruFileAbs, bruReal);
  assert.equal(parsed.collectionRootAbs, path.dirname(bruReal));
  assert.equal(parsed.envName, 'dev');
  assert.equal(parsed.prefixArg, 'billing');
});

test('parseAndValidateArgs rejects traversal style paths', async () => {
  await assert.rejects(
    () => parseAndValidateArgs(['--collection', '../somewhere']),
    /Path traversal tokens are not allowed/
  );
});
