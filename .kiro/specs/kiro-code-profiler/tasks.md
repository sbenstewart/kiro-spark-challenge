# Implementation Plan: Kiro Code Profiler

## Overview

Implement the Kiro Code Profiler as a Kiro IDE extension using TypeScript. Since Kiro is built on VS Code, the extension uses the VS Code extension API but is packaged and installed specifically for Kiro. The plan follows the architecture in the design document: core profiling components first, then persistence, then the Webview dashboard, then AI optimization, then real-time monitoring, configuration and wiring, and finally packaging and installation into Kiro.

## Tasks

- [x] 1. Project scaffold and core interfaces
  - Initialize the extension project with `package.json`, `tsconfig.json`, and the VS Code extension manifest (`package.json` `contributes` section)
  - Define all TypeScript interfaces from the design (`RunRequest`, `ExecutionResult`, `MetricSample`, `MetricsSummary`, `ProfileSession`, `SessionSummary`, `BaselineComparison`, `OptimizationSuggestion`, `MonitorConfig`, `MetricAlert`, `ProfilerConfig`) in `src/types.ts`
  - Add `fast-check`, `pidusage`, and `systeminformation` as dependencies
  - _Requirements: 1.1, 1.7, 8.1_

- [x] 2. Implement EnergyEstimator and MetricsSummary aggregation
  - [x] 2.1 Implement `EnergyEstimator.estimate()` in `src/energyEstimator.ts`
    - Use formula: `energyMwh = (tdpWatts * avgCpuPercent/100 * executionTimeMs) / 3_600_000 * 1000`
    - Read system TDP via `systeminformation`; fall back to 15W
    - _Requirements: 1.4_
  - [x] 2.2 Write unit tests for `EnergyEstimator`
    - Test formula with known inputs and the 15W fallback
    - _Requirements: 1.4_
  - [x] 2.3 Implement `MetricsSummary` aggregation from `MetricSample[]` in `src/metricsCollector.ts`
    - Compute `peakRamMb`, `avgRamMb`, `avgCpuPercent`, totals for disk/network/fs, and `executionTimeMs`
    - _Requirements: 1.2, 1.3, 1.5, 3.1, 3.3, 3.4_
  - [x] 2.4 Write property test for MetricsSummary aggregation
    - **Property 1: Metrics summary completeness**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 3.1**
  - [x] 2.5 Write unit tests for MetricsSummary aggregation
    - Test peak/avg calculations with known sample arrays
    - _Requirements: 1.2, 1.3, 1.5_

- [x] 3. Implement MetricsCollector (polling)
  - [x] 3.1 Implement `MetricsCollector` in `src/metricsCollector.ts`
    - Use `pidusage` to poll CPU and RAM; use `systeminformation` for disk/network counters
    - Store samples in memory; expose `start(pid, intervalMs)`, `stop()`, `getSamples()`
    - _Requirements: 1.2, 1.3, 2.2, 2.3, 3.1, 3.3, 3.4_
  - [x] 3.2 Write property test for sampling interval
    - **Property 3: Time-series sampling interval**
    - **Validates: Requirements 2.2, 2.3**
  - [x] 3.3 Write property test for monitor sampling interval
    - **Property 8: Monitor sampling interval**
    - **Validates: Requirements 6.1**

- [x] 4. Implement ExecutionRunner
  - [x] 4.1 Implement `ExecutionRunner.run()` in `src/executionRunner.ts`
    - Spawn child process for JS/TS (Node) and Python; capture stdout/stderr; record start/end times
    - Support `selectedCode` by writing to a temp file
    - Enforce configurable timeout (default 5 min); kill and persist partial session with `exitCode: -1` on timeout
    - _Requirements: 1.1, 1.6, 1.7, 8.5_
  - [x] 4.2 Write property test for error exit captures partial metrics
    - **Property 2: Error exit captures partial metrics**
    - **Validates: Requirements 1.6**
  - [x] 4.3 Write unit tests for ExecutionRunner
    - Test successful run, non-zero exit, timeout, and bad runtime path scenarios
    - _Requirements: 1.1, 1.6_

