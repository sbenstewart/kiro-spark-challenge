import * as vscode from 'vscode';
import { ExecutionRunner } from './executionRunner';
import { MetricsCollector } from './metricsCollector';
import { McpServer } from './mcp/server';
import { EnergyEstimator } from './energyEstimator';
import { SessionPersister } from './sessionPersister';
import { Optimizer } from './optimizer';
import { LlmOptimizer } from './llmOptimizer';
import { Monitor } from './monitor';
import { ConfigurationManager } from './configurationManager';
import { DashboardPanel } from './dashboard/dashboardPanel';
import { aggregateSamples } from './metricsCollector';
import { applyUnifiedDiff } from './diffApplier';
import { v4 as uuidv4 } from 'uuid';
import { OptimizationSuggestion, ProfileSession, SessionSummary } from './types';
import { CarbonEthicsGate } from './ethicsGate';
import { computeGreenScore } from './greenScorer';
import { calculateCarbonImpact } from './carbonCalculator';
import { buildRuntimeCommand } from './runtimeCommandResolver';

// Map from sessionId → Set of rejected suggestionIds
export const rejectedSuggestions = new Map<string, Set<string>>();

// Map from suggestionId → OptimizationSuggestion (active suggestions)
export const activeSuggestions = new Map<string, OptimizationSuggestion>();

// Map from suggestionId → filePath (so accept works without an active editor)
export const suggestionFilePaths = new Map<string, string>();

