---
inclusion: always
---

# kiro-code-profiler Architecture

## Component Pipeline

The profiler transforms a run request into a persisted, optimized session through this ordered chain:

**ExecutionRunner → MetricsCollector → EnergyEstimator → SessionPersister → Optimizer → Dashboard**

```mermaid
flowchart LR
    A[ExecutionRunner] -->|ExecutionResult| B[MetricsCollector]
    B -->|MetricSample[]| C[EnergyEstimator]
    C -->|MetricsSummary| D[SessionPersister]
    D -->|ProfileSession| E[Optimizer]
    E -->|OptimizationSuggestion[]| F[Dashboard]
```

### Component Responsibilities

| Component | Responsibility | Input | Output |
|---|---|---|---|
| `ExecutionRunner` | Spawns the target process (node / npx ts-node / python3), captures stdout/stderr, enforces a 5-minute timeout, supports running a `selectedCode` snippet via a temp file | `RunRequest` | `ExecutionResult` |
| `MetricsCollector` | Polls `pidusage` + `systeminformation` at a configurable interval to capture RAM, CPU, disk I/O, and network deltas; aggregates raw samples into a summary | `MetricSample[]` (live) | `MetricsSummary` |
| `EnergyEstimator` | Estimates energy in milliwatt-hours using CPU-weighted TDP with a 10% idle floor: `(tdpWatts × max(avgCpu, 10)/100 × executionTimeMs) / 3_600_000 × 1000` | `avgCpuPercent`, `executionTimeMs` | `energyMwh` (number) |
| `SessionPersister` | Writes/reads `ProfileSession` objects as JSON files under `.kiro/profiler/sessions/`; provides `list()`, `load()`, `save()`, `clear()`, and `purgeExpired()` | `ProfileSession` | persisted JSON |
| `Optimizer` | Generates rule-based `OptimizationSuggestion[]` by comparing `MetricsSummary` values against configurable thresholds (RAM, CPU, energy, execution time) | `ProfileSession` | `OptimizationSuggestion[]` |
| `Dashboard` | Singleton `WebviewPanel` (`DashboardPanel`) that renders sessions, metrics, suggestions, and alerts; communicates with the extension host via `postMessage` | `ProfileSession`, `SessionSummary[]`, `OptimizationSuggestion[]` | rendered UI |

### Data Types

```typescript
// Initiates a profiling run
interface RunRequest {
  filePath: string;
  language: 'javascript' | 'typescript' | 'python';
  runtimePath?: string;
  selectedCode?: string;
}

// Raw result from the spawned process
interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  startTime: number;  // Unix ms
  endTime: number;    // Unix ms
  pid?: number;
}

// One polling snapshot of process resource usage
interface MetricSample {
  timestamp: number;
  ramMb: number;
  cpuPercent: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  networkBytesSent: number;
  networkBytesReceived: number;
  fsOpen: number; fsRead: number; fsWrite: number; fsClose: number;
}

// Aggregated metrics for a complete run
interface MetricsSummary {
  peakRamMb: number;
  avgRamMb: number;
  avgCpuPercent: number;
  totalDiskReadBytes: number;
  totalDiskWriteBytes: number;
  totalNetworkBytesSent: number;
  totalNetworkBytesReceived: number;
  executionTimeMs: number;
  energyMwh: number;
  samples: MetricSample[];
}

// A complete profiling or monitoring session
interface ProfileSession {
  id: string;              // uuid v4
  workspacePath: string;
  filePath: string;
  language: 'javascript' | 'typescript' | 'python';
  sessionType: 'profile' | 'monitor';
  startTime: number;       // Unix ms
  endTime: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  metrics: MetricsSummary;
  isBaseline: boolean;
  optimizationSuggestions: OptimizationSuggestion[];
  linkedPreSessionId?: string;
}

// A single LLM or rule-based optimization suggestion
interface OptimizationSuggestion {
  id: string;              // uuid v4
  title: string;
  explanation: string;
  estimatedImpact: number; // 0–1
  affectedMetric: 'ram' | 'cpu' | 'energy' | 'disk' | 'network';
  diff: string;            // unified diff format
}
```