- [x] 5. Checkpoint — core execution and metrics
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement SessionPersister
  - [x] 6.1 Implement `SessionPersister` in `src/sessionPersister.ts`
    - Store sessions as JSON files at `.kiro/profiler/sessions/{sessionId}.json`
    - Implement `save`, `load`, `list` (ordered by `startTime` desc), `clear`, and `purgeExpired`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 6.2 Write property test for session persistence round-trip
    - **Property 9: Session persistence round-trip**
    - **Validates: Requirements 7.1, 7.3**
  - [x] 6.3 Write property test for session history ordering
    - **Property 10: Session history ordering**
    - **Validates: Requirements 7.2**
  - [x] 6.4 Write property test for session retention policy
    - **Property 11: Session retention policy**
    - **Validates: Requirements 7.4**
  - [x] 6.5 Write property test for clear removes all sessions
    - **Property 12: Clear removes all sessions**
    - **Validates: Requirements 7.5**
  - [x] 6.6 Write unit tests for SessionPersister
    - Test serialization/deserialization round-trip and list ordering
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 7. Implement ConfigurationManager
  - [x] 7.1 Implement `ConfigurationManager` in `src/configurationManager.ts`
    - Read `ProfilerConfig` from VS Code workspace settings with defaults (512 MB RAM, 80% CPU, 1000ms interval)
    - Validate `sampleIntervalMs >= 100`; clamp and log warning on out-of-range values
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x] 7.2 Write property test for configuration validation
    - **Property 13: Configuration validation**
    - **Validates: Requirements 8.4**
  - [x] 7.3 Write unit tests for ConfigurationManager
    - Test defaults, boundary conditions, and clamping behavior
    - _Requirements: 8.2, 8.3, 8.4_

- [x] 8. Implement BaselineComparison delta calculation
  - [x] 8.1 Implement `computeBaselineComparison()` in `src/baselineComparison.ts`
    - Apply formula `(current - baseline) / baseline * 100` rounded to two decimal places for each metric
    - _Requirements: 2.4, 5.4_
  - [x] 8.2 Write property test for baseline delta correctness
    - **Property 4: Baseline delta correctness**
    - **Validates: Requirements 2.4, 5.4**
  - [x] 8.3 Write unit tests for baseline delta calculation
    - Test known numeric pairs and zero-baseline guard
    - _Requirements: 2.4_

- [x] 9. Implement Optimizer
  - [x] 9.1 Implement `Optimizer.suggest()` in `src/optimizer.ts`
    - Call Kiro AI API with session context and source code; parse response into `OptimizationSuggestion[]`
    - Sort suggestions by `estimatedImpact` descending before returning
    - Handle AI API unavailability gracefully (return empty array, surface error in dashboard)
    - _Requirements: 4.1, 4.2, 4.6_
  - [x] 9.2 Write property test for suggestions ranked and explained
    - **Property 5: Suggestions have explanations and are ranked**
    - **Validates: Requirements 4.2, 4.6**
  - [x] 9.3 Write property test for threshold-triggered suggestions
    - **Property 14: Threshold suggestions triggered**
    - **Validates: Requirements 4.1**
  - [x] 9.4 Write unit tests for Optimizer
    - Test suggestion sorting and AI error fallback
    - _Requirements: 4.1, 4.2, 4.6_

- [x] 10. Checkpoint — persistence, config, and optimizer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement Monitor
  - [x] 11.1 Implement `Monitor` in `src/monitor.ts`
    - Support `attach(pid)` and `launch(request)` modes
    - Emit `sample` events at configured interval; emit `alert` events when RAM or CPU thresholds are breached
    - On `stop()`, finalize and return a `ProfileSession`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - [x] 11.2 Write property test for alert emission on threshold breach
    - **Property 7: Alert emission on threshold breach**
    - **Validates: Requirements 6.4, 6.5**
  - [x] 11.3 Write unit tests for Monitor
    - Test attach-by-PID, alert emission, and session finalization on stop
    - _Requirements: 6.1, 6.4, 6.5, 6.6, 6.7_

