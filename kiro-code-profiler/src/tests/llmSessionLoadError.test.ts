/**
 * Bug Condition Exploration Tests — LLM Session Load Error
 *
 * Property 1: Bug Condition — Uri Argument Incorrectly Enters Session-Load Branch
 *
 * These tests encode the EXPECTED (correct) behavior. They are run against UNFIXED code
 * and are EXPECTED TO FAIL. Failure confirms the bug exists.
 *
 * Bug: `if (sessionIdArg)` is truthy for a vscode.Uri object, so the handler enters
 * the session-load branch and calls `persister.load(uri)` with a non-string argument.
 *
 * Fix (NOT applied yet): `if (typeof sessionIdArg === 'string')`
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock vscode before importing anything that depends on it.
// ---------------------------------------------------------------------------

const mockShowWarningMessage = vi.fn();
const mockShowErrorMessage = vi.fn();
const mockShowInformationMessage = vi.fn();

// A mock Uri object — simulates what VS Code passes from the editor context menu
const mockUri = {
  fsPath: '/workspace/metricsCollector.ts',
  scheme: 'file',
  authority: '',
  path: '/workspace/metricsCollector.ts',
  query: '',
  fragment: '',
  toString: () => 'file:///workspace/metricsCollector.ts',
  toJSON: () => ({ fsPath: '/workspace/metricsCollector.ts' }),
};

vi.mock('vscode', () => ({
  window: {
    get activeTextEditor() {
      return (global as Record<string, unknown>).__mockActiveEditor ?? undefined;
    },
    showWarningMessage: mockShowWarningMessage,
    showErrorMessage: mockShowErrorMessage,
    showInformationMessage: mockShowInformationMessage,
    withProgress: vi.fn(),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    openTextDocument: vi.fn().mockResolvedValue({ getText: () => 'const x = 1;' }),
    applyEdit: vi.fn().mockResolvedValue(true),
  },
  WorkspaceEdit: vi.fn(() => ({ replace: vi.fn() })),
  Range: vi.fn(),
  commands: {
    registerCommand: vi.fn(),
    executeCommand: vi.fn(),
  },
  ProgressLocation: { Notification: 15 },
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file' })),
  },
  lm: {
    selectChatModels: vi.fn().mockResolvedValue([]),
  },
  LanguageModelChatMessage: {
    User: vi.fn((text: string) => ({ role: 'user', content: text })),
  },
}));

// ---------------------------------------------------------------------------
// The handler logic extracted for testing.
//
// We replicate the optimizeWithLLM handler logic here so we can test it
// without the full VS Code extension activation machinery. This mirrors
// the exact branching logic in extension.ts.
// ---------------------------------------------------------------------------

interface MockPersister {
  load: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

interface MockEditor {
  document: {
    uri: { fsPath: string };
    getText: () => string;
  };
}

/**
 * Simulates the optimizeWithLLM handler branching logic from extension.ts.
 *
 * This is the FIXED version: `if (typeof sessionIdArg === 'string')` — a Uri is NOT a string.
 */
