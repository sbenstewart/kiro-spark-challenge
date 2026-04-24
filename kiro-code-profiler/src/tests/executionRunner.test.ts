import { describe, it, expect } from 'vitest';
import { ExecutionRunner } from '../executionRunner';
import { RunRequest } from '../types';

describe('ExecutionRunner', () => {
  it('successful run: captures stdout and exits with code 0', async () => {
    const runner = new ExecutionRunner();
    const request: RunRequest = {
      filePath: '',
      language: 'javascript',
      selectedCode: "console.log('hello');",
    };

    const result = await runner.run(request);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
    expect(result.endTime).toBeGreaterThanOrEqual(result.startTime);
  });

  it('non-zero exit: exits with code 1 when script calls process.exit(1)', async () => {
    const runner = new ExecutionRunner();
    const request: RunRequest = {
      filePath: '',
      language: 'javascript',
      selectedCode: 'process.exit(1);',
    };

    const result = await runner.run(request);

    expect(result.exitCode).toBe(1);
  });

  it('timeout: returns exitCode -1 and stderr contains "timed out" when process exceeds timeout', async () => {
    const runner = new ExecutionRunner(100); // 100ms timeout
    const request: RunRequest = {
      filePath: '',
      language: 'javascript',
      selectedCode: 'while(true){}', // infinite loop
    };

    const result = await runner.run(request);

    expect(result.exitCode).toBe(-1);
    expect(result.stderr.toLowerCase()).toContain('timed out');
  }, 2000); // allow up to 2s for this test

  it('bad runtime path: returns exitCode -1 and stderr contains error info', async () => {
    const runner = new ExecutionRunner();
    const request: RunRequest = {
      filePath: '',
      language: 'javascript',
      runtimePath: '/nonexistent/runtime/node',
      selectedCode: "console.log('hi');",
    };

    const result = await runner.run(request);

    expect(result.exitCode).toBe(-1);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
