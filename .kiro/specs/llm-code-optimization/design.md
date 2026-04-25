# Design Document: LLM Code Optimization

## Overview

This feature extends the kiro-code-profiler VS Code extension with LLM-powered code optimization. After profiling a file, the user can invoke `kiro-profiler.optimizeWithLLM` (from the editor context menu or the dashboard) to send the source code and profiling metrics to a language model. The LLM returns structured `OptimizationSuggestion` objects containing unified diffs. The user can accept or reject individual suggestions (or accept all at once) from either the dashboard or the Kiro AI chat panel. Accepted diffs are applied via the VS Code workspace edit API, and the file is automatically re-profiled so the user sees a concrete before/after comparison.

The feature builds on top of the existing `Optimizer` class, `DashboardPanel`, `SessionPersister`, and `ExecutionRunner` — adding a new `LlmOptimizer` class and wiring it into `extension.ts` alongside new dashboard message handlers.

---

## Architecture

```mermaid
flowchart TD
    A[Editor / Dashboard] -->|optimizeWithLLM command\nor requestLLMOptimization msg| B[extension.ts]
    B --> C[LlmOptimizer]
    C -->|vscode.lm.selectChatModels| D[vscode.lm API]
    D -->|LLM response| C
    C -->|OptimizationSuggestion[]| B
    B --> E[DashboardPanel\nshowSuggestions]
    B --> F[vscode.chat\nAI Panel]
    E -->|acceptSuggestion / rejectSuggestion| B
    F -->|Accept / Reject buttons| B
    B --> G[DiffApplier\nvscode.WorkspaceEdit]
    G -->|modified file| H[ExecutionRunner\nre-profile]
    H -->|new ProfileSession| I[SessionPersister]
    I --> E
```

Key design decisions:
- `LlmOptimizer` is a new class separate from the rule-based `Optimizer` to keep concerns isolated and allow both to coexist.
- Diff application is encapsulated in a `DiffApplier` utility so it can be unit-tested independently of VS Code APIs.
- Rejected suggestion IDs are stored in an in-memory `Set` on the extension host (keyed by session ID) and cleared when the extension deactivates — satisfying the "within the same session" persistence requirement without adding disk I/O.

---

## Components and Interfaces

### LlmOptimizer (`src/llmOptimizer.ts`)

```typescript
export class LlmOptimizer {
  async suggest(session: ProfileSession, sourceCode: string): Promise<OptimizationSuggestion[]>
  buildPrompt(session: ProfileSession, sourceCode: string): string
  parseResponse(raw: string): OptimizationSuggestion[]
}
```

- `buildPrompt` truncates `sourceCode` to 8 000 tokens (≈ 32 000 chars at ~4 chars/token) and appends `// [truncated]` when truncation occurs.
- `parseResponse` extracts the first JSON array from the LLM response text, validates each element against the `OptimizationSuggestion` shape, assigns a UUID `id` if missing, and silently drops malformed entries.
- `suggest` calls `vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' })`, falls back to the first available model, sends the prompt, and returns parsed suggestions.

### DiffApplier (`src/diffApplier.ts`)

```typescript
export function applyUnifiedDiff(originalContent: string, diff: string): string | null
```

