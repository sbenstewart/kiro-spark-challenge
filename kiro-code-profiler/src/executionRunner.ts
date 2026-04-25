import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RunRequest, ExecutionResult } from './types';

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

export class ExecutionRunner {
  private timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  async run(request: RunRequest): Promise<ExecutionResult> {
    let tempFile: string | undefined;

    try {
      const filePath = await this.resolveFilePath(request);
      tempFile = filePath !== request.filePath ? filePath : undefined;

      const { cmd, args } = this.buildCommand(request, filePath);

      return await this.spawnProcess(cmd, args, tempFile);
    } finally {
      if (tempFile) {
        try { fs.unlinkSync(tempFile); } catch { /* ignore cleanup errors */ }
      }
    }
  }

  private async resolveFilePath(request: RunRequest): Promise<string> {
    if (!request.selectedCode) {
      return request.filePath;
    }

    const ext = this.extensionFor(request.language);
    const tmpPath = path.join(os.tmpdir(), `kiro-profiler-${Date.now()}${ext}`);
    fs.writeFileSync(tmpPath, request.selectedCode, 'utf8');
    return tmpPath;
  }

  private extensionFor(language: RunRequest['language']): string {
    switch (language) {
      case 'javascript': return '.js';
      case 'typescript': return '.ts';
      case 'python':     return '.py';
    }
  }

  private buildCommand(request: RunRequest, filePath: string): { cmd: string; args: string[] } {
    switch (request.language) {
      case 'javascript':
        return { cmd: request.runtimePath ?? 'node', args: [filePath] };

      case 'typescript':
        if (request.runtimePath) {
          return { cmd: request.runtimePath, args: [filePath] };
        }
        return { cmd: 'npx', args: ['ts-node', filePath] };

      case 'python':
        return { cmd: request.runtimePath ?? 'python3', args: [filePath] };
    }
  }

  private spawnProcess(cmd: string, args: string[], _tempFile?: string): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let settled = false;

      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const pid = child.pid;

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        if (settled) { return; }
        settled = true;
        child.kill('SIGKILL');
        resolve({
          exitCode: -1,
          stdout,
          stderr: stderr + '\nProcess timed out',
          startTime,
          endTime: Date.now(),
        });
      }, this.timeoutMs);

      child.on('close', (code: number | null) => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: code ?? -1,
          stdout,
          stderr,
          startTime,
          endTime: Date.now(),
          pid,
        });
      });

      child.on('error', (err: Error) => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: -1,
          stdout,
          stderr: stderr + `\nFailed to spawn process: ${err.message}`,
          startTime,
          endTime: Date.now(),
          pid,
        });
      });
    });
  }
}
