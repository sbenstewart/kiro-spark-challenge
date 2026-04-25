import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Mock vscode — must be hoisted before any module that imports it
// ---------------------------------------------------------------------------
vi.mock('vscode', () => ({
  window: {
    activeTextEditor: undefined,
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    withProgress: vi.fn(),
  },
  workspace: {
    applyEdit: vi.fn().mockResolvedValue(true),
    workspaceFolders: [],
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
    }),
  },
  WorkspaceEdit: vi.fn(() => ({ replace: vi.fn() })),
  Range: vi.fn(),
  commands: { executeCommand: vi.fn() },
  ProgressLocation: { Notification: 15 },
  Uri: { file: vi.fn((p: string) => ({ fsPath: p })) },
}));

import { McpServer } from '../mcp/server';
import { SessionPersister } from '../sessionPersister';
import { ExecutionRunner } from '../executionRunner';
import { Optimizer } from '../optimizer';
import { LlmOptimizer } from '../llmOptimizer';
import { ProfileSession, SessionSummary } from '../types';

// ---------------------------------------------------------------------------
// Helpers to parse MCP tool-call responses
// ---------------------------------------------------------------------------

interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function parseToolResult<T>(result: unknown): T {
  const toolResult = result as McpToolResult;
  return JSON.parse(toolResult.content[0].text) as T;
}

// ---------------------------------------------------------------------------
// Integration suite
// ---------------------------------------------------------------------------

describe('MCP Integration: run_profile → get_session → get_suggestions', () => {
  let server: McpServer;
  let tempDir: string;
  let demoFilePath: string;
  let sessionId: string;

  beforeAll(async () => {
    // Create a temp workspace dir
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-integration-'));

    // Copy demo/demo.py into the temp dir so path validation passes
    // (runProfileTool requires filePath to be within workspacePath)
    const sourceDemoPath = path.resolve(__dirname, '../../../demo/demo.py');
    demoFilePath = path.join(tempDir, 'demo.py');
    fs.copyFileSync(sourceDemoPath, demoFilePath);

    const persister = new SessionPersister(tempDir);
    const runner = new ExecutionRunner();
    const optimizer = new Optimizer();
    const llmOptimizer = { suggest: vi.fn().mockResolvedValue([]) } as unknown as LlmOptimizer;

    server = new McpServer(persister, runner, optimizer, llmOptimizer, tempDir);
  }, 60000);

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('run_profile returns a valid ProfileSession', async () => {
    const response = await server.dispatch({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'run_profile',
        arguments: {
          filePath: demoFilePath,
          language: 'python',
        },
      },
    });

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.error).toBeUndefined();

    const session = parseToolResult<ProfileSession>(response.result);

    // Store sessionId for subsequent tests
    sessionId = session.id;

    expect(typeof session.id).toBe('string');
    expect(session.id.length).toBeGreaterThan(0);
    expect(session.filePath).toBe(demoFilePath);
    expect(session.language).toBe('python');
    expect(session.sessionType).toBe('profile');
    expect(typeof session.startTime).toBe('number');
    expect(typeof session.endTime).toBe('number');
    expect(session.endTime).toBeGreaterThanOrEqual(session.startTime);
    expect(session.metrics).toBeDefined();
    expect(typeof session.metrics.executionTimeMs).toBe('number');
    expect(Array.isArray(session.optimizationSuggestions)).toBe(true);
  }, 30000);

  it('get_session returns the same session', async () => {
    expect(sessionId).toBeDefined();

    const response = await server.dispatch({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'get_session',
        arguments: { sessionId },
      },
    });

    expect(response.error).toBeUndefined();

    const session = parseToolResult<ProfileSession>(response.result);

    expect(session.id).toBe(sessionId);
    expect(session.filePath).toBe(demoFilePath);
    expect(session.language).toBe('python');
    expect(session.metrics).toBeDefined();
  });

  it('get_suggestions returns the suggestions array', async () => {
    expect(sessionId).toBeDefined();

    const response = await server.dispatch({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_suggestions',
        arguments: { sessionId, useLlm: false },
      },
    });

    expect(response.error).toBeUndefined();

    const suggestions = parseToolResult<unknown[]>(response.result);

    expect(Array.isArray(suggestions)).toBe(true);
  });

  it('list_sessions includes the new session id', async () => {
    expect(sessionId).toBeDefined();

    const response = await server.dispatch({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'list_sessions',
        arguments: {},
      },
    });

    expect(response.error).toBeUndefined();

    const summaries = parseToolResult<SessionSummary[]>(response.result);

    expect(Array.isArray(summaries)).toBe(true);
    const ids = summaries.map((s) => s.id);
    expect(ids).toContain(sessionId);
  });
}, { timeout: 30000 });
