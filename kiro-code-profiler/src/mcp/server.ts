import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { SessionPersister } from '../sessionPersister';
import { ExecutionRunner } from '../executionRunner';
import { Optimizer } from '../optimizer';
import { LlmOptimizer } from '../llmOptimizer';
import { aggregateSamples } from '../metricsCollector';
import { EnergyEstimator } from '../energyEstimator';
import {
  RunRequest,
  ProfileSession,
  SessionSummary,
  OptimizationSuggestion,
} from '../types';

// ---------------------------------------------------------------------------
// MCP JSON-RPC types
// ---------------------------------------------------------------------------

interface McpRequest {
  jsonrpc: '2.0';
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Tool input schemas (for tools/list)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'list_sessions',
    description: 'List all profiling sessions for a workspace',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: { type: 'string', description: 'Workspace root path (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'get_session',
    description: 'Retrieve a profiling session by ID',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'UUID of the session to retrieve' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'run_profile',
    description: 'Run a profiling session on a source file',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the file to profile' },
        language: {
          type: 'string',
          enum: ['javascript', 'typescript', 'python'],
          description: 'Language of the file',
        },
        selectedCode: { type: 'string', description: 'Optional code snippet to profile instead of the full file' },
      },
      required: ['filePath', 'language'],
    },
  },
  {
    name: 'get_suggestions',
    description: 'Get optimization suggestions for a profiling session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'UUID of the session' },
        useLlm: { type: 'boolean', description: 'If true, use LLM-based suggestions' },
      },
      required: ['sessionId'],
    },
  },
];

// ---------------------------------------------------------------------------
// McpServer
// ---------------------------------------------------------------------------

export class McpServer {
  private persister: SessionPersister;
  private runner: ExecutionRunner;
  private optimizer: Optimizer;
  private llmOptimizer: LlmOptimizer;
  private workspacePath: string;
  private rl: readline.Interface | null = null;

  constructor(
    persister: SessionPersister,
    runner: ExecutionRunner,
    optimizer: Optimizer,
    llmOptimizer: LlmOptimizer,
    workspacePath: string
  ) {
    this.persister = persister;
    this.runner = runner;
    this.optimizer = optimizer;
    this.llmOptimizer = llmOptimizer;
    this.workspacePath = workspacePath;
  }

  start(): void {
    this.rl = readline.createInterface({ input: process.stdin, terminal: false });
    this.readLoop().catch((err) => {
      process.stderr.write(`[McpServer] readLoop error: ${err}\n`);
    });
  }

