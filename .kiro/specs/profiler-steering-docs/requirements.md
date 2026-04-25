# Requirements Document

## Introduction

This feature creates three Kiro steering documents for the `kiro-code-profiler` VS Code extension project. Steering docs are always-included context files that give any Kiro session immediate, accurate knowledge of the codebase's architecture, conventions, and patterns — eliminating the need to re-explore the project on every session.

The three documents cover:
1. **Main architecture** — the component pipeline, TypeScript conventions, test patterns, and VS Code extension API usage.
2. **LLM optimization feature** — how `LlmOptimizer`, `DiffApplier`, and the suggestion lifecycle work.
3. **Bugfix workflow conventions** — how bugfix specs are structured in this project.

All three files are placed in `.kiro/steering/` and use the standard Kiro steering front-matter format with `inclusion: always`.

## Glossary

- **Steering_Doc**: A Markdown file in `.kiro/steering/` with YAML front-matter that Kiro automatically injects into every session context.
- **Component_Pipeline**: The ordered chain of components that transforms a run request into a persisted, optimized `ProfileSession`: `ExecutionRunner → MetricsCollector → EnergyEstimator → SessionPersister → Optimizer → Dashboard`.
- **LlmOptimizer**: The module (`src/llmOptimizer.ts`) that builds OpenAI prompts from a `ProfileSession` and parses the JSON response into `OptimizationSuggestion[]`.
- **DiffApplier**: The module (`src/diffApplier.ts`) that applies unified diffs to source file content, returning `null` on failure.
- **Suggestion_Lifecycle**: The full flow of an `OptimizationSuggestion` from generation through accept/reject to re-profile.
- **Bugfix_Spec**: A `.kiro/specs/{name}/bugfix.md` file that documents a defect using the project's three-section structure: Bug Analysis, Expected Behavior, and Regression Prevention.
- **EARS**: Easy Approach to Requirements Syntax — the requirement pattern language used throughout this project's specs.

## Requirements

### Requirement 1: Main Architecture Steering Document

**User Story:** As a Kiro session working on the kiro-code-profiler codebase, I want an always-available architecture reference, so that I immediately understand the component pipeline, TypeScript conventions, test patterns, and VS Code API usage without exploring the source tree.

#### Acceptance Criteria

1. THE Steering_Doc SHALL be created at `.kiro/steering/architecture.md` with YAML front-matter specifying `inclusion: always`.
2. THE Steering_Doc SHALL describe the Component_Pipeline in the order `ExecutionRunner → MetricsCollector → EnergyEstimator → SessionPersister → Optimizer → Dashboard`, including the responsibility of each component and the data types passed between them (`RunRequest`, `ExecutionResult`, `MetricSample[]`, `MetricsSummary`, `ProfileSession`, `OptimizationSuggestion[]`).
3. THE Steering_Doc SHALL document the TypeScript coding conventions used in the project: `strict` mode enabled, `ES2020` target, `commonjs` modules, `esModuleInterop: true`, class-based components with constructor injection, `async/await` throughout, and `uuid` v4 for ID generation.
4. THE Steering_Doc SHALL document the test patterns: unit tests and property-based tests both use **vitest** as the test runner; property-based tests use **fast-check** with a minimum of 100 iterations (`numRuns: 100`); each property test file begins with a comment block listing the property tags in the format `// Feature: {feature}, Property {N}: {text}`; test files live in `src/tests/` and are excluded from the TypeScript compilation target.
5. THE Steering_Doc SHALL document the VS Code extension API patterns: commands are registered in `activate()` via `vscode.commands.registerCommand` and pushed to `context.subscriptions`; the Dashboard is a singleton `WebviewPanel` accessed via `DashboardPanel.createOrShow()`; progress notifications use `vscode.window.withProgress`; file edits use `vscode.WorkspaceEdit` with `edit.replace()` followed by `document.save()`; secrets (API keys) are stored and retrieved via `context.secrets`.
6. THE Steering_Doc SHALL document session persistence: sessions are stored as JSON files at `.kiro/profiler/sessions/{sessionId}.json` relative to the workspace root; `SessionPersister.list()` returns `SessionSummary[]` sorted by `startTime` descending; `purgeExpired()` removes sessions older than a configurable number of days.

---

### Requirement 2: LLM Optimization Feature Steering Document

