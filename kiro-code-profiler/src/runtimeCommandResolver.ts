import * as fs from 'fs';
import * as path from 'path';
import { RunRequest } from './types';

export interface RuntimeCommand {
  cmd: string;
  args: string[];
}

const tsRuntimeCache = new Map<string, RuntimeCommand>();

function scriptBinaryName(name: string): string {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function findUpwards(startDir: string, relativePath: string): string | null {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, relativePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

export function resolveTypeScriptCommand(filePath: string, runtimePath?: string): RuntimeCommand {
  if (runtimePath) {
    return { cmd: runtimePath, args: [filePath] };
  }

  const cacheKey = path.dirname(path.resolve(filePath));
  const cached = tsRuntimeCache.get(cacheKey);
  if (cached) {
    return { ...cached, args: [...cached.args] };
  }

  const candidateNames = [
    scriptBinaryName('ts-node-script'),
    scriptBinaryName('tsx'),
    scriptBinaryName('ts-node'),
  ];

  for (const candidateName of candidateNames) {
    const localBinary = findUpwards(cacheKey, path.join('node_modules', '.bin', candidateName));
    if (localBinary) {
      const command = { cmd: localBinary, args: [filePath] };
      tsRuntimeCache.set(cacheKey, command);
      return { ...command, args: [...command.args] };
    }
  }

  const fallback = { cmd: 'npx', args: ['ts-node', filePath] };
  tsRuntimeCache.set(cacheKey, fallback);
  return { ...fallback, args: [...fallback.args] };
}

export function buildRuntimeCommand(
  language: RunRequest['language'],
  filePath: string,
  runtimePath?: string
): RuntimeCommand {
  switch (language) {
    case 'javascript':
      return { cmd: runtimePath ?? 'node', args: [filePath] };
    case 'typescript':
      return resolveTypeScriptCommand(filePath, runtimePath);
    case 'python':
      return { cmd: runtimePath ?? 'python3', args: [filePath] };
  }
}
