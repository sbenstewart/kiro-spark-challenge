import * as vscode from 'vscode';
import { ExecutionRunner } from './executionRunner';
import { MetricsCollector } from './metricsCollector';
import { EnergyEstimator } from './energyEstimator';
import { SessionPersister } from './sessionPersister';
import { Optimizer } from './optimizer';
import { Monitor } from './monitor';
import { ConfigurationManager } from './configurationManager';
import { DashboardPanel } from './dashboard/dashboardPanel';
import { GreenOptimizerPanel } from './greenOptimizer/greenPanel';
import { aggregateSamples } from './metricsCollector';
import { v4 as uuidv4 } from 'uuid';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const configManager = new ConfigurationManager();
  const persister = new SessionPersister(workspacePath);
  const energyEstimator = await EnergyEstimator.create();
  const optimizer = new Optimizer();

  // kiro-profiler.profile command
  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.profile', async () => {
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

      const runner = new ExecutionRunner(config.sampleIntervalMs * 60);
      const collector = new MetricsCollector();

      const dashboard = DashboardPanel.createOrShow(context.extensionUri);

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Profiling...', cancellable: false },
        async () => {
          const result = await runner.run({
            filePath,
            language,
            runtimePath: config.runtimePaths[language === 'javascript' || language === 'typescript' ? 'node' : 'python'],
          });

          const samples = collector.getSamples();
          const executionTimeMs = result.endTime - result.startTime;
          const avgCpu = samples.length > 0
            ? samples.reduce((s, x) => s + x.cpuPercent, 0) / samples.length
            : 0;
          const energyMwh = energyEstimator.estimate(avgCpu, executionTimeMs);

          const metrics = aggregateSamples(samples, executionTimeMs, energyMwh);

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
          dashboard.showSession(session);
          dashboard.showSuggestions(suggestions);

          const sessions = await persister.list(workspacePath);
          dashboard.showSessions(sessions);
        }
      );
    })
  );

  // kiro-profiler.monitor command
  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.monitor', async () => {
      const pidStr = await vscode.window.showInputBox({
        prompt: 'Enter PID to monitor (or leave empty to launch active file)',
      });

      const config = configManager.getConfig();
      const monitorConfig = {
        sampleIntervalMs: config.sampleIntervalMs,
        ramAlertThresholdMb: config.ramAlertThresholdMb,
        cpuAlertThresholdPercent: config.cpuAlertThresholdPercent,
      };

      const dashboard = DashboardPanel.createOrShow(context.extensionUri);
      const monitor = new Monitor();

      monitor.on('sample', (_sample) => {
        dashboard.showSessions([]);
      });

      monitor.on('alert', (alert) => {
        dashboard.showAlert(alert);
      });

      if (pidStr && !isNaN(parseInt(pidStr))) {
        monitor.attach(parseInt(pidStr), monitorConfig);
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

      const stopAction = await vscode.window.showInformationMessage(
        'Monitoring started. Click Stop to end.',
        'Stop'
      );
      if (stopAction === 'Stop') {
        const session = await monitor.stop();
        session.workspacePath = workspacePath;
        await persister.save(session);
        dashboard.showSession(session);
      }
    })
  );

  // kiro-profiler.showDashboard command
  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.showDashboard', async () => {
      const dashboard = DashboardPanel.createOrShow(context.extensionUri);
      const sessions = await persister.list(workspacePath);
      dashboard.showSessions(sessions);
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
        }
      }
    })
  );

  // kiro-profiler.greenOptimize command — Green Code Optimizer
  context.subscriptions.push(
    vscode.commands.registerCommand('kiro-profiler.greenOptimize', () => {
      GreenOptimizerPanel.createOrShow(context.extensionUri);
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