**User Story:** As a Kiro session working on the LLM optimization feature, I want an always-available reference for how `LlmOptimizer`, `DiffApplier`, and the suggestion lifecycle work, so that I can make correct changes without misunderstanding the data flow or error-handling contracts.

#### Acceptance Criteria

1. THE Steering_Doc SHALL be created at `.kiro/steering/llm-optimization.md` with YAML front-matter specifying `inclusion: always`.
2. THE Steering_Doc SHALL describe `LlmOptimizer` responsibilities: `buildPrompt(session, sourceCode)` embeds source code (truncated to 32,000 characters with a `// [truncated]` marker) and `MetricsSummary` fields into a prompt that instructs the model to return a JSON array; `parseResponse(raw)` extracts the first JSON array from the raw string, validates each element against the `OptimizationSuggestion` shape, assigns a UUID `id` if missing, and silently drops malformed entries; `suggest(session, sourceCode)` resolves the API key (settings → env var → secret storage), calls `gpt-4o-mini` via the `openai` SDK, and returns parsed suggestions.
3. THE Steering_Doc SHALL describe `DiffApplier` contracts: `applyUnifiedDiff(originalContent, diff)` returns the patched string on success or `null` if any hunk cannot be located; an empty diff is a no-op returning the original content unchanged; the function searches outward from the `origStart` hint to tolerate minor line-number drift.
4. THE Steering_Doc SHALL describe the Suggestion_Lifecycle: suggestions are generated by `LlmOptimizer.suggest()` and stored in the module-level `activeSuggestions: Map<string, OptimizationSuggestion>` and `suggestionFilePaths: Map<string, string>` maps in `extension.ts`; accepting a suggestion calls `applyUnifiedDiff`, writes the result via `WorkspaceEdit`, removes the suggestion from both maps, and triggers a re-profile that sets `linkedPreSessionId` on the new session; rejecting a suggestion removes it from `activeSuggestions` and adds its ID to the per-session `rejectedSuggestions: Map<string, Set<string>>` map so it does not reappear on dashboard refresh; "Accept All" sorts suggestions by `estimatedImpact` descending, applies diffs sequentially to the accumulating content, skips failures without aborting, and triggers a single re-profile at the end.
5. THE Steering_Doc SHALL document the API key resolution order: (1) VS Code extension settings `kiro-profiler.openaiApiKey`, (2) `OPENAI_API_KEY` environment variable, (3) VS Code secret storage key `kiro-profiler.openaiApiKey`.
6. THE Steering_Doc SHALL document the `OptimizationSuggestion` type fields: `id` (UUID string), `title` (non-empty string), `explanation` (non-empty string), `estimatedImpact` (number 0–1), `affectedMetric` (`'ram' | 'cpu' | 'energy' | 'disk' | 'network'`), `diff` (unified diff string).

---

### Requirement 3: Bugfix Workflow Conventions Steering Document

**User Story:** As a Kiro session tasked with fixing a bug in the kiro-code-profiler project, I want an always-available reference for how bugfix specs are structured, so that I produce consistent, well-reasoned bug documentation without guessing the format.

#### Acceptance Criteria

1. THE Steering_Doc SHALL be created at `.kiro/steering/bugfix-workflow.md` with YAML front-matter specifying `inclusion: always`.
2. THE Steering_Doc SHALL describe the bugfix spec file location and naming convention: bugfix specs live at `.kiro/specs/{kebab-case-bug-name}/bugfix.md`.
3. THE Steering_Doc SHALL describe the three mandatory sections of a bugfix spec: **Bug Analysis** (current defective behavior expressed as EARS `WHEN … THEN … the system shows/does <wrong thing>` criteria), **Expected Behavior** (correct behavior expressed as EARS `WHEN … THEN THE system SHALL …` criteria), and **Regression Prevention** (unchanged behaviors that must continue to work, expressed as EARS `WHEN … THEN THE system SHALL CONTINUE TO …` criteria).
4. THE Steering_Doc SHALL document that bug condition analysis criteria use the `WHEN <trigger> AND <condition> THEN <wrong outcome>` pattern to precisely identify the defect trigger, and that each criterion is numbered within its section (e.g. 1.1, 1.2, 2.1).
5. THE Steering_Doc SHALL document that regression prevention criteria enumerate every related behavior that must not regress, covering both the happy path and known error paths of the affected commands or components.
6. THE Steering_Doc SHALL include a concise annotated example drawn from the `suggestion-accept-no-active-editor` bugfix spec to illustrate the three-section structure in practice.
