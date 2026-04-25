# Implementation Plan: Profiler Steering Docs

## Overview

Create three always-included Kiro steering documents in `.kiro/steering/` that give any Kiro session immediate, accurate knowledge of the kiro-code-profiler codebase — covering the main architecture, the LLM optimization feature, and the bugfix workflow conventions.

## Tasks

- [x] 1. Create `.kiro/steering/architecture.md`
  - Add YAML front-matter with `inclusion: always`
  - Document the Component_Pipeline in order: `ExecutionRunner → MetricsCollector → EnergyEstimator → SessionPersister → Optimizer → Dashboard`, with each component's responsibility and the data types passed between them (`RunRequest`, `ExecutionResult`, `MetricSample[]`, `MetricsSummary`, `ProfileSession`, `OptimizationSuggestion[]`)
  - Document TypeScript conventions: `strict` mode, `ES2020` target, `commonjs` modules, `esModuleInterop: true`, class-based components with constructor injection, `async/await` throughout, `uuid` v4 for ID generation
  - Document test patterns: vitest as test runner, fast-check for property-based tests with `numRuns: 100`, property tag comment format `// Feature: {feature}, Property {N}: {text}`, test files in `src/tests/` excluded from TypeScript compilation
  - Document VS Code extension API patterns: command registration in `activate()` via `context.subscriptions`, `DashboardPanel.createOrShow()` singleton, `vscode.window.withProgress` for progress, `vscode.WorkspaceEdit` + `edit.replace()` + `document.save()` for file edits, `context.secrets` for API keys
  - Document session persistence: JSON files at `.kiro/profiler/sessions/{sessionId}.json`, `list()` returns `SessionSummary[]` sorted by `startTime` descending, `purgeExpired()` removes sessions older than configured days
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 2. Create `.kiro/steering/llm-optimization.md`
  - Add YAML front-matter with `inclusion: always`
  - Document `LlmOptimizer` responsibilities: `buildPrompt` truncation to 32,000 chars with `// [truncated]` marker, `parseResponse` JSON extraction and validation, `suggest` API key resolution and `gpt-4o-mini` call via `openai` SDK
  - Document `DiffApplier` contracts: returns patched string or `null` on hunk mismatch, empty diff is a no-op, outward search from `origStart` hint for line-number drift tolerance
  - Document the Suggestion_Lifecycle: `activeSuggestions` and `suggestionFilePaths` maps in `extension.ts`, accept flow (apply diff → WorkspaceEdit → re-profile with `linkedPreSessionId`), reject flow (remove from `activeSuggestions` → add to `rejectedSuggestions`), Accept All flow (sort by `estimatedImpact` desc → apply sequentially → single re-profile)
  - Document API key resolution order: (1) `kiro-profiler.openaiApiKey` setting, (2) `OPENAI_API_KEY` env var, (3) VS Code secret storage
  - Document `OptimizationSuggestion` type fields with their types and constraints
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 3. Create `.kiro/steering/bugfix-workflow.md`
  - Add YAML front-matter with `inclusion: always`
  - Document bugfix spec file location and naming: `.kiro/specs/{kebab-case-bug-name}/bugfix.md`
  - Document the three mandatory sections: **Bug Analysis** (EARS `WHEN … THEN … the system shows/does <wrong thing>`), **Expected Behavior** (EARS `WHEN … THEN THE system SHALL …`), **Regression Prevention** (EARS `WHEN … THEN THE system SHALL CONTINUE TO …`)
  - Document the bug condition pattern: `WHEN <trigger> AND <condition> THEN <wrong outcome>`, with criteria numbered within sections (1.1, 1.2, 2.1, etc.)
  - Document that regression prevention must cover both the happy path and known error paths of affected commands
  - Include a concise annotated example drawn from the `suggestion-accept-no-active-editor` bugfix spec
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
