---
inclusion: always
---

# LLM Optimization Feature

## LlmOptimizer

`LlmOptimizer` (`src/llmOptimizer.ts`) handles prompt construction, response parsing, and OpenAI API calls for generating code optimization suggestions.

### `buildPrompt(session, sourceCode)`

Builds the prompt sent to the model:

- Truncates `sourceCode` to 32,000 characters (32000 chars). When truncation occurs, appends `\n// [truncated]` as a marker.
- Embeds all `MetricsSummary` fields (peak RAM, avg RAM, avg CPU, execution time, energy, disk I/O, network I/O) into the prompt.
- Instructs the model to return **only** a JSON array of `OptimizationSuggestion` objects.

### `parseResponse(raw)`

Extracts and validates the model's response:

- Finds the first `[…]` JSON array in the raw string by scanning for balanced brackets.
- Validates each element against the `OptimizationSuggestion` shape via `isValidSuggestionShape`.
- Assigns a UUID `id` if the element's `id` field is missing or empty.
- Silently drops malformed entries — never throws on bad model output.

### `suggest(session, sourceCode)`

Orchestrates the full LLM call:

- Resolves the API key via `resolveApiKey()` (see resolution order below).
- Calls `gpt-4o-mini` via the `openai` SDK with `temperature: 0`.
- Returns the parsed `OptimizationSuggestion[]` from `parseResponse`.

---

## DiffApplier

`applyUnifiedDiff(originalContent, diff)` (`src/diffApplier.ts`) applies a unified diff to a source file string.

**Contracts:**

- Returns the patched content string on success.
- Returns `null` if any hunk cannot be located in the original content — the caller must handle this and not write partial results.
- An empty diff (no hunks parsed) is a no-op — returns `originalContent` unchanged.
- Hunk location uses an outward search from the `origStart` hint (1-based line number from the `@@ -origStart,count @@` header) to tolerate minor line-number drift between when the file was profiled and when the suggestion is accepted.

---

## Suggestion Lifecycle

Suggestions flow through two module-level maps in `extension.ts`:

- `activeSuggestions: Map<string, OptimizationSuggestion>` — keyed by suggestion `id`; holds all pending suggestions.
- `suggestionFilePaths: Map<string, string>` — maps suggestion `id` to the absolute file path it targets; allows accept/reject to work without an active editor.

### Accept Flow (`kiro-profiler.acceptSuggestion`)

1. Look up the suggestion in `activeSuggestions`.
2. Resolve the file path from `suggestionFilePaths`.
3. Call `applyUnifiedDiff(currentContent, suggestion.diff)`.
4. If `null` is returned, show an error — do not write the file.
5. Write the patched content via `WorkspaceEdit` + `document.save()`.
6. Remove the suggestion from both `activeSuggestions` and `suggestionFilePaths`.
7. Trigger a re-profile; the new `ProfileSession` has `linkedPreSessionId` set to the original session's `id`.

### Reject Flow (`kiro-profiler.rejectSuggestion`)

1. Remove the suggestion from `activeSuggestions` (and `suggestionFilePaths`).
2. Add the suggestion `id` to `rejectedSuggestions: Map<string, Set<string>>` (keyed by session `id`) so it does not reappear on dashboard refresh.
3. Push the updated (filtered) suggestion list to the dashboard.

### Accept All Flow (`kiro-profiler.acceptAllSuggestions`)

1. Sort all entries in `activeSuggestions` by `estimatedImpact` descending.
2. Apply diffs sequentially to the accumulating file content — each iteration feeds the output of the previous `applyUnifiedDiff` call as the next input.
3. Skip any suggestion whose diff fails to apply (returns `null`) without aborting the remaining suggestions.
4. Write the final accumulated content to disk once via `WorkspaceEdit`.
5. Trigger a single re-profile at the end; the new session has `linkedPreSessionId` set to the original session's `id`.

---

## API Key Resolution Order

`resolveApiKey()` checks sources in this order and returns the first non-empty value:

1. VS Code extension settings: `kiro-profiler.openaiApiKey` (via `ConfigurationManager`)
2. Environment variable: `OPENAI_API_KEY`
3. VS Code secret storage: key `kiro-profiler.openaiApiKey` (set via the dashboard settings UI)

If none of the three sources yields a key, `resolveApiKey` throws with a user-facing message directing to extension settings.

---

## `OptimizationSuggestion` Type

Defined in `src/types.ts`:

| Field | Type | Constraint |
|---|---|---|
| `id` | `string` | UUID v4; assigned by `parseResponse` if the model omits it |
| `title` | `string` | non-empty |
| `explanation` | `string` | non-empty |
| `estimatedImpact` | `number` | 0–1 inclusive |
| `affectedMetric` | `'ram' \| 'cpu' \| 'energy' \| 'disk' \| 'network'` | one of the five values |
| `diff` | `string` | unified diff format |
