# Design Document: Profiler Steering Docs

## Overview

This feature creates three always-included Kiro steering documents in `.kiro/steering/`. Each file uses standard Kiro front-matter (`inclusion: always`) so it is injected into every session context automatically — no manual inclusion needed.

The three documents are:
- `architecture.md` — component pipeline, TypeScript conventions, test patterns, VS Code API patterns, session persistence
- `llm-optimization.md` — LlmOptimizer, DiffApplier, suggestion lifecycle, API key resolution, OptimizationSuggestion type
- `bugfix-workflow.md` — bugfix spec structure, EARS patterns, annotated example

Since these are documentation files rather than executable code, the design focuses on content structure, completeness criteria, and how each document maps to the requirements.

---

## Architecture

The three steering documents are static Markdown files. There is no runtime component — they are read by the Kiro IDE at session start and injected into the model context. The only "architecture" is the file layout:

```
.kiro/
  steering/
    architecture.md
    llm-optimization.md
    bugfix-workflow.md
```

Each file is independent. There are no cross-references or build steps required.

---

## Components and Interfaces

### Front-Matter Format

Every steering document begins with a YAML front-matter block:

```yaml
---
inclusion: always
---
```

`inclusion: always` tells Kiro to inject the file into every session regardless of which files are open. This is the correct value for project-wide reference documents.

---

### `architecture.md` — Content Structure

**Purpose:** Give any Kiro session immediate knowledge of the component pipeline, TypeScript conventions, test patterns, and VS Code API usage.

**Sections:**

1. **Component Pipeline**
   - Ordered chain: `ExecutionRunner → MetricsCollector → EnergyEstimator → SessionPersister → Optimizer → Dashboard`
   - For each component: one-sentence responsibility description
   - Data types passed between components: `RunRequest`, `ExecutionResult`, `MetricSample[]`, `MetricsSummary`, `ProfileSession`, `OptimizationSuggestion[]`
   - A Mermaid flowchart illustrating the pipeline

2. **TypeScript Conventions**
   - `strict: true`, `target: ES2020`, `module: commonjs`, `esModuleInterop: true`
   - Class-based components with constructor injection
   - `async/await` throughout (no raw Promise chains)
   - `uuid` v4 (`import { v4 as uuidv4 } from 'uuid'`) for all ID generation

3. **Test Patterns**
   - Test runner: **vitest**
   - Property-based tests: **fast-check** with `numRuns: 100`
   - Property tag comment format: `// Feature: {feature}, Property {N}: {text}`
   - Test files live in `src/tests/` and are excluded from TypeScript compilation (`"exclude": ["**/*.test.ts"]` in `tsconfig.json`)

4. **VS Code Extension API Patterns**
   - Commands registered in `activate()` via `vscode.commands.registerCommand`, pushed to `context.subscriptions`
   - Dashboard is a singleton `WebviewPanel` accessed via `DashboardPanel.createOrShow()`
   - Progress notifications use `vscode.window.withProgress`
   - File edits use `vscode.WorkspaceEdit` with `edit.replace()` followed by `document.save()`
   - API keys stored and retrieved via `context.secrets` (key: `kiro-profiler.openaiApiKey`)

5. **Session Persistence**
   - Storage path: `.kiro/profiler/sessions/{sessionId}.json` relative to workspace root
   - `SessionPersister.list(workspacePath)` returns `SessionSummary[]` sorted by `startTime` descending
   - `purgeExpired(workspacePath, retentionDays)` removes sessions whose `startTime` is older than `retentionDays * 24 * 60 * 60 * 1000` ms

---

### `llm-optimization.md` — Content Structure

**Purpose:** Give any Kiro session working on the LLM optimization feature accurate knowledge of `LlmOptimizer`, `DiffApplier`, the suggestion lifecycle, and the `OptimizationSuggestion` type.

**Sections:**