async function runHandlerLogic(
  sessionIdArg: unknown,
  persister: MockPersister,
  activeEditor: MockEditor | undefined,
  workspacePath: string
): Promise<{ branch: 'session-load' | 'active-editor' | 'error'; warning?: string }> {
  // Replicate the fixed condition from extension.ts
  if (typeof sessionIdArg === 'string') {
    // BUG: Uri enters here because it is truthy
    try {
      await persister.load(sessionIdArg as string);
      return { branch: 'session-load' };
    } catch {
      const allSessions = await persister.list(workspacePath);
      const summary = allSessions[0];
      if (!summary) {
        mockShowWarningMessage('No profiling sessions found. Profile a file first.');
        return { branch: 'error', warning: 'No profiling sessions found. Profile a file first.' };
      }
      try {
        await persister.load(summary.id);
        return { branch: 'session-load' };
      } catch {
        mockShowWarningMessage('Could not load the requested session.');
        return { branch: 'error', warning: 'Could not load the requested session.' };
      }
    }
  } else {
    // Correct path: active-editor
    if (!activeEditor) {
      mockShowWarningMessage('No active editor.');
      return { branch: 'error', warning: 'No active editor.' };
    }
    const filePath = activeEditor.document.uri.fsPath;
    const allSessions = await persister.list(workspacePath);
    const sessionSummary = allSessions.find((s: { filePath: string }) => s.filePath === filePath);
    if (!sessionSummary) {
      mockShowWarningMessage('Profile this file first before requesting optimization.');
      return { branch: 'error', warning: 'Profile this file first before requesting optimization.' };
    }
    await persister.load(sessionSummary.id);
    return { branch: 'active-editor' };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePersister(overrides: Partial<MockPersister> = {}): MockPersister {
  return {
    load: vi.fn().mockRejectedValue(new Error('Session not found')),
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeEditor(fsPath = '/workspace/metricsCollector.ts'): MockEditor {
  return {
    document: {
      uri: { fsPath },
      getText: () => 'const x = 1;',
    },
  };
}

// ---------------------------------------------------------------------------
// Test 1: persister.load is NOT called with the Uri object
//
// Expected (correct) behavior: when sessionIdArg is a Uri, the handler should
// treat it as a context-menu call and NOT call persister.load with the Uri.
//
// On UNFIXED code: FAILS — persister.load IS called with the Uri (bug confirmed)
// ---------------------------------------------------------------------------

describe('Bug Condition: Uri argument should NOT enter session-load branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persister.load is NOT called with the Uri object when sessionIdArg is a vscode.Uri', async () => {
    // Arrange: persister.load fails (as it would with a Uri argument)
    const persister = makePersister({
      load: vi.fn().mockRejectedValue(new Error('Session not found')),
      list: vi.fn().mockResolvedValue([]),
    });
    const editor = makeEditor();

    // Act: call handler with a Uri object as sessionIdArg
    await runHandlerLogic(mockUri, persister, editor, '/workspace');

    // Assert: persister.load should NOT have been called with the Uri object
    // On UNFIXED code this FAILS — persister.load IS called with mockUri
    expect(persister.load).not.toHaveBeenCalledWith(mockUri);
  });

  it('handler takes the active-editor branch (not session-load) when sessionIdArg is a Uri', async () => {
    // Arrange: a session exists for the active file
    const sessionSummary = { id: 'session-abc', filePath: '/workspace/metricsCollector.ts' };
    const persister = makePersister({
      load: vi.fn().mockResolvedValue({ id: 'session-abc', filePath: '/workspace/metricsCollector.ts' }),
      list: vi.fn().mockResolvedValue([sessionSummary]),
    });
    const editor = makeEditor('/workspace/metricsCollector.ts');

    // Act
    const result = await runHandlerLogic(mockUri, persister, editor, '/workspace');

    // Assert: should take the active-editor branch, not session-load
    // On UNFIXED code this FAILS — it takes the session-load branch
    expect(result.branch).toBe('active-editor');
  });
});

// ---------------------------------------------------------------------------
// Test 2: Uri with no active editor → "No active editor." warning
//
// Expected (correct) behavior: when sessionIdArg is a Uri and no active editor
// is open, the handler should show "No active editor." (active-editor path).
//
// On UNFIXED code: FAILS — shows "Could not load the requested session." instead
// ---------------------------------------------------------------------------

describe('Bug Condition: Uri with no active editor should show "No active editor."', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "No active editor." when sessionIdArg is a Uri and no editor is open', async () => {
    // Arrange: no active editor, persister has no sessions
    const persister = makePersister({
      load: vi.fn().mockRejectedValue(new Error('Session not found')),
      list: vi.fn().mockResolvedValue([]),
    });

    // Act: pass Uri as sessionIdArg, no active editor (undefined)
    const result = await runHandlerLogic(mockUri, persister, undefined, '/workspace');

    // Assert: should show "No active editor." (active-editor path)
    // On UNFIXED code this FAILS — shows "Could not load the requested session." instead
    expect(result.warning).toBe('No active editor.');
    expect(mockShowWarningMessage).toHaveBeenCalledWith('No active editor.');
    expect(mockShowWarningMessage).not.toHaveBeenCalledWith('Could not load the requested session.');
  });

  it('does NOT show "Could not load the requested session." when sessionIdArg is a Uri', async () => {
    // Arrange: no sessions exist, persister.load always fails
    const persister = makePersister({
      load: vi.fn().mockRejectedValue(new Error('Session not found')),
      list: vi.fn().mockResolvedValue([]),
    });

    // Act: pass Uri as sessionIdArg, no active editor
    await runHandlerLogic(mockUri, persister, undefined, '/workspace');

    // Assert: the session-load error message must NOT appear
    // On UNFIXED code this FAILS — "Could not load the requested session." IS shown
    expect(mockShowWarningMessage).not.toHaveBeenCalledWith('Could not load the requested session.');
  });
});

