# Kiro Code Profiler

Measure, analyze, and optimize the resource usage of your code directly from within Kiro.

Profile Node.js and Python scripts to capture CPU, RAM, and energy estimates. Run continuous monitoring with configurable alerts, and review historical sessions in the built-in dashboard.

---

## Installation (from VSIX)

1. Open Kiro.
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
3. Run **Extensions: Install from VSIX...**.
4. Select the `.vsix` file you downloaded.
5. Reload Kiro when prompted.

---

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

| Command | Description |
|---|---|
| **Kiro Profiler: Profile** | Run the active file once and capture a full resource snapshot (CPU, RAM, duration, energy estimate). |
| **Kiro Profiler: Monitor** | Start continuous monitoring of the active file, sampling metrics at the configured interval and alerting when thresholds are exceeded. |
| **Kiro Profiler: Show Dashboard** | Open the webview dashboard to browse and compare historical profiling sessions. |
| **Kiro Profiler: Clear History** | Delete all stored profiling sessions from disk. |

---

## Configuration

Settings are available under **Kiro Code Profiler** in the Settings UI, or directly in `settings.json`.

| Setting | Type | Default | Description |
|---|---|---|---|
| `kiro-profiler.ramAlertThresholdMb` | number | `512` | RAM usage (MB) above which a monitoring alert fires. |
| `kiro-profiler.cpuAlertThresholdPercent` | number | `80` | CPU usage (0–100) above which a monitoring alert fires. |
| `kiro-profiler.sampleIntervalMs` | number | `1000` | Milliseconds between metric samples during monitoring. Minimum: `100`. |
| `kiro-profiler.runtimePaths.node` | string | `null` | Path to the Node.js executable. Leave empty to use the system default. |
| `kiro-profiler.runtimePaths.python` | string | `null` | Path to the Python executable. Leave empty to use the system default. |

---

## Basic Usage

1. Open a Node.js (`.js` / `.ts`) or Python (`.py`) file in the editor.
2. Run **Kiro Profiler: Profile** to capture a one-shot snapshot. Results appear in the notification area and are saved to history.
3. Run **Kiro Profiler: Monitor** to start live monitoring. Alerts fire when CPU or RAM exceed your configured thresholds. Stop monitoring by running the command again or closing the session.
4. Run **Kiro Profiler: Show Dashboard** to open the dashboard, where you can compare sessions, view trends, and inspect optimization suggestions.
5. Run **Kiro Profiler: Clear History** to remove all saved sessions when you want a clean slate.

---

## License

MIT
