import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { AppError, assert } from './errors.js';

export type ServerConfig = {
  mode: 'single' | 'collection';
  bruFileAbs?: string;
  collectionRootAbs: string;
  envName?: string;
  prefixArg?: string;
  nameArg?: string;
  timeoutMs: number;
  bodyLimitBytes: number;
};

type RawArgs = {
  bru?: string;
  collection?: string;
  env?: string;
  prefix?: string;
  name?: string;
};

function parseRawArgs(argv: string[]): RawArgs {
  const raw: RawArgs = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--bru':
        assert(next, 'E_ARGS', 'Missing value for --bru');
        raw.bru = next;
        i += 1;
        break;
      case '--collection':
        assert(next, 'E_ARGS', 'Missing value for --collection');
        raw.collection = next;
        i += 1;
        break;
      case '--env':
        assert(next, 'E_ARGS', 'Missing value for --env');
        raw.env = next;
        i += 1;
        break;
      case '--prefix':
        assert(next, 'E_ARGS', 'Missing value for --prefix');
        raw.prefix = next;
        i += 1;
        break;
      case '--name':
        assert(next, 'E_ARGS', 'Missing value for --name');
        raw.name = next;
        i += 1;
        break;
      default:
        throw new AppError('E_ARGS', `Unknown argument: ${arg}`);
    }
  }

  return raw;
}

async function resolveReadablePath(inputPath: string, expected: 'file' | 'dir'): Promise<string> {
  const rawSegments = inputPath.split(/[\\/]+/).filter(Boolean);
  assert(
    !rawSegments.includes('..'),
    'E_ARGS',
    `Path traversal tokens are not allowed in input path: ${inputPath}`
  );

  const abs = path.resolve(inputPath);
  let real: string;
  try {
    real = await realpath(abs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError('E_ARGS', `Path not found or not accessible: ${inputPath}. ${message}`);
  }

  let details: Awaited<ReturnType<typeof stat>>;
  try {
    details = await stat(real);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError('E_ARGS', `Unable to stat path: ${inputPath}. ${message}`);
  }

  if (expected === 'file') {
    assert(details.isFile(), 'E_ARGS', `Expected a file path but found: ${inputPath}`);
  }

  if (expected === 'dir') {
    assert(details.isDirectory(), 'E_ARGS', `Expected a directory path but found: ${inputPath}`);
  }

  try {
    await access(real, constants.R_OK);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError('E_ARGS', `Path is not readable: ${inputPath}. ${message}`);
  }
  return real;
}

async function resolveCollectionRoot(startAbs: string): Promise<string> {
  let current = startAbs;

  while (true) {
    const marker = path.join(current, 'bruno.json');
    try {
      const markerStat = await stat(marker);
      if (markerStat.isFile()) {
        await access(marker, constants.R_OK);
        return current;
      }
    } catch {
      // continue walking up
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new AppError(
    'E_ARGS',
    `Collection root not found. Expected a readable bruno.json in ${startAbs} or its parents.`
  );
}

export async function parseAndValidateArgs(argv: string[]): Promise<ServerConfig> {
  const raw = parseRawArgs(argv);
  const hasBru = Boolean(raw.bru);
  const hasCollection = Boolean(raw.collection);

  assert(
    hasBru !== hasCollection,
    'E_ARGS',
    'Provide exactly one of --bru <path> or --collection <path>.'
  );

  if (hasBru) {
    const bruPath = raw.bru;
    assert(bruPath, 'E_ARGS', 'Missing --bru value.');
    assert(bruPath.endsWith('.bru'), 'E_ARGS', '--bru must point to a .bru file.');
    const bruFileAbs = await resolveReadablePath(bruPath, 'file');
    const collectionRootAbs = await resolveCollectionRoot(path.dirname(bruFileAbs));

    const config: ServerConfig = {
      mode: 'single',
      bruFileAbs,
      collectionRootAbs,
      timeoutMs: 30_000,
      bodyLimitBytes: 65_536
    };
    if (raw.env !== undefined) config.envName = raw.env;
    if (raw.prefix !== undefined) config.prefixArg = raw.prefix;
    if (raw.name !== undefined) config.nameArg = raw.name;
    return config;
  }

  const collectionPath = raw.collection;
  assert(collectionPath, 'E_ARGS', 'Missing --collection value.');
  const collectionRootAbs = await resolveReadablePath(collectionPath, 'dir');
  await resolveCollectionRoot(collectionRootAbs);

  const config: ServerConfig = {
    mode: 'collection',
    collectionRootAbs,
    timeoutMs: 30_000,
    bodyLimitBytes: 65_536
  };
  if (raw.env !== undefined) config.envName = raw.env;
  if (raw.prefix !== undefined) config.prefixArg = raw.prefix;
  if (raw.name !== undefined) config.nameArg = raw.name;
  return config;
}