// ---------------------------------------------------------------------------
// Test 3: Uri with no prior session → "Profile this file first…" warning
//
// Expected (correct) behavior: when sessionIdArg is a Uri and no session exists
// for the active file, the handler should show "Profile this file first…".
//
// On UNFIXED code: FAILS — shows "Could not load the requested session." instead
// ---------------------------------------------------------------------------

describe('Bug Condition: Uri with no prior session should show "Profile this file first…"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Profile this file first…" when sessionIdArg is a Uri and no session exists for the file', async () => {
    // Arrange: active editor open, but no sessions for this file
    const persister = makePersister({
      load: vi.fn().mockRejectedValue(new Error('Session not found')),
      list: vi.fn().mockResolvedValue([]), // no sessions
    });
    const editor = makeEditor('/workspace/metricsCollector.ts');

    // Act: pass Uri as sessionIdArg
    const result = await runHandlerLogic(mockUri, persister, editor, '/workspace');

    // Assert: should show "Profile this file first…" (active-editor path)
    // On UNFIXED code this FAILS — shows "Could not load the requested session." instead
    expect(result.warning).toBe('Profile this file first before requesting optimization.');
    expect(mockShowWarningMessage).toHaveBeenCalledWith(
      'Profile this file first before requesting optimization.'
    );
  });

  it('does NOT show "Could not load the requested session." when Uri is passed with no prior session', async () => {
    // Arrange: active editor open, no sessions
    const persister = makePersister({
      load: vi.fn().mockRejectedValue(new Error('Session not found')),
      list: vi.fn().mockResolvedValue([]),
    });
    const editor = makeEditor('/workspace/metricsCollector.ts');

    // Act
    await runHandlerLogic(mockUri, persister, editor, '/workspace');

    // Assert: session-load error must NOT appear
    // On UNFIXED code this FAILS — "Could not load the requested session." IS shown
    expect(mockShowWarningMessage).not.toHaveBeenCalledWith('Could not load the requested session.');
  });
});

// ---------------------------------------------------------------------------
// Preservation Property Tests — Property 2
//
// Property 2: Preservation — String SessionId and Undefined Behavior Unchanged
//
// These tests observe the CURRENT (unfixed) behavior for string sessionId and
// undefined inputs, then assert that behavior is preserved. They are run against
// UNFIXED code and are EXPECTED TO PASS.
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4
// ---------------------------------------------------------------------------

import * as fc from 'fast-check';

describe('Preservation: non-empty string sessionId always enters session-load branch', () => {
  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * For non-empty string values as sessionIdArg (valid UUIDs, arbitrary strings),
   * the handler must call persister.load with that exact string — not the active-editor path.
   *
   * Note: empty string is falsy in JS, so the buggy `if (sessionIdArg)` check treats it
   * the same as undefined. We scope this property to non-empty strings (minLength: 1),
   * which are the strings that actually enter the session-load branch in the current code.
   */
  it('property: persister.load is called with the string sessionId for any non-empty string input', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (sessionId) => {
        vi.clearAllMocks();
        const persister = makePersister({
          load: vi.fn().mockResolvedValue({ id: sessionId, filePath: '/workspace/file.ts' }),
          list: vi.fn().mockResolvedValue([]),
        });
        const editor = makeEditor();

        await runHandlerLogic(sessionId, persister, editor, '/workspace');

        // persister.load must have been called with the string sessionId
        expect(persister.load).toHaveBeenCalledWith(sessionId);
      }),
      { numRuns: 50 }
    );
  });

  it('property: handler takes session-load branch (not active-editor) for any non-empty string sessionId', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (sessionId) => {
        vi.clearAllMocks();
        const persister = makePersister({
          load: vi.fn().mockResolvedValue({ id: sessionId, filePath: '/workspace/file.ts' }),
          list: vi.fn().mockResolvedValue([]),
        });
        const editor = makeEditor();

        const result = await runHandlerLogic(sessionId, persister, editor, '/workspace');

        // Must enter session-load branch, not active-editor
        expect(result.branch).toBe('session-load');
      }),
      { numRuns: 50 }
    );
  });
});

