#!/usr/bin/env node

import { parseAndValidateArgs } from './args.js';
import { discoverBruFiles } from './discover.js';
import { AppError, assert } from './errors.js';
import {
  buildCollectionToolMap,
  buildSingleToolMap,
  derivePrefix
} from './naming.js';
import { createAndRunMcpServer } from './mcp.js';

async function main(): Promise<void> {
  const config = await parseAndValidateArgs(process.argv.slice(2));
  const prefix = derivePrefix(config.prefixArg, config.collectionRootAbs);

  if (config.mode === 'single') {
    assert(config.bruFileAbs, 'E_ARGS', 'Single mode requires a resolved --bru path.');
    const tools = await buildSingleToolMap({
      bruFileAbs: config.bruFileAbs,
      collectionRootAbs: config.collectionRootAbs,
      prefix,
      ...(config.nameArg !== undefined ? { nameOverride: config.nameArg } : {})
    });

    const serverParams = {
      tools,
      timeoutMs: config.timeoutMs,
      bodyLimitBytes: config.bodyLimitBytes
    };
    await createAndRunMcpServer(
      config.envName !== undefined ? { ...serverParams, envName: config.envName } : serverParams
    );
    return;
  }

  const bruFiles = await discoverBruFiles(config.collectionRootAbs);
  assert(bruFiles.length > 0, 'E_DISCOVERY', 'No .bru files were found in the collection path.');
  const tools = await buildCollectionToolMap({
    bruFilesAbs: bruFiles,
    collectionRootAbs: config.collectionRootAbs,
    prefix
  });

  const serverParams = {
    tools,
    timeoutMs: config.timeoutMs,
    bodyLimitBytes: config.bodyLimitBytes
  };
  await createAndRunMcpServer(
    config.envName !== undefined ? { ...serverParams, envName: config.envName } : serverParams
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof AppError) {
    console.error(message);
  } else {
    console.error(`[E_UNKNOWN] ${message}`);
  }
  process.exitCode = 1;
});