1. **LlmOptimizer**
   - `buildPrompt(session, sourceCode)`: truncates `sourceCode` to 32,000 characters, appends `\n// [truncated]` when truncation occurs, embeds all `MetricsSummary` fields, instructs the model to return a JSON array of `OptimizationSuggestion` objects
   - `parseResponse(raw)`: finds the first `[…]` JSON array in the raw string, validates each element against the `OptimizationSuggestion` shape via `isValidSuggestionShape`, assigns a UUID `id` if missing or empty, silently drops malformed entries
   - `suggest(session, sourceCode)`: resolves the API key via `resolveApiKey()`, calls `gpt-4o-mini` via the `openai` SDK with `temperature: 0`, returns parsed suggestions

2. **DiffApplier**
   - `applyUnifiedDiff(originalContent, diff)` returns the patched string on success, or `null` if any hunk cannot be located in the original content
   - An empty diff (no hunks) is a no-op — returns `originalContent` unchanged
   - Hunk location uses an outward search from the `origStart` hint to tolerate minor line-number drift between profiling and acceptance

3. **Suggestion Lifecycle**
   - Suggestions are stored in two module-level maps in `extension.ts`:
     - `activeSuggestions: Map<string, OptimizationSuggestion>` — keyed by suggestion `id`
     - `suggestionFilePaths: Map<string, string>` — maps suggestion `id` to the file path it targets
   - **Accept flow**: call `applyUnifiedDiff` → write result via `WorkspaceEdit` + `document.save()` → remove from both maps → trigger re-profile with `linkedPreSessionId` set to the original session's `id`
   - **Reject flow**: remove from `activeSuggestions` → add `id` to `rejectedSuggestions: Map<string, Set<string>>` (keyed by session `id`) → update dashboard
   - **Accept All flow**: sort suggestions by `estimatedImpact` descending → apply diffs sequentially to the accumulating file content → skip failures without aborting → trigger a single re-profile at the end

4. **API Key Resolution Order**
   1. VS Code extension settings: `kiro-profiler.openaiApiKey`
   2. Environment variable: `OPENAI_API_KEY`
   3. VS Code secret storage: key `kiro-profiler.openaiApiKey`
   - If none found, throws with a user-facing message directing to extension settings

5. **OptimizationSuggestion Type**

   | Field | Type | Constraint |
   |---|---|---|
   | `id` | `string` | UUID v4 |
   | `title` | `string` | non-empty |
   | `explanation` | `string` | non-empty |
   | `estimatedImpact` | `number` | 0–1 inclusive |
   | `affectedMetric` | `'ram' \| 'cpu' \| 'energy' \| 'disk' \| 'network'` | one of the five values |
   | `diff` | `string` | unified diff format |

---

### `bugfix-workflow.md` — Content Structure

**Purpose:** Give any Kiro session tasked with fixing a bug the exact format and conventions for bugfix specs in this project.

**Sections:**

1. **File Location and Naming**
   - Path: `.kiro/specs/{kebab-case-bug-name}/bugfix.md`
   - The directory name is the kebab-case bug name (e.g. `suggestion-accept-no-active-editor`)

2. **Three Mandatory Sections**
   - **Bug Analysis** — current defective behavior, expressed as EARS criteria using `WHEN … THEN … the system shows/does <wrong thing>` (lowercase "the", no SHALL — this is describing the bug)
   - **Expected Behavior** — correct behavior, expressed as EARS criteria using `WHEN … THEN THE system SHALL …` (uppercase "THE", with SHALL)
   - **Regression Prevention** — behaviors that must not regress, expressed as EARS criteria using `WHEN … THEN THE system SHALL CONTINUE TO …`

3. **Bug Condition Pattern**
   - Use `WHEN <trigger> AND <condition> THEN <wrong outcome>` to precisely identify the defect trigger
   - Criteria are numbered within their section: `1.1`, `1.2`, `2.1`, `2.2`, `3.1`, etc.

4. **Regression Prevention Scope**
   - Must enumerate every related behavior that must not regress
   - Must cover both the happy path (normal operation) and known error paths of the affected commands or components

5. **Annotated Example**
   - Drawn from the `suggestion-accept-no-active-editor` bugfix spec
   - Shows all three sections with real criteria, demonstrating the WHEN/AND/THEN pattern and numbering