- Pure function: returns the patched content string, or `null` if the diff cannot be applied cleanly.
- Uses a lightweight unified-diff parser (no external dependency beyond what's already in the project).
- Called by the accept-suggestion handler in `extension.ts`; the handler then writes the result via `vscode.workspace.openTextDocument` + `WorkspaceEdit`.

### Extension command: `kiro-profiler.optimizeWithLLM`

Registered in `extension.ts`. Flow:

1. Resolve the active file path.
2. Load the most recent `ProfileSession` for that file from `SessionPersister`.
3. If none found → show warning and return.
4. Instantiate `LlmOptimizer`, call `suggest(session, sourceCode)`.
5. On success → call `dashboard.showSuggestions(suggestions)` and post to AI chat panel.
6. On LLM error → show error message, no file changes.

### Extension commands: `kiro-profiler.acceptSuggestion` / `kiro-profiler.rejectSuggestion`

Both commands accept a `suggestionId` argument (forwarded from the dashboard `acceptSuggestion` / `rejectSuggestion` messages that already exist in `DashboardPanel`).

**Accept flow:**
1. Look up suggestion by ID from the active suggestion map.
2. Read current file content.
3. Call `applyUnifiedDiff(content, suggestion.diff)`.
4. If `null` → show error, return.
5. Apply via `WorkspaceEdit`, save document.
6. Show "Optimization applied. Re-profiling…" message.
7. Trigger re-profile (reuse `ExecutionRunner` logic from `kiro-profiler.profile`), link `linkedPreSessionId`.
8. Save new session, update dashboard.

**Reject flow:**
1. Add `suggestionId` to the in-memory rejected set for the current session.
2. Remove from active suggestion map.
3. Send updated suggestion list to dashboard.

### DashboardPanel additions

New message type handled in `onDidReceiveMessage`:

```typescript
case 'requestLLMOptimization':
  vscode.commands.executeCommand('kiro-profiler.optimizeWithLLM', message.sessionId);
  break;
case 'acceptAllSuggestions':
  vscode.commands.executeCommand('kiro-profiler.acceptAllSuggestions');
  break;
```

New method:

```typescript
showImprovement(original: ProfileSession, updated: ProfileSession): void
```

Posts a `{ type: 'showImprovement', original, updated }` message to the webview.

---

## Data Models

No new persistent types are required. The existing `OptimizationSuggestion` and `ProfileSession` interfaces in `types.ts` already cover all fields needed. The `linkedPreSessionId` field on `ProfileSession` is already defined.

The only in-memory state added to `extension.ts`:

```typescript
// Map from sessionId → Set of rejected suggestionIds
const rejectedSuggestions = new Map<string, Set<string>>();

// Map from suggestionId → OptimizationSuggestion (active suggestions)
const activeSuggestions = new Map<string, OptimizationSuggestion>();
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Prompt contains required content

*For any* `ProfileSession` and source code string, the prompt produced by `LlmOptimizer.buildPrompt` SHALL contain the source code (or its truncated prefix), the peak RAM value, the average CPU value, the execution time, and an instruction to return a JSON array.

**Validates: Requirements 3.1**

### Property 2: Source code truncation

*For any* source code string, the source code section embedded in the prompt SHALL never exceed 32 000 characters (≈ 8 000 tokens); if the original source exceeds this limit, the embedded section SHALL end with `// [truncated]`.

**Validates: Requirements 3.6**

### Property 3: Response parsing produces valid suggestions

*For any* LLM response string that contains a valid JSON array of suggestion objects, `LlmOptimizer.parseResponse` SHALL return an array where every element has a non-empty `title`, a non-empty `explanation`, an `estimatedImpact` in [0, 1], a valid `affectedMetric`, and a `diff` string.

**Validates: Requirements 3.3**

### Property 4: Malformed response returns empty array

*For any* LLM response string that does not contain a parseable JSON array of valid suggestion objects, `LlmOptimizer.parseResponse` SHALL return an empty array and SHALL NOT throw.

**Validates: Requirements 3.4**

### Property 5: Dashboard message contains sessionId

*For any* `sessionId`, when the "Optimize with LLM" button is clicked in the dashboard, the message sent to the extension host SHALL contain that exact `sessionId`.

**Validates: Requirements 2.2**

### Property 6: Suggestion formatting contains required fields

*For any* `OptimizationSuggestion`, the formatted AI chat message SHALL contain the suggestion's title, explanation, estimated impact as a percentage, affected metric, and the diff in a fenced code block.

**Validates: Requirements 4.1**

### Property 7: Rejection removes suggestion from active list

*For any* active suggestion list and any suggestion ID in that list, rejecting that suggestion SHALL result in it no longer appearing in the list sent to the dashboard.

**Validates: Requirements 8.1, 8.2**

### Property 8: Rejected suggestions do not reappear

*For any* set of rejected suggestion IDs for a session, refreshing the dashboard within the same extension session SHALL NOT include those suggestion IDs in the displayed list.

**Validates: Requirements 8.3**

### Property 9: Accept All applies suggestions in descending impact order

*For any* list of suggestions with distinct `estimatedImpact` values, the Accept All operation SHALL apply diffs in strictly descending order of `estimatedImpact`.

**Validates: Requirements 6.2**

### Property 10: Accept All skips invalid diffs and continues

*For any* list of suggestions where a subset have diffs that cannot be applied cleanly, the Accept All operation SHALL apply all valid diffs and skip only the invalid ones, without aborting the entire operation.

**Validates: Requirements 6.3**

### Property 11: Re-profile session links to original

*For any* original `ProfileSession`, the `ProfileSession` produced by the automatic re-profile SHALL have `linkedPreSessionId` equal to the original session's `id`.

**Validates: Requirements 7.2**

---

## Error Handling

| Scenario | Behavior |
|---|---|
| No active editor when command invoked | Show warning: "No active editor." |
| No prior ProfileSession for file | Show warning: "Profile this file first before requesting optimization." |
| No LLM model available | Show error: "No language model available. Please ensure GitHub Copilot is enabled." |
| LLM API error (rate limit, timeout, etc.) | Show error with the error reason; no file changes |
| LLM response unparseable | Show warning: "LLM returned an unrecognized response format."; return empty suggestion list |
| Diff cannot be applied cleanly | Show error: "Could not apply suggestion: the file has changed since profiling. Please re-profile and try again."; no file changes |
| Re-profile exits with non-zero code | Show warning: "Re-profile completed with errors. Check the dashboard for details."; save and display partial session |
| Accept All — partial failures | Skip failed diffs, continue; show summary "Applied N of M suggestions. Re-profiling…" |

---

## Testing Strategy

### Unit tests (example-based)

- `LlmOptimizer.buildPrompt` — verify prompt structure with a known session and source code.
- `LlmOptimizer.parseResponse` — verify correct parsing of a well-formed JSON response; verify empty array on malformed input.
- `DiffApplier.applyUnifiedDiff` — verify correct patch application; verify `null` on non-matching diff.
- Command handlers — mock `vscode.lm`, `SessionPersister`, `ExecutionRunner`; verify correct flow for happy path and each error scenario.
- Dashboard message routing — verify `requestLLMOptimization`, `acceptSuggestion`, `rejectSuggestion`, `acceptAllSuggestions` messages trigger the correct commands.

### Property-based tests (fast-check, already a project dependency)

Each property test runs a minimum of 100 iterations.

- **Property 1** — `fc.record({ session: arbitrarySession(), sourceCode: fc.string() })` → assert prompt contains required fields.
- **Property 2** — `fc.string()` of varying length → assert truncation invariant.
- **Property 3** — `fc.array(arbitrarySuggestionJson())` → assert all parsed fields are valid.
- **Property 4** — `fc.oneof(fc.string(), fc.object())` (non-array or invalid shapes) → assert empty array returned, no throw.
- **Property 5** — `fc.string()` as sessionId → assert message contains exact sessionId.
- **Property 6** — `fc.record(arbitrarySuggestion())` → assert formatted message contains all required fields.
- **Property 7 & 8** — `fc.array(arbitrarySuggestion())` + random rejection index → assert list invariants.
- **Property 9** — `fc.array(arbitrarySuggestion(), { minLength: 2 })` → assert application order matches descending impact.
- **Property 10** — mixed valid/invalid diffs → assert valid ones applied, invalid ones skipped.
- **Property 11** — `arbitrarySession()` → assert `linkedPreSessionId` equals original `id`.

Tag format for each test: `// Feature: llm-code-optimization, Property N: <property_text>`

### Integration tests

- End-to-end: invoke `kiro-profiler.optimizeWithLLM` with a real (or stubbed) LLM response, verify suggestion appears in dashboard.
- Diff application: apply a known diff to a real temp file, verify file content matches expected output.