---

## TypeScript Conventions

All source files in `src/` follow these conventions (enforced by `tsconfig.json`):

- `strict: true` — all strict type checks enabled
- `target: ES2020` — compile to ES2020 JavaScript
- `module: commonjs` — CommonJS module output (required by VS Code extensions)
- `esModuleInterop: true` — allows default imports from CommonJS modules
- `skipLibCheck: true`, `forceConsistentCasingInFileNames: true`

**Code style:**
- Class-based components with constructor injection (e.g. `new SessionPersister(workspacePath)`, `new Optimizer(thresholds)`)
- `async/await` throughout — no raw Promise chains
- ID generation: `import { v4 as uuidv4 } from 'uuid'` — all `id` fields are uuid v4 strings

---

## Test Patterns

- Test runner: **vitest** (configured in `package.json`)
- Property-based tests: **fast-check** with `numRuns: 100`
- Property tag comment format at the top of each PBT file:
  ```
  // Feature: {feature}, Property {N}: {text}
  ```
- Test files live in `src/tests/` and are excluded from TypeScript compilation:
  ```json
  // tsconfig.json
  "exclude": ["node_modules", "out", "**/*.test.ts"]
  ```
- Unit tests use `.test.ts` suffix; PBT files use `.test.ts` suffix with fast-check `fc.assert` / `fc.property`

---

## VS Code Extension API Patterns

### Command Registration

All commands are registered in `activate()` and pushed to `context.subscriptions` so they are disposed when the extension deactivates:

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('kiro-profiler.profile', async () => { /* ... */ })
);
```

### Dashboard Singleton

The Dashboard is a singleton `WebviewPanel` accessed via `DashboardPanel.createOrShow()`. If a panel already exists it is revealed; otherwise a new one is created:

```typescript
const dashboard = DashboardPanel.createOrShow(context.extensionUri, context.secrets);
```

`DashboardPanel.currentPanel` holds the active instance (or `undefined`).

### Progress Notifications

Long-running operations use `vscode.window.withProgress`:

```typescript
await vscode.window.withProgress(
  { location: vscode.ProgressLocation.Notification, title: 'Profiling...', cancellable: false },
  async () => { /* profiling work */ }
);
```

### File Edits

Applying optimizations uses `vscode.WorkspaceEdit` with `edit.replace()` followed by `document.save()`:

```typescript
const edit = new vscode.WorkspaceEdit();
edit.replace(document.uri, fullRange, patchedContent);
await vscode.workspace.applyEdit(edit);
await document.save();
```

### API Key Storage

Secrets (API keys) are stored and retrieved via `context.secrets`:

```typescript
// Store
await context.secrets.store('kiro-profiler.openaiApiKey', apiKey);
// Retrieve
const key = await context.secrets.get('kiro-profiler.openaiApiKey');
```

---

## Session Persistence

Sessions are stored as JSON files at:

```
{workspaceRoot}/.kiro/profiler/sessions/{sessionId}.json
```

Key `SessionPersister` behaviours:

- `save(session)` — writes `ProfileSession` as pretty-printed JSON; creates the directory if needed
- `load(sessionId)` — reads and parses the JSON file for the given ID
- `list(workspacePath)` — reads all `.json` files in the sessions directory, maps each to a `SessionSummary`, and returns the array sorted by `startTime` descending (most recent first)
- `purgeExpired(workspacePath, retentionDays)` — removes any session file whose `startTime` is older than `retentionDays * 24 * 60 * 60 * 1000` ms from `Date.now()`

`SessionSummary` is a lightweight projection of `ProfileSession` containing `id`, `filePath`, `sessionType`, `startTime`, `endTime`, `peakRamMb`, `avgCpuPercent`, `executionTimeMs`, and `isBaseline`.
