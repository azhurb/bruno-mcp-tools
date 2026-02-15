import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildCollectionToolMap,
  buildToolNameFromRelativePath,
  derivePrefix,
  sanitizeSegment,
  validateToolName
} from '../../src/naming.js';

test('sanitizeSegment and derivePrefix apply deterministic sanitization', async () => {
  assert.equal(sanitizeSegment('Billing API'), 'billing_api');

  const root = await mkdtemp(path.join(os.tmpdir(), 'Billing API__'));
  assert.match(derivePrefix(undefined, root), /^billing_api/);
  assert.equal(derivePrefix('Team-1', root), 'team_1');
});

test('buildToolNameFromRelativePath produces stable collection name', async () => {
  const name = buildToolNameFromRelativePath('billing', 'auth/login.bru');
  assert.equal(name, 'billing_auth_login');
});

test('validateToolName rejects invalid names', () => {
  assert.throws(() => validateToolName('Bad.Name'), /E_ARGS/);
  assert.throws(() => validateToolName('bad__name!'), /E_ARGS/);
});

test('buildCollectionToolMap detects collisions after sanitization', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-name-'));
  await mkdir(path.join(root, 'auth'));
  await writeFile(path.join(root, 'auth', 'login-1.bru'), 'meta {}');
  await writeFile(path.join(root, 'auth', 'login_1.bru'), 'meta {}');

  await assert.rejects(
    () =>
      buildCollectionToolMap({
        bruFilesAbs: [
          path.join(root, 'auth', 'login-1.bru'),
          path.join(root, 'auth', 'login_1.bru')
        ],
        collectionRootAbs: root,
        prefix: 'billing'
      }),
    /collision/
  );
});

test('buildCollectionToolMap excludes collection.bru', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bruno-mcp-name-'));
  await mkdir(path.join(root, 'auth'));
  await writeFile(path.join(root, 'collection.bru'), 'meta {}');
  await writeFile(path.join(root, 'auth', 'get-breeds.bru'), 'meta {}');

  const map = await buildCollectionToolMap({
    bruFilesAbs: [path.join(root, 'collection.bru'), path.join(root, 'auth', 'get-breeds.bru')],
    collectionRootAbs: root,
    prefix: 'the_cat_api'
  });

  assert.equal(map.has('the_cat_api.collection'), false);
  assert.equal(map.has('the_cat_api_auth_get_breeds'), true);
});
