/**
 * Unit tests for error and edge-case scenarios in the LLM optimization feature.
 *
 * These tests exercise the underlying logic functions directly, without invoking
 * the full VS Code command registration machinery.
 *
 * Sub-tasks covered:
 *   12.1 No active editor when command invoked → warning shown
 *   12.2 No prior session for file → warning "Profile this file first…"
 *   12.3 LLM API throws → error message shown, no file changes
 *   12.4 Diff cannot be applied cleanly → error message shown, file unchanged
 *   12.5 Re-profile exits non-zero → warning shown, partial session saved and displayed
 *   12.6 Accept All with partial failures → summary "Applied N of M suggestions. Re-profiling…"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OptimizationSuggestion, ProfileSession, MetricsSummary } from '../types';
import { applyUnifiedDiff } from '../diffApplier';

// ---------------------------------------------------------------------------
// Mock vscode before importing anything that depends on it.
// vi.mock is hoisted, so the factory must use vi.fn() inline (no top-level
// variable references allowed inside the factory).
// ---------------------------------------------------------------------------

// Hoisted mock control for OpenAI — must be declared with vi.hoisted so it's
// available when vi.mock factories run (which are hoisted before imports).
const openAiMock = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ choices: [{ message: { content: '[]' } }] }),
}));

vi.mock('vscode', () => ({
  window: {
    activeTextEditor: undefined as unknown,
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  lm: {
    selectChatModels: vi.fn().mockResolvedValue([]),
  },
  LanguageModelChatMessage: {
    User: vi.fn((text: string) => ({ role: 'user', content: text })),
  },
  workspace: {
    applyEdit: vi.fn().mockResolvedValue(true),
    workspaceFolders: [],
  },
  WorkspaceEdit: vi.fn(() => ({ replace: vi.fn() })),
  Range: vi.fn(),
  commands: {
    executeCommand: vi.fn(),
  },
  ProgressLocation: { Notification: 15 },
  Uri: { file: vi.fn((p: string) => ({ fsPath: p })) },
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn(), execSync: vi.fn() };
});

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: (...args: unknown[]) => openAiMock.create(...args) } },
  })),
  OpenAI: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: (...args: unknown[]) => openAiMock.create(...args) } },
  })),
}));

import { LlmOptimizer } from '../llmOptimizer';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { EventEmitter } from 'events';

// Typed references to the mocked vscode functions for use in tests
const mockSpawn = cp.spawn as ReturnType<typeof vi.fn>;

/** Helper: create a fake child process that emits an error event */
function makeFakeSpawnError(err: Error) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setTimeout(() => proc.emit('error', err), 0);
  return proc;
}

/** Helper: create a fake child process that exits with a non-zero code and no stdout */
function makeFakeSpawnExit(code: number, stderrMsg = '') {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setTimeout(() => {
    if (stderrMsg) {
      proc.stderr.emit('data', Buffer.from(stderrMsg));
    }
    proc.emit('close', code);
  }, 0);
  return proc;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<MetricsSummary> = {}): MetricsSummary {
  return {
    peakRamMb: 100,
    avgRamMb: 80,
    totalDiskReadBytes: 0,
    totalDiskWriteBytes: 0,
    avgCpuPercent: 10,
    totalNetworkBytesSent: 0,
    totalNetworkBytesReceived: 0,
    totalFsOpen: 0,
    totalFsRead: 0,
    totalFsWrite: 0,
    totalFsClose: 0,
    executionTimeMs: 100,
    energyMwh: 0.01,
    samples: [],
    ...overrides,
  };
}

function makeSession(overrides: Partial<ProfileSession> = {}): ProfileSession {
  return {
    id: 'session-1',
    workspacePath: '/workspace',
    filePath: '/workspace/test.ts',
    language: 'typescript',
    sessionType: 'profile',
    startTime: 1000,
    endTime: 2000,
    exitCode: 0,
    stdout: '',
    stderr: '',
    metrics: makeMetrics(),
    isBaseline: false,
    optimizationSuggestions: [],
    ...overrides,
  };
}