- [x] 12. Implement Webview Dashboard
  - [x] 12.1 Create the Webview panel in `src/dashboard/` with HTML/CSS/JS
    - Render primary metrics (RAM, disk, energy, execution time) within 500ms of receiving session data
    - Render time-series charts for RAM and CPU using sampled data
    - Include a collapsible advanced metrics section (GC, network, fs ops)
    - _Requirements: 2.1, 2.2, 2.3, 3.2, 3.3, 3.4, 3.5_
  - [x] 12.2 Implement session history list in the Dashboard
    - Display past sessions ordered by most recent first; clicking a session loads its full metrics
    - _Requirements: 7.2, 7.3_
  - [x] 12.3 Implement baseline comparison UI
    - Allow marking a session as baseline; display percentage deltas when a baseline exists
    - _Requirements: 2.4, 2.5_
  - [x] 12.4 Implement optimization suggestion UI
    - Show ranked suggestions with explanations; support accept (apply diff preview) and reject (restore original)
    - _Requirements: 4.2, 4.3, 4.4, 4.5_
  - [x] 12.5 Write property test for suggestion rejection is a no-op
    - **Property 6: Suggestion rejection is a no-op**
    - **Validates: Requirements 4.5**
  - [x] 12.6 Implement real-time monitoring UI
    - Update charts live on each `sample` event; show elapsed duration; display RAM/CPU alerts
    - _Requirements: 6.2, 6.3, 6.4, 6.5_
  - [x] 12.7 Implement improvement visualization
    - Side-by-side metric comparison for pre/post optimization sessions; code diff view with per-line metric annotations; summary percentage reductions
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 13. Wire extension entry point and commands
  - [x] 13.1 Implement `src/extension.ts` activation and command registration
    - Register commands: `kiro-profiler.profile`, `kiro-profiler.monitor`, `kiro-profiler.showDashboard`, `kiro-profiler.clearHistory`
    - Wire `ExecutionRunner` → `MetricsCollector` → `EnergyEstimator` → `SessionPersister` → `Optimizer` → `Dashboard`
    - Wire `Monitor` → `Dashboard` for live updates
    - _Requirements: 1.1, 6.1, 6.6, 7.5, 8.1_
  - [x] 13.2 Register configuration schema in `package.json` `contributes.configuration`
    - Expose `ramAlertThresholdMb` (default 512), `cpuAlertThresholdPercent` (default 80), `sampleIntervalMs` (default 1000, min 100), `runtimePaths.node`, `runtimePaths.python`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 14. Package and install the extension in Kiro
  - [x] 14.1 Install `@vscode/vsce` as a dev dependency and add a `package` npm script (`vsce package`)
    - Run `npm run package` to produce a `.vsix` file in the project root
  - [ ] 14.2 Install the `.vsix` into Kiro
    - Open Kiro's Extensions panel (Cmd+Shift+X on macOS / Ctrl+Shift+X on Windows/Linux)
    - Click the `...` menu (top-right of the Extensions panel) → "Install from VSIX…"
    - Select the generated `.vsix` file and confirm installation
    - Reload the Kiro window when prompted (`Developer: Reload Window` from the command palette)
  - [ ] 14.3 Verify the extension is active in Kiro
    - Open the command palette (Cmd+Shift+P / Ctrl+Shift+P) and confirm `Kiro Profiler: Profile`, `Kiro Profiler: Monitor`, and `Kiro Profiler: Show Dashboard` commands are listed
    - Open Kiro Settings and confirm the `kiro-profiler.*` configuration keys are present with correct defaults
  - [x] 14.4 Add a `README.md` to the extension project with installation and usage instructions for Kiro
    - Document the "Install from VSIX" steps
    - Document each command and configuration option

- [x] 15. Final checkpoint — integration, smoke tests, and Kiro installation
  - Ensure all tests pass and the extension loads correctly inside Kiro, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use **fast-check** with a minimum of 100 iterations per property
- Each property test must include the comment tag: `// Feature: kiro-code-profiler, Property N: <title>`
- Checkpoints ensure incremental validation before moving to the next layer