/** Spawn a process, sample it live, and return result + metrics. */
async function profileWithLiveSampling(
  filePath: string,
  language: 'javascript' | 'typescript' | 'python',
  config: import('./types').ProfilerConfig,
  energyEstimator: EnergyEstimator
): Promise<{ result: import('./types').ExecutionResult; metrics: import('./types').MetricsSummary }> {
  const { spawn } = require('child_process') as typeof import('child_process');
  const collector = new MetricsCollector();

  const runtimePath = language === 'python'
    ? config.runtimePaths['python']
    : config.runtimePaths['node'];
  const cmd_args = buildRuntimeCommand(language, filePath, runtimePath);

  const result = await new Promise<import('./types').ExecutionResult>((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(cmd_args.cmd, cmd_args.args, { stdio: ['ignore', 'pipe', 'pipe'] });

    if (child.pid) {
      collector.start(child.pid, Math.max(config.sampleIntervalMs, 200));
    }

    child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      if (settled) { return; }
      settled = true;
      child.kill('SIGKILL');
      resolve({ exitCode: -1, stdout, stderr: stderr + '\nProcess timed out', startTime, endTime: Date.now() });
    }, 300_000);

    child.on('close', (code: number | null) => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr, startTime, endTime: Date.now() });
    });

    child.on('error', (err: Error) => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr: stderr + `\nFailed to spawn: ${err.message}`, startTime, endTime: Date.now() });
    });
  });

  const summary = collector.stop();
  const executionTimeMs = result.endTime - result.startTime;
  const samples = summary.samples;
  const avgCpu = samples.length > 0 ? samples.reduce((s, x) => s + x.cpuPercent, 0) / samples.length : 0;
  const energyMwh = samples.length === 0 ? 0 : energyEstimator.estimate(avgCpu, executionTimeMs);
  const metrics = {
    ...aggregateSamples(samples, executionTimeMs, energyMwh),
    sampleCount: summary.sampleCount,
    dataStatus: summary.dataStatus,
    dataWarning: summary.dataWarning,
  };

  if (samples.length === 0 && result.exitCode !== 0) {
    metrics.dataStatus = 'error';
    metrics.dataWarning = 'Execution finished before metrics were collected. Check stderr for the runtime error details.';
  }

  return { result, metrics };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const configManager = new ConfigurationManager();
  const persister = new SessionPersister(workspacePath);
  const optimizer = new Optimizer();
  const runner = new ExecutionRunner();
  const llmOptimizer = new LlmOptimizer(context.secrets);

  // Lazy energy estimator — EnergyEstimator.create() calls si.cpu() which is slow (1-3s).
  // Deferring it to first profile use keeps activation instant.
  let energyEstimatorPromise: Promise<EnergyEstimator> | null = null;
  function getEnergyEstimator(): Promise<EnergyEstimator> {
    if (!energyEstimatorPromise) {
      energyEstimatorPromise = EnergyEstimator.create();
    }
    return energyEstimatorPromise;
  }

  // Lazy MCP server — only start it when the user first triggers a relevant command.
  let mcpServer: McpServer | null = null;
  function getMcpServer(): McpServer {
    if (!mcpServer) {
      mcpServer = new McpServer(persister, runner, optimizer, llmOptimizer, workspacePath);
      mcpServer.start();
    }
    return mcpServer;
  }
  context.subscriptions.push({ dispose: () => mcpServer?.stop() });

  async function loadBaselineSession(summaries?: SessionSummary[]): Promise<ProfileSession | undefined> {
    const sessionSummaries = summaries ?? await persister.list(workspacePath);
    const baselineSummary = sessionSummaries.find((session) => session.isBaseline);
    if (!baselineSummary) {
      return undefined;
    }

    try {
      return await persister.load(baselineSummary.id);
    } catch {
      return undefined;
    }
  }

  async function showDashboardState(
    dashboard: DashboardPanel,
    session?: ProfileSession,
    overrideSuggestions?: OptimizationSuggestion[]
  ): Promise<SessionSummary[]> {
    const sessions = await persister.list(workspacePath);
    dashboard.showSessions(sessions);

    const notices: string[] = [];
    const diagnostics = persister.getLastListDiagnostics(workspacePath);
    if (diagnostics.malformedCount > 0) {
      const suffix = diagnostics.malformedCount === 1 ? '' : 's';
      notices.push(`Skipped ${diagnostics.malformedCount} malformed session file${suffix} in history.`);
    }

    if (session) {
      const baselineSession = await loadBaselineSession(sessions);
      dashboard.showSession(session, baselineSession);
      dashboard.showSuggestions(overrideSuggestions ?? session.optimizationSuggestions);

      if (session.metrics.dataWarning) {
        notices.unshift(session.metrics.dataWarning);
      }
    }

    if (notices.length > 0) {
      const tone = session?.metrics.dataStatus === 'error' ? 'error' : 'warning';
      dashboard.showStatus(notices.join(' '), tone);
    } else {
      dashboard.clearStatus();
    }

    return sessions;
  }

  // kiro-profiler.profile command
  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.profile', async () => {
      getMcpServer();
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor to profile.');
        return;
      }

      const config = configManager.getConfig();
      const filePath = editor.document.uri.fsPath;
      const language = detectLanguage(editor.document.languageId);
      if (!language) {
        vscode.window.showWarningMessage('Unsupported language. Supported: JavaScript, TypeScript, Python.');
        return;
      }

      const dashboard = DashboardPanel.createOrShow(context.extensionUri, context.secrets);

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Profiling...', cancellable: false },
        async () => {
          const { result, metrics } = await profileWithLiveSampling(filePath, language, config, await getEnergyEstimator());

          const partialSession = {
            id: '',
            workspacePath,
            filePath,
            language,
            sessionType: 'profile' as const,
            startTime: result.startTime,
            endTime: result.endTime,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            metrics,
            isBaseline: false,
            optimizationSuggestions: [],
          };

          const suggestions = await optimizer.suggest(partialSession, editor.document.getText());

          const session = {
            ...partialSession,
            id: uuidv4(),
            optimizationSuggestions: suggestions,
          };

          await persister.save(session);
          await showDashboardState(dashboard, session, suggestions);

          if ((metrics.sampleCount ?? 0) > 0) {
            // Compute green score and carbon impact from measured energy
            const greenScore = computeGreenScore(metrics.energyMwh);
            const carbonImpact = calculateCarbonImpact(metrics.energyMwh);

            // Surface green score in the VS Code status notification
            const annualG = carbonImpact.annualCo2Grams;
            const annualStr = annualG < 1
              ? `${(annualG * 1000).toFixed(2)}mg`
              : `${annualG.toFixed(2)}g`;
            vscode.window.setStatusBarMessage(
              `EcoTrace: Grade ${greenScore.grade} (${greenScore.score}/100) · ${annualStr} CO₂/year`,
              8000
            );

            // Ethics Logic Gate: check projected annual CO₂ against configured budget
            const carbonBudget = config.carbonBudgetGramsPerYear;
            if (carbonBudget > 0) {
              const gate = new CarbonEthicsGate();
              const gateResult = gate.check(metrics.energyMwh, carbonBudget);
              if (gateResult.blocked) {
                vscode.window.showWarningMessage(`🌍 Ethics Gate: ${gateResult.message}`);
              }
              dashboard.showCarbonGateResult(gateResult);
            }
          } else if (metrics.dataWarning) {
            vscode.window.showWarningMessage(metrics.dataWarning);
          }
        }
      );
    })
  );

  // kiro-profiler.monitor command
  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.monitor', async () => {
      getMcpServer();
      const pidStr = await vscode.window.showInputBox({
        prompt: 'Enter PID to monitor (or leave empty to launch active file)',
      });

      const config = configManager.getConfig();
      const monitorConfig = {
        sampleIntervalMs: config.sampleIntervalMs,
        ramAlertThresholdMb: config.ramAlertThresholdMb,
        cpuAlertThresholdPercent: config.cpuAlertThresholdPercent,
      };

      const dashboard = DashboardPanel.createOrShow(context.extensionUri, context.secrets);
      const monitor = new Monitor();
      await showDashboardState(dashboard);

      monitor.on('sample', (sample) => {
        dashboard.showLiveSample(sample);
      });

      monitor.on('alert', (alert) => {
        dashboard.showAlert(alert);
      });

      if (pidStr && !isNaN(parseInt(pidStr))) {
        monitor.attach(parseInt(pidStr, 10), monitorConfig, {
          filePath: `PID ${parseInt(pidStr, 10)}`,
          language: 'javascript',
        });
      } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('No active editor.');
          return;
        }
        const language = detectLanguage(editor.document.languageId);
        if (!language) {
          vscode.window.showWarningMessage('Unsupported language.');
          return;
        }
        await monitor.launch({ filePath: editor.document.uri.fsPath, language }, monitorConfig);
      }

      dashboard.startMonitoring();

      const stopAction = await vscode.window.showInformationMessage(
        'Monitoring started. Click Stop to end.',
        'Stop'
      );
      if (stopAction === 'Stop') {
        const session = await monitor.stop();
        dashboard.stopMonitoring();
        session.workspacePath = workspacePath;
        await persister.save(session);
        await showDashboardState(dashboard, session);
      }
    })
  );

  // kiro-profiler.showDashboard command
  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.showDashboard', async () => {
      getMcpServer();
      const dashboard = DashboardPanel.createOrShow(context.extensionUri, context.secrets);
      const sessions = await showDashboardState(dashboard);
      if (sessions.length > 0) {
        try {
          const session = await persister.load(sessions[0].id);
          await showDashboardState(dashboard, session);
        } catch {
          vscode.window.showWarningMessage('Could not load the most recent profiling session.');
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.loadSession', async (sessionId: string) => {
      const dashboard = DashboardPanel.createOrShow(context.extensionUri, context.secrets);
      try {
        const session = await persister.load(sessionId);
        await showDashboardState(dashboard, session);
      } catch {
        vscode.window.showWarningMessage('Could not load the requested session.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.markBaseline', async (sessionId: string) => {
      const summaries = await persister.list(workspacePath);
      let updatedBaseline: ProfileSession | undefined;

      for (const summary of summaries) {
        if (summary.id !== sessionId && !summary.isBaseline) {
          continue;
        }

        try {
          const session = await persister.load(summary.id);
          const isBaseline = session.id === sessionId;
          if (session.isBaseline !== isBaseline) {
            const updatedSession = { ...session, isBaseline };
            await persister.save(updatedSession);
            if (isBaseline) {
              updatedBaseline = updatedSession;
            }
          } else if (isBaseline) {
            updatedBaseline = session;
          }
        } catch {
          // Ignore malformed or concurrently removed history entries.
        }
      }

      if (!updatedBaseline) {
        vscode.window.showWarningMessage('Could not mark the requested session as baseline.');
        return;
      }

      const dashboard = DashboardPanel.createOrShow(context.extensionUri, context.secrets);
      await showDashboardState(dashboard, updatedBaseline);
      vscode.window.showInformationMessage('Baseline session updated.');
    })
  );

  // kiro-profiler.clearHistory command
  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.clearHistory', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all profiling history?',
        'Yes',
        'No'
      );
      if (confirm === 'Yes') {
        await persister.clear(workspacePath);
        vscode.window.showInformationMessage('Profiling history cleared.');
        if (DashboardPanel.currentPanel) {
          DashboardPanel.currentPanel.showSessions([]);
          DashboardPanel.currentPanel.clearStatus();
        }
      }
    })
  );

  // kiro-profiler.optimizeWithLLM command
  // Accepts an optional sessionId argument (forwarded from the dashboard).
  // When invoked from the editor context menu, falls back to the active editor's file.
  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.optimizeWithLLM', async (sessionIdArg?: string) => {
      getMcpServer();
      let session;
      let sourceCode: string;

      if (typeof sessionIdArg === 'string') {
        // Invoked from the dashboard — load session directly by id
        try {
          session = await persister.load(sessionIdArg);
        } catch {
          // Session file not found by id — fall back to most recent session
          const allSessions = await persister.list(workspacePath);
          const summary = allSessions[0];
          if (!summary) {
            vscode.window.showWarningMessage('No profiling sessions found. Profile a file first.');
            return;
          }
          try {
            session = await persister.load(summary.id);
          } catch {
            vscode.window.showWarningMessage('Could not load the requested session.');
            return;
          }
        }
        // Read source from disk (the file may not be open in an editor)
        try {
          const doc = await vscode.workspace.openTextDocument(session.filePath);
          sourceCode = doc.getText();
        } catch {
          vscode.window.showWarningMessage(`Could not open file: ${session.filePath}`);
          return;
        }
      } else {
        // Invoked from the editor context menu — use the active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('No active editor.');
          return;
        }
        const filePath = editor.document.uri.fsPath;
        const allSessions = await persister.list(workspacePath);
        const sessionSummary = allSessions.find((s) => s.filePath === filePath);
        if (!sessionSummary) {
          vscode.window.showWarningMessage('Profile this file first before requesting optimization.');
          return;
        }
        session = await persister.load(sessionSummary.id);
        sourceCode = editor.document.getText();
      }

      let suggestions: OptimizationSuggestion[];
      try {
        suggestions = await llmOptimizer.suggest(session, sourceCode);
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`[v2] LLM optimization failed: ${reason}`);
        return;
      }

      // Populate activeSuggestions map and record the file path for each suggestion
      for (const suggestion of suggestions) {
        activeSuggestions.set(suggestion.id, suggestion);
        suggestionFilePaths.set(suggestion.id, session.filePath);
      }

      // Show suggestions in the dashboard
      const dashboard = DashboardPanel.createOrShow(context.extensionUri, context.secrets);
      await showDashboardState(dashboard, session, suggestions);

      if (suggestions.length === 0) {
        vscode.window.showInformationMessage('No optimization suggestions were returned for this session.');
        return;
      }

      const chatMessage = suggestions.map((suggestion, index) => {
        const impactPct = Math.round(suggestion.estimatedImpact * 100);
        return `### ${index + 1}. ${suggestion.title}\n\n` +
          `${suggestion.explanation}\n\n` +
          `Estimated impact: **${impactPct}%** on \`${suggestion.affectedMetric}\`\n\n` +
          `\`\`\`diff\n${suggestion.diff}\n\`\`\``;
      }).join('\n\n');

      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: chatMessage,
      });
    })
  );
  // kiro-profiler.acceptSuggestion command
  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.acceptSuggestion', async (suggestionId: string) => {
      const suggestion = activeSuggestions.get(suggestionId);
      if (!suggestion) {
        vscode.window.showErrorMessage(`Suggestion not found: ${suggestionId}`);
        return;
      }

      // Resolve file path directly from the suggestion — no active editor needed
      const filePath = suggestionFilePaths.get(suggestionId);
      if (!filePath) {
        vscode.window.showErrorMessage('Could not determine file for this suggestion. Please re-run LLM optimization.');
        return;
      }

      // Find the matching session for re-profiling after apply
      const allSessions = await persister.list(workspacePath);
      const sessionSummary = allSessions.find((s) => s.filePath === filePath) ?? allSessions[0];
      if (!sessionSummary) {
        vscode.window.showWarningMessage('No profiling session found.');
        return;
      }
      const originalSession = await persister.load(sessionSummary.id);

      // Open the document by path (no active editor needed)
      let document: vscode.TextDocument;
      try {
        document = await vscode.workspace.openTextDocument(filePath);
      } catch {
        vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
        return;
      }

      const currentContent = document.getText();
      const patched = applyUnifiedDiff(currentContent, suggestion.diff);

      if (patched === null) {
        // Diff couldn't apply cleanly — remove this suggestion from the dashboard
        // since it's no longer valid against the current file state
        vscode.window.showWarningMessage(
          `Could not apply "${suggestion.title}": the file has changed since this suggestion was generated. Skipping.`
        );
        activeSuggestions.delete(suggestionId);
        const dashboard = DashboardPanel.createOrShow(context.extensionUri, context.secrets);
        dashboard.removeSuggestion(suggestionId);
        return;
      }

      // Write the full updated content back to the file
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(currentContent.length)
      );
      edit.replace(document.uri, fullRange, patched);
      await vscode.workspace.applyEdit(edit);
      await document.save();

      vscode.window.showInformationMessage('Optimization applied successfully.');
      activeSuggestions.delete(suggestionId);
      suggestionFilePaths.delete(suggestionId);

      // Tell the dashboard to remove just this suggestion (keep the rest)
      const dashboard = DashboardPanel.createOrShow(context.extensionUri, context.secrets);
      dashboard.removeSuggestion(suggestionId);

      // Show the file in a side editor so the user can see the changes
      await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside, true);
    })
  );
  // kiro-profiler.rejectSuggestion command
  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.rejectSuggestion', async (suggestionId: string) => {
      // 5.1 Determine current sessionId from the most recent session for the active file
      const editor = vscode.window.activeTextEditor;
      const filePath = editor?.document.uri.fsPath;
      const allSessions = await persister.list(workspacePath);
      const sessionSummary = filePath
        ? allSessions.find((s) => s.filePath === filePath)
        : allSessions[0];

      const sessionId = sessionSummary?.id ?? '__default__';

      // 5.1 Add suggestionId to rejectedSuggestions for this session
      if (!rejectedSuggestions.has(sessionId)) {
        rejectedSuggestions.set(sessionId, new Set());
      }
      rejectedSuggestions.get(sessionId)!.add(suggestionId);

      // 5.1 Remove from activeSuggestions
      activeSuggestions.delete(suggestionId);
      suggestionFilePaths.delete(suggestionId);

      // 5.2 Send updated (filtered) suggestion list to dashboard
      const rejectedForSession = rejectedSuggestions.get(sessionId)!;
      const updatedList = Array.from(activeSuggestions.values()).filter(
        (s) => !rejectedForSession.has(s.id)
      );

      if (DashboardPanel.currentPanel) {
        DashboardPanel.currentPanel.showSuggestions(updatedList);
      }
    })
  );
  // kiro-profiler.acceptAllSuggestions command
  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.acceptAllSuggestions', async () => {
      const allSuggestions = Array.from(activeSuggestions.values()).sort(
        (a, b) => b.estimatedImpact - a.estimatedImpact
      );

      if (allSuggestions.length === 0) {
        vscode.window.showInformationMessage('No active suggestions to apply.');
        return;
      }

      // Resolve file from suggestionFilePaths — no active editor needed
      // Group suggestions by file path
      const byFile = new Map<string, typeof allSuggestions>();
      for (const s of allSuggestions) {
        const fp = suggestionFilePaths.get(s.id);
        if (!fp) continue;
        if (!byFile.has(fp)) { byFile.set(fp, []); }
        byFile.get(fp)!.push(s);
      }

      if (byFile.size === 0) {
        vscode.window.showWarningMessage('Could not determine file paths for suggestions. Please re-run LLM optimization.');
        return;
      }

      // Use the first (and typically only) file path for session lookup and re-profiling
      const targetFilePath = byFile.keys().next().value as string;
      const allSessions = await persister.list(workspacePath);
      const sessionSummary = allSessions.find((s) => s.filePath === targetFilePath) ?? allSessions[0];
      if (!sessionSummary) {
        vscode.window.showWarningMessage('No profiling session found.');
        return;
      }
      const originalSession = await persister.load(sessionSummary.id);

      let document: vscode.TextDocument;
      try {
        document = await vscode.workspace.openTextDocument(targetFilePath);
      } catch {
        vscode.window.showErrorMessage(`Could not open file: ${targetFilePath}`);
        return;
      }

      const total = allSuggestions.length;
      let applied = 0;
      let currentContent = document.getText();

      // 6.2 Apply each diff sequentially; on failure skip and record warning, continue
      for (const suggestion of allSuggestions) {
        const patched = applyUnifiedDiff(currentContent, suggestion.diff);
        if (patched === null) {
          console.warn(`[acceptAllSuggestions] Skipping suggestion "${suggestion.id}": diff could not be applied.`);
          continue;
        }
        currentContent = patched;
        activeSuggestions.delete(suggestion.id);
        suggestionFilePaths.delete(suggestion.id);
        applied++;
      }

      // Write the final accumulated content back to the file once
      if (applied > 0) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length)
        );
        edit.replace(document.uri, fullRange, currentContent);
        await vscode.workspace.applyEdit(edit);
        await document.save();
      }

      // 6.3 Show summary and trigger re-profile
      vscode.window.showInformationMessage(`Applied ${applied} of ${total} suggestions. Re-profiling…`);

      if (applied === 0) {
        return;
      }

      const config = configManager.getConfig();
      const { result, metrics } = await profileWithLiveSampling(
        originalSession.filePath, originalSession.language, config, await getEnergyEstimator()
      );

      const newSession = {
        id: uuidv4(),
        workspacePath,
        filePath: originalSession.filePath,
        language: originalSession.language,
        sessionType: 'profile' as const,
        startTime: result.startTime,
        endTime: result.endTime,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        metrics,
        isBaseline: false,
        optimizationSuggestions: [],
        linkedPreSessionId: originalSession.id,
      };

      if (result.exitCode !== 0) {
        vscode.window.showWarningMessage('Re-profile completed with errors. Check the dashboard for details.');
      }

      await persister.save(newSession);
      const dashboard = DashboardPanel.createOrShow(context.extensionUri, context.secrets);
      await showDashboardState(dashboard, newSession);
      dashboard.showImprovement(originalSession, newSession);
    })
  );
}

function detectLanguage(languageId: string): 'javascript' | 'typescript' | 'python' | null {
  switch (languageId) {
    case 'javascript': return 'javascript';
    case 'typescript': return 'typescript';
    case 'python': return 'python';
    default: return null;
  }
}

export function deactivate(): void {}
