import * as vscode from "vscode";
import { ExecutionRunner } from "./executionRunner";
import { MetricsCollector } from "./metricsCollector";
import { EnergyEstimator } from "./energyEstimator";
import { SessionPersister } from "./sessionPersister";
import { Optimizer } from "./optimizer";
import { Monitor } from "./monitor";
import { ConfigurationManager } from "./configurationManager";
import { DashboardPanel } from "./dashboard/dashboardPanel";
import { aggregateSamples } from "./metricsCollector";
import { v4 as uuidv4 } from "uuid";
import { EcoSpecPredictor } from "./ecospecPredictor";
import { EcoSpecContext } from "./ecospecContext";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const workspacePath =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const configManager = new ConfigurationManager();
  const persister = new SessionPersister(workspacePath);
  const energyEstimator = await EnergyEstimator.create();
  const optimizer = new Optimizer();
  const ecospecPredictor = new EcoSpecPredictor();
  const ecospecContext = new EcoSpecContext();

  // kiro-profiler.profile command
  context.subscriptions.push(
    vscode.commands.registerCommand("kiro-profiler.profile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor to profile.");
        return;
      }

      const config = configManager.getConfig();
      const filePath = editor.document.uri.fsPath;
      const language = detectLanguage(editor.document.languageId);
      if (!language) {
        vscode.window.showWarningMessage(
          "Unsupported language. Supported: JavaScript, TypeScript, Python.",
        );
        return;
      }

      const runner = new ExecutionRunner(config.sampleIntervalMs * 60);
      const collector = new MetricsCollector();

      const dashboard = DashboardPanel.createOrShow(context.extensionUri);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Profiling...",
          cancellable: false,
        },
        async () => {
          // For Python files, get ML prediction first (static analysis)
          let mlPrediction: any = null;
          let hotspots: any = null;
          if (language === "python") {
            try {
              // Get ML prediction
              mlPrediction = await ecospecPredictor.predict(
                editor.document.getText(),
              );
              if (mlPrediction && !mlPrediction.error) {
                vscode.window.showInformationMessage(
                  `EcoSpec ML Prediction: ${mlPrediction.energy_wh.toExponential(2)} Wh ` +
                    `(${mlPrediction.complexity_label}, ${mlPrediction.warning_level} risk)`,
                );
              }

              // Get energy hotspots
              hotspots = await ecospecContext.findEnergyHotspots(filePath);
              if (hotspots && hotspots.length > 0) {
                console.log(
                  `Found ${hotspots.length} energy hotspot(s) in ${filePath}`,
                );
              }
            } catch (error) {
              console.error("EcoSpec analysis failed:", error);
            }
          }

          const result = await runner.run({
            filePath,
            language,
            runtimePath:
              config.runtimePaths[
                language === "javascript" || language === "typescript"
                  ? "node"
                  : "python"
              ],
          });

          const samples = collector.getSamples();
          const executionTimeMs = result.endTime - result.startTime;
          const avgCpu =
            samples.length > 0
              ? samples.reduce((s, x) => s + x.cpuPercent, 0) / samples.length
              : 0;
          const energyMwh = energyEstimator.estimate(avgCpu, executionTimeMs);

          const metrics = aggregateSamples(samples, executionTimeMs, energyMwh);

          const partialSession = {
            id: "",
            workspacePath,
            filePath,
            language,
            sessionType: "profile" as const,
            startTime: result.startTime,
            endTime: result.endTime,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            metrics,
            isBaseline: false,
            optimizationSuggestions: [],
          };

          const suggestions = await optimizer.suggest(
            partialSession,
            editor.document.getText(),
            mlPrediction,
            hotspots,
          );

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
        },
      );
    }),
  );

  // kiro-profiler.monitor command
  context.subscriptions.push(
    vscode.commands.registerCommand("kiro-profiler.monitor", async () => {
      const pidStr = await vscode.window.showInputBox({
        prompt: "Enter PID to monitor (or leave empty to launch active file)",
      });

      const config = configManager.getConfig();
      const monitorConfig = {
        sampleIntervalMs: config.sampleIntervalMs,
        ramAlertThresholdMb: config.ramAlertThresholdMb,
        cpuAlertThresholdPercent: config.cpuAlertThresholdPercent,
      };

      const dashboard = DashboardPanel.createOrShow(context.extensionUri);
      const monitor = new Monitor();

      monitor.on("sample", (_sample) => {
        dashboard.showSessions([]);
      });

      monitor.on("alert", (alert) => {
        dashboard.showAlert(alert);
      });

      if (pidStr && !isNaN(parseInt(pidStr))) {
        monitor.attach(parseInt(pidStr), monitorConfig);
      } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage("No active editor.");
          return;
        }
        const language = detectLanguage(editor.document.languageId);
        if (!language) {
          vscode.window.showWarningMessage("Unsupported language.");
          return;
        }
        await monitor.launch(
          { filePath: editor.document.uri.fsPath, language },
          monitorConfig,
        );
      }

      const stopAction = await vscode.window.showInformationMessage(
        "Monitoring started. Click Stop to end.",
        "Stop",
      );
      if (stopAction === "Stop") {
        const session = await monitor.stop();
        session.workspacePath = workspacePath;
        await persister.save(session);
        dashboard.showSession(session);
      }
    }),
  );

  // kiro-profiler.showDashboard command
  context.subscriptions.push(
    vscode.commands.registerCommand("kiro-profiler.showDashboard", async () => {
      const dashboard = DashboardPanel.createOrShow(context.extensionUri);
      const sessions = await persister.list(workspacePath);
      dashboard.showSessions(sessions);
    }),
  );

  // kiro-profiler.clearHistory command
  context.subscriptions.push(
    vscode.commands.registerCommand("kiro-profiler.clearHistory", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Clear all profiling history?",
        "Yes",
        "No",
      );
      if (confirm === "Yes") {
        await persister.clear(workspacePath);
        vscode.window.showInformationMessage("Profiling history cleared.");
        if (DashboardPanel.currentPanel) {
          DashboardPanel.currentPanel.showSessions([]);
        }
      }
    }),
  );

  // kiro-profiler.findHotspots command
  context.subscriptions.push(
    vscode.commands.registerCommand("kiro-profiler.findHotspots", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor.");
        return;
      }

      const language = detectLanguage(editor.document.languageId);
      if (language !== "python") {
        vscode.window.showWarningMessage(
          "Energy hotspot detection is only available for Python files.",
        );
        return;
      }

      const filePath = editor.document.uri.fsPath;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Finding energy hotspots...",
          cancellable: false,
        },
        async () => {
          try {
            const hotspots = await ecospecContext.findEnergyHotspots(filePath);

            if (hotspots.length === 0) {
              vscode.window.showInformationMessage(
                "No energy hotspots found. Your code looks efficient!",
              );
              return;
            }

            // Show hotspots in a quick pick
            const items = hotspots.map((h) => ({
              label: `$(warning) ${h.name}`,
              description: `Line ${h.lineno}`,
              detail: `Complexity: ${h.complexity}, Loop depth: ${h.loop_depth} - ${h.reason}`,
              hotspot: h,
            }));

            const selected = await vscode.window.showQuickPick(items, {
              placeHolder: `Found ${hotspots.length} energy hotspot(s)`,
              title: "Energy Hotspots",
            });

            if (selected) {
              // Jump to the hotspot line
              const position = new vscode.Position(
                selected.hotspot.lineno - 1,
                0,
              );
              editor.selection = new vscode.Selection(position, position);
              editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter,
              );

              // Show detailed info
              vscode.window.showInformationMessage(
                `${selected.hotspot.name}: ${selected.hotspot.reason}`,
              );
            }
          } catch (error) {
            console.error("Failed to find hotspots:", error);
            vscode.window.showErrorMessage(
              "Failed to analyze energy hotspots. Check console for details.",
            );
          }
        },
      );
    }),
  );
}

function detectLanguage(
  languageId: string,
): "javascript" | "typescript" | "python" | null {
  switch (languageId) {
    case "javascript":
      return "javascript";
    case "typescript":
      return "typescript";
    case "python":
      return "python";
    default:
      return null;
  }
}

export function deactivate(): void {}
