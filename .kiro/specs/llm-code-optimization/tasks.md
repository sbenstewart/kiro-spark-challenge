# Tasks: LLM Code Optimization

## Task List

- [x] 1. Add `LlmOptimizer` class
  - [x] 1.1 Create `src/llmOptimizer.ts` with `buildPrompt`, `parseResponse`, and `suggest` methods
  - [x] 1.2 Implement `buildPrompt`: embed source code (truncated to 32 000 chars with `// [truncated]` comment), MetricsSummary fields, and JSON-array instruction
  - [x] 1.3 Implement `parseResponse`: extract first JSON array from response text, validate each element against `OptimizationSuggestion` shape, assign UUID `id` if missing, drop malformed entries silently
  - [x] 1.4 Implement `suggest`: call `vscode.lm.selectChatModels`, fall back to first available model, send prompt, return parsed suggestions; surface errors to caller

- [x] 2. Add `DiffApplier` utility
  - [x] 2.1 Create `src/diffApplier.ts` with exported `applyUnifiedDiff(originalContent: string, diff: string): string | null`
  - [x] 2.2 Implement unified-diff parser that handles standard `---`/`+++`/`@@` headers and context lines
  - [x] 2.3 Return `null` when any hunk cannot be located in the original content

- [x] 3. Register `kiro-profiler.optimizeWithLLM` command in `extension.ts`
  - [x] 3.1 Add command registration and `activationEvents` entry in `package.json`
  - [x] 3.2 Add `menus.editor/context` contribution in `package.json` scoped to JS/TS/Python `when` clause
  - [x] 3.3 Implement command handler: resolve active file, load most recent session via `SessionPersister`, guard on missing session with warning, call `LlmOptimizer.suggest`, populate `activeSuggestions` map
  - [x] 3.4 On success: call `dashboard.showSuggestions(suggestions)` and post each suggestion to the VS Code chat panel with Accept/Reject action buttons
  - [x] 3.5 On LLM error: show error message containing the error reason; no file changes

- [x] 4. Register `kiro-profiler.acceptSuggestion` command in `extension.ts`
  - [x] 4.1 Implement accept handler: look up suggestion from `activeSuggestions`, read current file content, call `applyUnifiedDiff`
  - [x] 4.2 On clean apply: write result via `vscode.WorkspaceEdit`, save document, show "Optimization applied. Re-profiling…"
  - [x] 4.3 On failed apply: show error "Could not apply suggestion: the file has changed since profiling. Please re-profile and try again." with no file changes
  - [x] 4.4 After successful apply: trigger re-profile using same config as original session, set `linkedPreSessionId`, save new session, call `dashboard.showSession` and `dashboard.showImprovement`

- [x] 5. Register `kiro-profiler.rejectSuggestion` command in `extension.ts`
  - [x] 5.1 Implement reject handler: add `suggestionId` to `rejectedSuggestions` map for current session, remove from `activeSuggestions`
  - [x] 5.2 Send updated (filtered) suggestion list to dashboard

- [x] 6. Register `kiro-profiler.acceptAllSuggestions` command in `extension.ts`
  - [x] 6.1 Sort active suggestions by `estimatedImpact` descending
  - [x] 6.2 Apply each diff sequentially; on failure skip and record warning, continue with remaining
  - [x] 6.3 After all attempts: show summary "Applied N of M suggestions. Re-profiling…", trigger re-profile

- [x] 7. Update `DashboardPanel`
  - [x] 7.1 Handle `requestLLMOptimization` message: forward to `kiro-profiler.optimizeWithLLM` command with `sessionId`
  - [x] 7.2 Handle `acceptAllSuggestions` message: forward to `kiro-profiler.acceptAllSuggestions` command
  - [x] 7.3 Add `showImprovement(original: ProfileSession, updated: ProfileSession): void` method that posts `{ type: 'showImprovement', original, updated }`

- [x] 8. Update webview (`webview.html`)
  - [x] 8.1 Add "Optimize with LLM" button to the primary metrics card; show only when a session is loaded
  - [x] 8.2 Add "Accept All" button to the suggestions section; show only when 2+ suggestions are present
  - [x] 8.3 Handle `showImprovement` message: render before/after metric comparison section
  - [x] 8.4 Wire button click handlers to send `requestLLMOptimization` and `acceptAllSuggestions` messages to the extension host

- [x] 9. Write property-based tests for `LlmOptimizer`
  - [x] 9.1 Property 1: for any session and source code, `buildPrompt` output contains required metric fields and JSON instruction
  - [x] 9.2 Property 2: for any source code string, embedded source in prompt never exceeds 32 000 chars; truncated inputs end with `// [truncated]`
  - [x] 9.3 Property 3: for any valid suggestion JSON array, `parseResponse` returns array where every element has valid fields
  - [x] 9.4 Property 4: for any malformed/non-array response string, `parseResponse` returns empty array without throwing

- [x] 10. Write property-based tests for `DiffApplier`
  - [x] 10.1 Property 9: for any list of suggestions with distinct `estimatedImpact`, Accept All applies them in descending order
  - [x] 10.2 Property 10: for any mix of valid and invalid diffs, Accept All applies valid ones and skips invalid ones

- [x] 11. Write property-based tests for suggestion lifecycle
  - [x] 11.1 Property 5: for any sessionId, dashboard button click sends message containing that exact sessionId
  - [x] 11.2 Property 6: for any `OptimizationSuggestion`, formatted chat message contains all required fields
  - [x] 11.3 Property 7 & 8: for any active suggestion list, rejecting a suggestion removes it from the list and it does not reappear on refresh
  - [x] 11.4 Property 11: for any original `ProfileSession`, re-profiled session has `linkedPreSessionId` equal to original `id`

- [x] 12. Write unit tests for error and edge-case scenarios
  - [x] 12.1 No active editor when command invoked → warning shown
  - [x] 12.2 No prior session for file → warning "Profile this file first…"
  - [x] 12.3 LLM API throws → error message shown, no file changes
  - [x] 12.4 Diff cannot be applied cleanly → error message shown, file unchanged
  - [x] 12.5 Re-profile exits non-zero → warning shown, partial session saved and displayed
  - [x] 12.6 Accept All with partial failures → summary "Applied N of M suggestions. Re-profiling…"