---

## Data Models

These are documentation files. There are no runtime data models. The content of each file is structured Markdown with YAML front-matter.

The only "schema" is the front-matter:

```yaml
---
inclusion: always
---
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: architecture.md contains all required content

*For any* valid `architecture.md` steering document, the file content SHALL contain all of the following terms: `ExecutionRunner`, `MetricsCollector`, `EnergyEstimator`, `SessionPersister`, `Optimizer`, `Dashboard`, `RunRequest`, `ExecutionResult`, `MetricSample`, `MetricsSummary`, `ProfileSession`, `OptimizationSuggestion`, `strict`, `ES2020`, `commonjs`, `esModuleInterop`, `uuid`, `vitest`, `fast-check`, `numRuns`, `src/tests`, `vscode.commands.registerCommand`, `context.subscriptions`, `DashboardPanel`, `withProgress`, `WorkspaceEdit`, `context.secrets`, `.kiro/profiler/sessions`, `startTime`.

**Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6**

### Property 2: llm-optimization.md contains all required content

*For any* valid `llm-optimization.md` steering document, the file content SHALL contain all of the following terms: `buildPrompt`, `parseResponse`, `suggest`, `32000` (or `32,000`), `[truncated]`, `gpt-4o-mini`, `applyUnifiedDiff`, `origStart`, `activeSuggestions`, `suggestionFilePaths`, `rejectedSuggestions`, `linkedPreSessionId`, `estimatedImpact`, `kiro-profiler.openaiApiKey`, `OPENAI_API_KEY`, `id`, `title`, `explanation`, `affectedMetric`, `diff`.

**Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6**

### Property 3: bugfix-workflow.md contains all required content

*For any* valid `bugfix-workflow.md` steering document, the file content SHALL contain all of the following terms: `.kiro/specs/`, `bugfix.md`, `Bug Analysis`, `Expected Behavior`, `Regression Prevention`, `WHEN`, `AND`, `THEN`, `SHALL CONTINUE TO`, `happy path`, `suggestion-accept-no-active-editor`.

**Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6**

---

## Error Handling

These are static documentation files with no runtime error paths. The only failure modes are:

| Scenario | Handling |
|---|---|
| File missing from `.kiro/steering/` | Kiro session lacks context — caught by smoke test in CI |
| Front-matter missing or malformed | Kiro does not inject the file — caught by smoke test |
| Required term absent from document | Completeness property test fails — caught by property test |

---

## Testing Strategy

Since these are documentation files, PBT applies in a limited but meaningful way: we can treat each document as a string and assert that all required terms are present. This is a universal property — for any document that claims to satisfy the requirements, all required terms must appear.

### Smoke Tests

One smoke test per file:
- Assert `.kiro/steering/architecture.md` exists and contains `inclusion: always` in its front-matter
- Assert `.kiro/steering/llm-optimization.md` exists and contains `inclusion: always` in its front-matter
- Assert `.kiro/steering/bugfix-workflow.md` exists and contains `inclusion: always` in its front-matter

### Property-Based Tests

Use **vitest** + **fast-check** with `numRuns: 100`.

Each property test reads the actual file content once, then uses fast-check to generate random subsets of the required terms and assert all are present. This validates completeness across many random orderings of the required-term checklist.

Tag format: `// Feature: profiler-steering-docs, Property {N}: {text}`

- **Property 1** — `fc.shuffledSubarray(requiredArchitectureTerms)` → assert every term in the subset appears in `architecture.md`
- **Property 2** — `fc.shuffledSubarray(requiredLlmTerms)` → assert every term in the subset appears in `llm-optimization.md`
- **Property 3** — `fc.shuffledSubarray(requiredBugfixTerms)` → assert every term in the subset appears in `bugfix-workflow.md`

### Unit Tests

- Verify front-matter is valid YAML and `inclusion` equals `"always"` for each file
- Verify the annotated example in `bugfix-workflow.md` contains all three section headings
- Verify `architecture.md` Mermaid diagram block is syntactically present (starts with ` ```mermaid `)
