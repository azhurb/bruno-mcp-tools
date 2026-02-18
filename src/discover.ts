import { promises as fs } from 'node:fs';
import path from 'node:path';

import { AppError } from './errors.js';

export async function discoverBruFiles(rootAbs: string): Promise<string[]> {
  const rootRealAbs = await fs.realpath(rootAbs);
  const results: string[] = [];

  async function walk(currentAbs: string): Promise<void> {
    const entries = await fs.readdir(currentAbs, { withFileTypes: true });

    for (const entry of entries) {
      const entryAbs = path.join(currentAbs, entry.name);

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === 'environments') {
          continue;
        }
        await walk(entryAbs);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (entry.name.endsWith('.bru')) {
        const realAbs = await fs.realpath(entryAbs);
        const rel = path.relative(rootRealAbs, realAbs);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new AppError('E_DISCOVERY', `Path traversal blocked for discovered file: ${entryAbs}`);
        }
        results.push(realAbs);
      }
    }
  }

  await walk(rootRealAbs);
  results.sort((a, b) => {
    const relA = path.relative(rootRealAbs, a).split(path.sep).join('/');
    const relB = path.relative(rootRealAbs, b).split(path.sep).join('/');
    return relA.localeCompare(relB);
  });

  return results;
}
