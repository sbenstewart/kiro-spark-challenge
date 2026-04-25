import * as vscode from 'vscode';
import * as fs from 'fs';
import { MetricAlert, OptimizationSuggestion, ProfileSession, SessionSummary } from '../types';

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly _secrets?: vscode.SecretStorage
  ) {
    this._panel = panel;
    this._panel.webview.html = this._getHtmlContent(extensionUri);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'markBaseline':
            vscode.commands.executeCommand('kiro-profiler.markBaseline', message.sessionId);
            break;
          case 'loadSession':
            vscode.commands.executeCommand('kiro-profiler.loadSession', message.sessionId);
            break;
          case 'acceptSuggestion':
            vscode.commands.executeCommand('kiro-profiler.acceptSuggestion', message.suggestionId);
            break;
          case 'rejectSuggestion':
            vscode.commands.executeCommand('kiro-profiler.rejectSuggestion', message.suggestionId);
            break;
          case 'requestLLMOptimization':
            vscode.commands.executeCommand('kiro-profiler.optimizeWithLLM', message.sessionId);
            break;
          case 'acceptAllSuggestions':
            vscode.commands.executeCommand('kiro-profiler.acceptAllSuggestions');
            break;
          case 'saveApiKey':
            if (this._secrets && typeof message.apiKey === 'string' && message.apiKey.trim()) {
              await this._secrets.store('kiro-profiler.openaiApiKey', message.apiKey.trim());
              this._panel.webview.postMessage({ type: 'apiKeySaved' });
              vscode.window.showInformationMessage('OpenAI API key saved.');
            }
            break;
        }
      },
      null,
      this._disposables
    );
  }

  static createOrShow(extensionUri: vscode.Uri, secrets?: vscode.SecretStorage): DashboardPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel._panel.reveal(column);
      return DashboardPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'kiroProfilerDashboard',
      'Kiro Profiler Dashboard',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'src', 'dashboard'),
          vscode.Uri.joinPath(extensionUri, 'out', 'dashboard'),
        ],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, secrets);
    return DashboardPanel.currentPanel;
  }

  showSession(session: ProfileSession): void {
    this._panel.webview.postMessage({ type: 'showSession', session });
  }

  showSessions(sessions: SessionSummary[]): void {
    this._panel.webview.postMessage({ type: 'showSessions', sessions });
  }

  showAlert(alert: MetricAlert): void {
    this._panel.webview.postMessage({ type: 'alert', alert });
  }

  showSuggestions(suggestions: OptimizationSuggestion[]): void {
    this._panel.webview.postMessage({ type: 'showSuggestions', suggestions });
  }

  removeSuggestion(suggestionId: string): void {
    this._panel.webview.postMessage({ type: 'removeSuggestion', suggestionId });
  }

  showImprovement(original: ProfileSession, updated: ProfileSession): void {
    this._panel.webview.postMessage({ type: 'showImprovement', original, updated });
  }

  private _getHtmlContent(extensionUri: vscode.Uri): string {
    // Try out/dashboard first (packaged), fall back to src/dashboard (dev)
    const candidates = [
      vscode.Uri.joinPath(extensionUri, 'out', 'dashboard', 'webview.html'),
      vscode.Uri.joinPath(extensionUri, 'src', 'dashboard', 'webview.html'),
    ];
    for (const uri of candidates) {
      try {
        return fs.readFileSync(uri.fsPath, 'utf8');
      } catch {
        // try next
      }
    }
    return '<html><body><p>Dashboard failed to load.</p></body></html>';
  }

  dispose(): void {
    DashboardPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}