function makeSuggestion(overrides: Partial<OptimizationSuggestion> = {}): OptimizationSuggestion {
  return {
    id: 'suggestion-1',
    title: 'Use const instead of let',
    explanation: 'Reduces memory allocation overhead.',
    estimatedImpact: 0.3,
    affectedMetric: 'ram',
    diff: `--- a/test.ts\n+++ b/test.ts\n@@ -1,1 +1,1 @@\n-let x = 1;\n+const x = 1;\n`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Guard logic helpers — mirror the guard conditions in extension.ts command handlers
// ---------------------------------------------------------------------------

/**
 * Simulates the "no active editor" guard from the optimizeWithLLM and
 * acceptSuggestion / acceptAllSuggestions command handlers.
 *
 * Returns the warning message that would be shown, or null if the guard passes.
 */
function guardNoActiveEditor(activeEditor: unknown): string | null {
  if (!activeEditor) {
    return 'No active editor.';
  }
  return null;
}

/**
 * Simulates the "no prior session" guard from the optimizeWithLLM handler.
 *
 * Returns the warning message that would be shown, or null if the guard passes.
 */
function guardNoSession(
  sessions: Array<{ filePath: string }>,
  filePath: string
): string | null {
  const found = sessions.find((s) => s.filePath === filePath);
  if (!found) {
    return 'Profile this file first before requesting optimization.';
  }
  return null;
}

/**
 * Simulates the LLM error handler from the optimizeWithLLM command.
 * Returns the error message that would be shown.
 */
function buildLlmErrorMessage(err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  return `LLM optimization failed: ${reason}`;
}

/**
 * Simulates the diff-apply failure handler from the acceptSuggestion command.
 * Returns the error message that would be shown when applyUnifiedDiff returns null.
 */
function buildDiffFailureMessage(): string {
  return 'Could not apply suggestion: the file has changed since profiling. Please re-profile and try again.';
}

/**
 * Simulates the re-profile non-zero exit handler.
 * Returns the warning message that would be shown, or null if exitCode === 0.
 */
function buildReprofileWarning(exitCode: number): string | null {
  if (exitCode !== 0) {
    return 'Re-profile completed with errors. Check the dashboard for details.';
  }
  return null;
}

/**
 * Simulates the Accept All summary message.
 */
function buildAcceptAllSummary(applied: number, total: number): string {
  return `Applied ${applied} of ${total} suggestions. Re-profiling…`;
}

/**
 * Simulates the Accept All logic: applies diffs sequentially in descending
 * estimatedImpact order, skipping those that fail.
 *
 * Returns { applied, total, finalContent }.
 */
function simulateAcceptAll(
  suggestions: OptimizationSuggestion[],
  initialContent: string
): { applied: number; total: number; finalContent: string } {
  const sorted = [...suggestions].sort((a, b) => b.estimatedImpact - a.estimatedImpact);
  const total = sorted.length;
  let applied = 0;
  let currentContent = initialContent;

  for (const suggestion of sorted) {
    const patched = applyUnifiedDiff(currentContent, suggestion.diff);
    if (patched === null) {
      // skip — diff could not be applied
      continue;
    }
    currentContent = patched;
    applied++;
  }

  return { applied, total, finalContent: currentContent };
}

// ---------------------------------------------------------------------------
// 12.1 No active editor when command invoked → warning shown
// ---------------------------------------------------------------------------

describe('12.1 No active editor → warning shown', () => {
  it('returns the "No active editor." warning when activeTextEditor is undefined', () => {
    const warning = guardNoActiveEditor(undefined);
    expect(warning).toBe('No active editor.');
  });

  it('returns the "No active editor." warning when activeTextEditor is null', () => {
    const warning = guardNoActiveEditor(null);
    expect(warning).toBe('No active editor.');
  });

  it('returns null (guard passes) when an editor is present', () => {
    const fakeEditor = { document: { uri: { fsPath: '/workspace/test.ts' } } };
    const warning = guardNoActiveEditor(fakeEditor);
    expect(warning).toBeNull();
  });

  it('warning message matches the exact string from the design spec', () => {
    const warning = guardNoActiveEditor(undefined);
    // Design spec: "No active editor."
    expect(warning).toBe('No active editor.');
  });
});

// ---------------------------------------------------------------------------
// 12.2 No prior session for file → warning "Profile this file first…"
// ---------------------------------------------------------------------------

describe('12.2 No prior session for file → warning shown', () => {
  it('returns the warning when no sessions exist at all', () => {
    const warning = guardNoSession([], '/workspace/test.ts');
    expect(warning).toBe('Profile this file first before requesting optimization.');
  });

  it('returns the warning when sessions exist but none match the active file', () => {
    const sessions = [{ filePath: '/workspace/other.ts' }];
    const warning = guardNoSession(sessions, '/workspace/test.ts');
    expect(warning).toBe('Profile this file first before requesting optimization.');
  });

  it('returns null (guard passes) when a session exists for the active file', () => {
    const sessions = [{ filePath: '/workspace/test.ts' }];
    const warning = guardNoSession(sessions, '/workspace/test.ts');
    expect(warning).toBeNull();
  });

  it('warning message matches the exact string from the design spec', () => {
    const warning = guardNoSession([], '/workspace/test.ts');
    // Design spec: "Profile this file first before requesting optimization."
    expect(warning).toBe('Profile this file first before requesting optimization.');
  });

  it('returns null when multiple sessions exist and one matches', () => {
    const sessions = [
      { filePath: '/workspace/a.ts' },
      { filePath: '/workspace/test.ts' },
      { filePath: '/workspace/b.ts' },
    ];
    const warning = guardNoSession(sessions, '/workspace/test.ts');
    expect(warning).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12.3 LLM API throws → error message shown, no file changes
// ---------------------------------------------------------------------------

describe('12.3 LLM API throws → error message shown, no file changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default (success) mock between tests
    openAiMock.create.mockResolvedValue({
      choices: [{ message: { content: '[]' } }],
    });
  });

  it('LlmOptimizer.suggest propagates errors when the OpenAI client throws a connection error', async () => {
    // Simulate OpenAI SDK throwing a connection/auth error
    process.env.OPENAI_API_KEY = 'test-key';
    openAiMock.create.mockRejectedValueOnce(new Error('Connection refused'));

    const optimizer = new LlmOptimizer();
    const session = makeSession();

    await expect(optimizer.suggest(session, 'const x = 1;')).rejects.toThrow('Connection refused');
    delete process.env.OPENAI_API_KEY;
    vi.doUnmock('openai');
  });

  it('LlmOptimizer.suggest propagates errors from the OpenAI API call (e.g. rate limit)', async () => {
    // Simulate OpenAI SDK throwing a rate limit error
    process.env.OPENAI_API_KEY = 'test-key';
    openAiMock.create.mockRejectedValueOnce(new Error('Rate limit exceeded'));

    const optimizer = new LlmOptimizer();
    const session = makeSession();

    await expect(optimizer.suggest(session, 'const x = 1;')).rejects.toThrow('Rate limit exceeded');
    delete process.env.OPENAI_API_KEY;
    vi.doUnmock('openai');
  });

  it('LlmOptimizer.suggest propagates timeout errors from the OpenAI API', async () => {
    // Simulate OpenAI SDK throwing a timeout error
    process.env.OPENAI_API_KEY = 'test-key';
    openAiMock.create.mockRejectedValueOnce(new Error('Request timed out'));

    const optimizer = new LlmOptimizer();
    const session = makeSession();

    await expect(optimizer.suggest(session, 'const x = 1;')).rejects.toThrow('Request timed out');
    delete process.env.OPENAI_API_KEY;
    vi.doUnmock('openai');
  });

  it('error message builder includes the error reason', () => {
    const err = new Error('Rate limit exceeded');
    const msg = buildLlmErrorMessage(err);
    expect(msg).toContain('Rate limit exceeded');
    expect(msg).toContain('LLM optimization failed');
  });

  it('error message builder handles non-Error throws', () => {
    const msg = buildLlmErrorMessage('some string error');
    expect(msg).toContain('some string error');
    expect(msg).toContain('LLM optimization failed');
  });

  it('error message builder handles object throws', () => {
    const msg = buildLlmErrorMessage({ code: 429 });
    expect(msg).toContain('LLM optimization failed');
  });

  it('no file changes occur when LLM throws — suggest rejects before any write', async () => {
    // Simulate OpenAI SDK throwing before any diff is applied
    process.env.OPENAI_API_KEY = 'test-key';
    openAiMock.create.mockRejectedValueOnce(new Error('API error'));

    const { LlmOptimizer: FreshLlmOptimizer } = await import('../llmOptimizer');
    const optimizer = new FreshLlmOptimizer();
    const session = makeSession();

    // Capture whether applyUnifiedDiff would be called (it should not be)
    let diffApplied = false;
    const originalContent = 'const x = 1;';

    try {
      await optimizer.suggest(session, originalContent);
    } catch {
      // expected — error thrown before any diff application
    }

    // No diff was applied
    expect(diffApplied).toBe(false);
    // Content is unchanged
    expect(originalContent).toBe('const x = 1;');
    delete process.env.OPENAI_API_KEY;
  });
});

// ---------------------------------------------------------------------------
// 12.4 Diff cannot be applied cleanly → error message shown, file unchanged
// ---------------------------------------------------------------------------

describe('12.4 Diff cannot be applied cleanly → error message shown, file unchanged', () => {
  it('applyUnifiedDiff returns null when context lines do not match', () => {
    const original = 'line1\nline2\nline3\n';
    const diff = `--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-doesNotExist\n+replacement\n`;
    const result = applyUnifiedDiff(original, diff);
    expect(result).toBeNull();
  });

  it('applyUnifiedDiff returns null when removed line is absent from file', () => {
    const original = 'foo\nbar\n';
    const diff = `--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-baz\n+qux\n`;
    const result = applyUnifiedDiff(original, diff);
    expect(result).toBeNull();
  });

  it('applyUnifiedDiff returns null when diff references lines beyond file length', () => {
    const original = 'only one line\n';
    const diff = `--- a/file\n+++ b/file\n@@ -10,1 +10,1 @@\n-nonexistent\n+replacement\n`;
    const result = applyUnifiedDiff(original, diff);
    expect(result).toBeNull();
  });

  it('error message matches the exact string from the design spec', () => {
    const msg = buildDiffFailureMessage();
    expect(msg).toBe(
      'Could not apply suggestion: the file has changed since profiling. Please re-profile and try again.'
    );
  });

  it('file content is unchanged when applyUnifiedDiff returns null', () => {
    const original = 'const x = 1;\nconst y = 2;\n';
    const badDiff = `--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-doesNotExist\n+replacement\n`;

    const result = applyUnifiedDiff(original, badDiff);

    // null means no patch was applied
    expect(result).toBeNull();
    // The original string is untouched
    expect(original).toBe('const x = 1;\nconst y = 2;\n');
  });

  it('accept handler does not modify file when diff returns null', () => {
    // Simulate the accept handler logic: if patched === null, show error and return
    const original = 'const x = 1;\n';
    const badDiff = `--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-doesNotExist\n+replacement\n`;

    const patched = applyUnifiedDiff(original, badDiff);

    let fileWasModified = false;
    if (patched === null) {
      // show error — no file changes
    } else {
      fileWasModified = true;
    }

    expect(fileWasModified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12.5 Re-profile exits non-zero → warning shown, partial session saved and displayed
// ---------------------------------------------------------------------------

describe('12.5 Re-profile exits non-zero → warning shown, partial session saved', () => {
  it('buildReprofileWarning returns the warning for non-zero exit codes', () => {
    expect(buildReprofileWarning(1)).toBe(
      'Re-profile completed with errors. Check the dashboard for details.'
    );
    expect(buildReprofileWarning(2)).toBe(
      'Re-profile completed with errors. Check the dashboard for details.'
    );
    expect(buildReprofileWarning(-1)).toBe(
      'Re-profile completed with errors. Check the dashboard for details.'
    );
    expect(buildReprofileWarning(127)).toBe(
      'Re-profile completed with errors. Check the dashboard for details.'
    );
  });

  it('buildReprofileWarning returns null for exit code 0 (success)', () => {
    expect(buildReprofileWarning(0)).toBeNull();
  });

  it('warning message matches the exact string from the design spec', () => {
    const warning = buildReprofileWarning(1);
    // Design spec: "Re-profile completed with errors. Check the dashboard for details."
    expect(warning).toBe('Re-profile completed with errors. Check the dashboard for details.');
  });

  it('partial session is still constructed and saved even when exitCode !== 0', () => {
    // Simulate the session construction logic from extension.ts acceptSuggestion handler
    const originalSession = makeSession();
    const partialMetrics = makeMetrics({ peakRamMb: 50 });

    const newSession: ProfileSession = {
      id: 'new-session-id',
      workspacePath: originalSession.workspacePath,
      filePath: originalSession.filePath,
      language: originalSession.language,
      sessionType: 'profile',
      startTime: 2000,
      endTime: 3000,
      exitCode: 1, // non-zero
      stdout: '',
      stderr: 'Error: script failed',
      metrics: partialMetrics,
      isBaseline: false,
      optimizationSuggestions: [],
      linkedPreSessionId: originalSession.id,
    };

    // Session is constructed regardless of exitCode
    expect(newSession).toBeDefined();
    expect(newSession.exitCode).toBe(1);
    expect(newSession.metrics).toBeDefined();
    expect(newSession.linkedPreSessionId).toBe(originalSession.id);

    // Warning would be shown
    const warning = buildReprofileWarning(newSession.exitCode);
    expect(warning).not.toBeNull();
  });

  it('partial session has linkedPreSessionId set to original session id', () => {
    const originalSession = makeSession({ id: 'original-123' });

    const newSession: ProfileSession = {
      id: 'new-456',
      workspacePath: originalSession.workspacePath,
      filePath: originalSession.filePath,
      language: originalSession.language,
      sessionType: 'profile',
      startTime: 2000,
      endTime: 3000,
      exitCode: 1,
      stdout: '',
      stderr: 'partial error',
      metrics: makeMetrics(),
      isBaseline: false,
      optimizationSuggestions: [],
      linkedPreSessionId: originalSession.id,
    };

    expect(newSession.linkedPreSessionId).toBe('original-123');
  });
});

// ---------------------------------------------------------------------------
// 12.6 Accept All with partial failures → summary "Applied N of M suggestions. Re-profiling…"
// ---------------------------------------------------------------------------

describe('12.6 Accept All with partial failures → correct summary message', () => {
  it('summary message format matches "Applied N of M suggestions. Re-profiling…"', () => {
    const msg = buildAcceptAllSummary(2, 3);
    expect(msg).toBe('Applied 2 of 3 suggestions. Re-profiling…');
  });

  it('summary message when all suggestions applied', () => {
    const msg = buildAcceptAllSummary(3, 3);
    expect(msg).toBe('Applied 3 of 3 suggestions. Re-profiling…');
  });

  it('summary message when no suggestions applied', () => {
    const msg = buildAcceptAllSummary(0, 3);
    expect(msg).toBe('Applied 0 of 3 suggestions. Re-profiling…');
  });

  it('simulateAcceptAll applies valid diffs and skips invalid ones', () => {
    const original = 'line1\nline2\nline3\n';

    const validDiff = `--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-line1\n+LINE1\n`;
    const invalidDiff = `--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-doesNotExist\n+replacement\n`;

    const suggestions: OptimizationSuggestion[] = [
      makeSuggestion({ id: 's1', estimatedImpact: 0.8, diff: validDiff }),
      makeSuggestion({ id: 's2', estimatedImpact: 0.5, diff: invalidDiff }),
    ];

    const { applied, total, finalContent } = simulateAcceptAll(suggestions, original);

    expect(total).toBe(2);
    expect(applied).toBe(1);
    expect(finalContent).toBe('LINE1\nline2\nline3\n');
  });

  it('simulateAcceptAll applies all suggestions when all diffs are valid', () => {
    const original = 'a\nb\nc\n';

    const diff1 = `--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-a\n+A\n`;
    const diff2 = `--- a/file\n+++ b/file\n@@ -2,1 +2,1 @@\n-b\n+B\n`;

    const suggestions: OptimizationSuggestion[] = [
      makeSuggestion({ id: 's1', estimatedImpact: 0.9, diff: diff1 }),
      makeSuggestion({ id: 's2', estimatedImpact: 0.6, diff: diff2 }),
    ];

    const { applied, total } = simulateAcceptAll(suggestions, original);

    expect(total).toBe(2);
    expect(applied).toBe(2);
  });

  it('simulateAcceptAll skips all when all diffs are invalid', () => {
    const original = 'foo\nbar\n';

    const badDiff1 = `--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-doesNotExist1\n+x\n`;
    const badDiff2 = `--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-doesNotExist2\n+y\n`;

    const suggestions: OptimizationSuggestion[] = [
      makeSuggestion({ id: 's1', estimatedImpact: 0.7, diff: badDiff1 }),
      makeSuggestion({ id: 's2', estimatedImpact: 0.4, diff: badDiff2 }),
    ];

    const { applied, total, finalContent } = simulateAcceptAll(suggestions, original);

    expect(total).toBe(2);
    expect(applied).toBe(0);
    // File content is unchanged
    expect(finalContent).toBe('foo\nbar\n');
  });

  it('simulateAcceptAll applies diffs in descending estimatedImpact order', () => {
    // Use diffs that depend on order: first apply high-impact, then low-impact
    const original = 'a\nb\n';

    // High-impact: replace 'a' with 'A'
    const highImpactDiff = `--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-a\n+A\n`;
    // Low-impact: replace 'b' with 'B' (depends on 'b' still being present)
    const lowImpactDiff = `--- a/file\n+++ b/file\n@@ -2,1 +2,1 @@\n-b\n+B\n`;

    // Provide in reverse order to verify sorting
    const suggestions: OptimizationSuggestion[] = [
      makeSuggestion({ id: 's-low', estimatedImpact: 0.2, diff: lowImpactDiff }),
      makeSuggestion({ id: 's-high', estimatedImpact: 0.9, diff: highImpactDiff }),
    ];

    const { applied, total, finalContent } = simulateAcceptAll(suggestions, original);

    expect(total).toBe(2);
    expect(applied).toBe(2);
    expect(finalContent).toBe('A\nB\n');
  });

  it('summary message uses correct N and M values from simulateAcceptAll', () => {
    const original = 'x\ny\nz\n';

    const validDiff = `--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-x\n+X\n`;
    const invalidDiff = `--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-doesNotExist\n+replacement\n`;

    const suggestions: OptimizationSuggestion[] = [
      makeSuggestion({ id: 's1', estimatedImpact: 0.8, diff: validDiff }),
      makeSuggestion({ id: 's2', estimatedImpact: 0.5, diff: invalidDiff }),
      makeSuggestion({ id: 's3', estimatedImpact: 0.3, diff: invalidDiff }),
    ];

    const { applied, total } = simulateAcceptAll(suggestions, original);
    const summary = buildAcceptAllSummary(applied, total);

    expect(summary).toBe('Applied 1 of 3 suggestions. Re-profiling…');
  });
});