  stop(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  private async readLoop(): Promise<void> {
    if (!this.rl) {
      return;
    }

    for await (const line of this.rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let request: McpRequest;
      try {
        request = JSON.parse(trimmed) as McpRequest;
      } catch {
        this.writeResponse({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        });
        continue;
      }

      const response = await this.dispatch(request);
      this.writeResponse(response);
    }
  }

  async dispatch(request: McpRequest): Promise<McpResponse> {
    const { method, id } = request;

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'kiro-code-profiler', version: '0.0.1' },
        },
      };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      };
    }

    if (method === 'tools/call') {
      return this.handleToolCall(request);
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found' },
    };
  }

  async handleToolCall(request: McpRequest): Promise<McpResponse> {
    const params = request.params ?? {};
    const toolName = params['name'] as string | undefined;
    const args = (params['arguments'] ?? {}) as Record<string, unknown>;

    let toolResult: McpToolResult;

    switch (toolName) {
      case 'list_sessions':
        toolResult = await this.listSessionsTool(args);
        break;
      case 'get_session':
        toolResult = await this.getSessionTool(args);
        break;
      case 'run_profile':
        toolResult = await this.runProfileTool(args);
        break;
      case 'get_suggestions':
        toolResult = await this.getSuggestionsTool(args);
        break;
      default:
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: 'Method not found' },
        };
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: toolResult,
    };
  }

  // -------------------------------------------------------------------------
  // Tool handlers
  // -------------------------------------------------------------------------

  private async listSessionsTool(args: Record<string, unknown>): Promise<McpToolResult> {
    try {
      const workspacePath = (args['workspacePath'] as string | undefined) ?? this.workspacePath;
      const summaries: SessionSummary[] = await this.persister.list(workspacePath);
      return {
        content: [{ type: 'text', text: JSON.stringify(summaries) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: String(err) }],
        isError: true,
      };
    }
  }

  private async getSessionTool(args: Record<string, unknown>): Promise<McpToolResult> {
    const sessionId = args['sessionId'] as string | undefined;
    if (!sessionId) {
      return {
        content: [{ type: 'text', text: 'Missing required argument: sessionId' }],
        isError: true,
      };
    }
    try {
      const session: ProfileSession = await this.persister.load(sessionId);
      return {
        content: [{ type: 'text', text: JSON.stringify(session) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: String(err) }],
        isError: true,
      };
    }
  }

  private async runProfileTool(args: Record<string, unknown>): Promise<McpToolResult> {
    const filePath = args['filePath'] as string | undefined;
    const language = args['language'] as 'javascript' | 'typescript' | 'python' | undefined;
    const selectedCode = args['selectedCode'] as string | undefined;

    if (!filePath || !language) {
      return {
        content: [{ type: 'text', text: 'Missing required arguments: filePath, language' }],
        isError: true,
      };
    }

    // Validate filePath is within workspacePath
    const resolvedFile = path.resolve(filePath);
    const resolvedWorkspace = path.resolve(this.workspacePath);
    if (!resolvedFile.startsWith(resolvedWorkspace + path.sep) && resolvedFile !== resolvedWorkspace) {
      return {
        content: [{ type: 'text', text: `filePath must be within workspacePath: ${this.workspacePath}` }],
        isError: true,
      };
    }

    const request: RunRequest = { filePath, language, selectedCode };

    let executionResult;

    try {
      // ExecutionRunner doesn't expose the pid mid-run, so MetricsCollector
      // cannot be started here. We aggregate from the result's timing data
      // with zero samples as a fallback.
      executionResult = await this.runner.run(request);
    } catch (err) {
      return {
        content: [{ type: 'text', text: String(err) }],
        isError: true,
      };
    }

    // Aggregate samples (collector was not started since we don't have pid access)
    // Use execution timing from the result
    const executionTimeMs = executionResult.endTime - executionResult.startTime;
    const energyEstimator = await EnergyEstimator.create();
    const summary = aggregateSamples([], executionTimeMs, 0);
    const energyMwh = energyEstimator.estimate(summary.avgCpuPercent, executionTimeMs);
    const metricsWithEnergy = { ...summary, energyMwh };

    const session: ProfileSession = {
      id: uuidv4(),
      workspacePath: this.workspacePath,
      filePath,
      language,
      sessionType: 'profile',
      startTime: executionResult.startTime,
      endTime: executionResult.endTime,
      exitCode: executionResult.exitCode,
      stdout: executionResult.stdout,
      stderr: executionResult.stderr,
      metrics: metricsWithEnergy,
      isBaseline: false,
      optimizationSuggestions: [],
    };

    // Persist the session
    try {
      await this.persister.save(session);
    } catch (err) {
      process.stderr.write(`[McpServer] Failed to save session: ${err}\n`);
    }

    // Get rule-based suggestions
    try {
      const suggestions: OptimizationSuggestion[] = await this.optimizer.suggest(session, '');
      session.optimizationSuggestions = suggestions;
      // Re-save with suggestions attached
      await this.persister.save(session);
    } catch (err) {
      process.stderr.write(`[McpServer] Failed to get suggestions: ${err}\n`);
    }

    const isError = executionResult.exitCode !== 0;
    return {
      content: [{ type: 'text', text: JSON.stringify(session) }],
      ...(isError ? { isError: true } : {}),
    };
  }

  private async getSuggestionsTool(args: Record<string, unknown>): Promise<McpToolResult> {
    const sessionId = args['sessionId'] as string | undefined;
    if (!sessionId) {
      return {
        content: [{ type: 'text', text: 'Missing required argument: sessionId' }],
        isError: true,
      };
    }

    try {
      const session: ProfileSession = await this.persister.load(sessionId);

      if (args['useLlm'] === true) {
        let sourceCode = '';
        try {
          sourceCode = fs.readFileSync(session.filePath, 'utf-8');
        } catch {
          // If file can't be read, proceed with empty source
          process.stderr.write(`[McpServer] Could not read source file: ${session.filePath}\n`);
        }
        const suggestions: OptimizationSuggestion[] = await this.llmOptimizer.suggest(session, sourceCode);
        return {
          content: [{ type: 'text', text: JSON.stringify(suggestions) }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(session.optimizationSuggestions) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: String(err) }],
        isError: true,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private writeResponse(response: McpResponse): void {
    process.stdout.write(JSON.stringify(response) + '\n');
  }
}
