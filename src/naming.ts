import { promises as fs } from 'node:fs';
import path from 'node:path';

import { AppError, assert } from './errors.js';

export type ToolTarget = {
  toolName: string;
  bruFileAbs: string;
  collectionRootAbs: string;
  requestPathNoExt: string;
  requiresEnv: boolean;
  templateVars: string[];
  /** Request documentation from the .bru `docs` block, if present. Used as MCP tool description. */
  docs?: string;
};

const TOOL_NAME_PATTERN = /^[a-z0-9_]+$/;

export function sanitizeSegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

export function sanitizePrefix(input: string): string {
  const value = sanitizeSegment(input);
  assert(value.length > 0, 'E_ARGS', 'Prefix is empty after sanitization. Provide at least one alphanumeric character.');
  return value;
}

export function validateToolName(input: string): string {
  assert(input.length > 0, 'E_ARGS', 'Tool name cannot be empty.');
  assert(TOOL_NAME_PATTERN.test(input), 'E_ARGS', 'Tool name must match /^[a-z0-9_]+$/');
  return input;
}

export function derivePrefix(prefixArg: string | undefined, collectionRootAbs: string): string {
  if (prefixArg) {
    return sanitizePrefix(prefixArg);
  }

  const base = path.basename(collectionRootAbs);
  return sanitizePrefix(base);
}

export function buildToolNameFromRelativePath(prefix: string, relativeBruPath: string): string {
  const normalized = relativeBruPath.split(path.sep).join('/').replace(/\.bru$/i, '');
  const segments = normalized.split('/').filter(Boolean).map(sanitizeSegment);
  for (const segment of segments) {
    assert(segment.length > 0, 'E_NAMING', `Invalid path segment in ${relativeBruPath}`);
  }
  const name = `${prefix}_${segments.join('_')}`;
  return validateToolName(name);
}

/**
 * Extracts the content of the first `docs { ... }` text block from .bru file content.
 * Returns undefined if no docs block is present.
 */
export function extractDocsFromBruContent(content: string): string | undefined {
  const lines = content.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined || !/^\s*docs\s*\{/.test(line)) {
      i += 1;
      continue;
    }
    const contentLines: string[] = [];
    const restOfFirstLine = line.replace(/^\s*docs\s*\{\s*/, '').trimEnd();
    if (restOfFirstLine && restOfFirstLine !== '}') {
      const upToClose = restOfFirstLine.replace(/\s*\}$/, '').trim();
      if (upToClose) contentLines.push(upToClose);
      if (/\}\s*$/.test(restOfFirstLine)) {
        const out = contentLines.join('\n').trim();
        return out.length > 0 ? out : undefined;
      }
    }
    i += 1;
    while (i < lines.length) {
      const contentLine = lines[i];
      if (contentLine === undefined) {
        i += 1;
        continue;
      }
      if (/^\s*\}\s*$/.test(contentLine)) {
        const out = contentLines.join('\n').trim();
        return out.length > 0 ? out : undefined;
      }
      contentLines.push(contentLine);
      i += 1;
    }
    const out = contentLines.join('\n').trim();
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

export async function extractDocsFromBruFile(bruFileAbs: string): Promise<string | undefined> {
  const content = await fs.readFile(bruFileAbs, 'utf8');
  return extractDocsFromBruContent(content);
}

export async function extractTemplateVariables(bruFileAbs: string): Promise<string[]> {
  const content = await fs.readFile(bruFileAbs, 'utf8');
  const found = new Set<string>();
  const regex = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const variable = match[1];
    if (variable) {
      found.add(variable);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

export async function buildSingleToolMap(params: {
  bruFileAbs: string;
  collectionRootAbs: string;
  prefix: string;
  nameOverride?: string;
}): Promise<Map<string, ToolTarget>> {
  const fileStem = sanitizeSegment(path.basename(params.bruFileAbs, '.bru'));
  assert(fileStem.length > 0, 'E_NAMING', `Invalid single request file name: ${params.bruFileAbs}`);

  const toolName = params.nameOverride
    ? validateToolName(params.nameOverride)
    : validateToolName(`${params.prefix}_${fileStem}`);

  const [templateVars, docs] = await Promise.all([
    extractTemplateVariables(params.bruFileAbs),
    extractDocsFromBruFile(params.bruFileAbs)
  ]);
  const requiresEnv = templateVars.length > 0;
  const relativePath = path.relative(params.collectionRootAbs, params.bruFileAbs);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new AppError('E_DISCOVERY', `Path traversal blocked for discovered file: ${params.bruFileAbs}`);
  }
  return new Map([
    [
      toolName,
      {
        toolName,
        bruFileAbs: params.bruFileAbs,
        collectionRootAbs: params.collectionRootAbs,
        requestPathNoExt: relativePath.replace(/\.bru$/i, '').split(path.sep).join('/'),
        requiresEnv,
        templateVars,
        ...(docs !== undefined ? { docs } : {})
      }
    ]
  ]);
}

export async function buildCollectionToolMap(params: {
  bruFilesAbs: string[];
  collectionRootAbs: string;
  prefix: string;
}): Promise<Map<string, ToolTarget>> {
  const map = new Map<string, ToolTarget>();

  for (const bruFileAbs of params.bruFilesAbs) {
    const relativePath = path.relative(params.collectionRootAbs, bruFileAbs);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new AppError('E_DISCOVERY', `Path traversal blocked for discovered file: ${bruFileAbs}`);
    }

    if (path.basename(relativePath).toLowerCase() === 'collection.bru') {
      continue;
    }

    const toolName = buildToolNameFromRelativePath(params.prefix, relativePath);
    if (map.has(toolName)) {
      throw new AppError('E_NAMING', `Tool name collision after sanitization: ${toolName}`);
    }

    const requestPathNoExt = relativePath.replace(/\.bru$/i, '').split(path.sep).join('/');
    const [templateVars, docs] = await Promise.all([
      extractTemplateVariables(bruFileAbs),
      extractDocsFromBruFile(bruFileAbs)
    ]);
    const requiresEnv = templateVars.length > 0;
    map.set(toolName, {
      toolName,
      bruFileAbs,
      collectionRootAbs: params.collectionRootAbs,
      requestPathNoExt,
      requiresEnv,
      templateVars,
      ...(docs !== undefined ? { docs } : {})
    });
  }

  return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
