import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { buildRuntimeCommand, resolveTypeScriptCommand } from '../runtimeCommandResolver';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'runtime-resolver-test-'));
}

async function removeTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

describe('runtimeCommandResolver', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(removeTempDir));
  });

  it('prefers a local ts-node-script binary over npx for TypeScript files', async () => {
    const tempDir = await makeTempDir();
    tempDirs.push(tempDir);

    const filePath = path.join(tempDir, 'src', 'demo.ts');
    const binDir = path.join(tempDir, 'node_modules', '.bin');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(filePath, 'console.log("demo")', 'utf8');

    const binaryName = process.platform === 'win32' ? 'ts-node-script.cmd' : 'ts-node-script';
    const binaryPath = path.join(binDir, binaryName);
    await fs.writeFile(binaryPath, '', 'utf8');

    const command = resolveTypeScriptCommand(filePath);

    expect(command.cmd).toBe(binaryPath);
    expect(command.args).toEqual([filePath]);
  });

  it('falls back to npx ts-node when no local TypeScript runtime exists', async () => {
    const tempDir = await makeTempDir();
    tempDirs.push(tempDir);

    const filePath = path.join(tempDir, 'demo.ts');
    await fs.writeFile(filePath, 'console.log("demo")', 'utf8');

    const command = resolveTypeScriptCommand(filePath);

    expect(command.cmd).toBe('npx');
    expect(command.args).toEqual(['ts-node', filePath]);
  });

  it('buildRuntimeCommand preserves the existing javascript and python behavior', () => {
    expect(buildRuntimeCommand('javascript', '/tmp/demo.js')).toEqual({
      cmd: 'node',
      args: ['/tmp/demo.js'],
    });
    expect(buildRuntimeCommand('python', '/tmp/demo.py')).toEqual({
      cmd: 'python3',
      args: ['/tmp/demo.py'],
    });
  });
});