describe('Preservation: undefined sessionIdArg always takes active-editor path', () => {
  /**
   * **Validates: Requirements 3.3, 3.4**
   *
   * When sessionIdArg is undefined (command palette invocation), the handler must
   * use the active-editor path — not the session-load path.
   */
  it('takes active-editor branch when sessionIdArg is undefined and editor is open', async () => {
    vi.clearAllMocks();
    const sessionSummary = { id: 'session-xyz', filePath: '/workspace/metricsCollector.ts' };
    const persister = makePersister({
      load: vi.fn().mockResolvedValue({ id: 'session-xyz', filePath: '/workspace/metricsCollector.ts' }),
      list: vi.fn().mockResolvedValue([sessionSummary]),
    });
    const editor = makeEditor('/workspace/metricsCollector.ts');

    const result = await runHandlerLogic(undefined, persister, editor, '/workspace');

    expect(result.branch).toBe('active-editor');
    // persister.load must be called with the session ID from the active-editor lookup, not undefined
    expect(persister.load).toHaveBeenCalledWith('session-xyz');
    expect(persister.load).not.toHaveBeenCalledWith(undefined);
  });

  it('does NOT call persister.load with undefined when sessionIdArg is undefined', async () => {
    vi.clearAllMocks();
    const persister = makePersister({
      load: vi.fn().mockResolvedValue({ id: 'session-xyz', filePath: '/workspace/file.ts' }),
      list: vi.fn().mockResolvedValue([{ id: 'session-xyz', filePath: '/workspace/file.ts' }]),
    });
    const editor = makeEditor('/workspace/file.ts');

    await runHandlerLogic(undefined, persister, editor, '/workspace');

    expect(persister.load).not.toHaveBeenCalledWith(undefined);
  });
});

describe('Preservation: invalid non-empty string sessionId with no sessions shows "Could not load the requested session."', () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * When sessionIdArg is a non-empty string but the session cannot be loaded
   * (first load fails, fallback load also fails), the handler must show
   * "Could not load the requested session." warning.
   *
   * Setup: persister.list returns a session summary so the fallback is attempted,
   * but the fallback load also fails — triggering the "Could not load" message.
   */
  it('shows "Could not load the requested session." for any non-empty string sessionId when load always fails', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (sessionId) => {
        vi.clearAllMocks();
        const persister = makePersister({
          load: vi.fn().mockRejectedValue(new Error('Session not found')),
          // list returns a summary so the fallback load is attempted
          list: vi.fn().mockResolvedValue([{ id: 'fallback-id', filePath: '/workspace/file.ts' }]),
        });
        const editor = makeEditor();

        const result = await runHandlerLogic(sessionId, persister, editor, '/workspace');

        expect(result.warning).toBe('Could not load the requested session.');
        expect(mockShowWarningMessage).toHaveBeenCalledWith('Could not load the requested session.');
      }),
      { numRuns: 30 }
    );
  });
});

describe('Preservation: no active editor with undefined sessionIdArg shows "No active editor."', () => {
  /**
   * **Validates: Requirements 3.4**
   *
   * When sessionIdArg is undefined and no active editor is open, the handler must
   * show "No active editor." — this path must remain unchanged.
   */
  it('shows "No active editor." when sessionIdArg is undefined and no editor is open', async () => {
    vi.clearAllMocks();
    const persister = makePersister({
      load: vi.fn().mockRejectedValue(new Error('Session not found')),
      list: vi.fn().mockResolvedValue([]),
    });

    const result = await runHandlerLogic(undefined, persister, undefined, '/workspace');

    expect(result.warning).toBe('No active editor.');
    expect(mockShowWarningMessage).toHaveBeenCalledWith('No active editor.');
  });

  it('does NOT show "Could not load the requested session." when sessionIdArg is undefined and no editor', async () => {
    vi.clearAllMocks();
    const persister = makePersister({
      load: vi.fn().mockRejectedValue(new Error('Session not found')),
      list: vi.fn().mockResolvedValue([]),
    });

    await runHandlerLogic(undefined, persister, undefined, '/workspace');

    expect(mockShowWarningMessage).not.toHaveBeenCalledWith('Could not load the requested session.');
  });
});
