# Suggestion Accept No Active Editor Bugfix Design

## Overview

When the Kiro Code Profiler dashboard is focused, `vscode.window.activeTextEditor` returns
`undefined` because the dashboard is a webview panel, not a text editor. The `acceptSuggestion`
and `acceptAllSuggestions` command handlers previously fell back to requiring an active editor
to resolve the target file path, causing a "No active editor" error.

The fix introduces a `suggestionFilePaths` map (keyed by `suggestionId`) that is populated when
LLM suggestions are generated. Both accept handlers now resolve the target file path from this
map instead of from `vscode.window.activeTextEditor`, making them work regardless of editor focus.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — when `acceptSuggestion` or
  `acceptAllSuggestions` is invoked and `vscode.window.activeTextEditor` is `undefined` (i.e.
  the dashboard webview is focused)
- **Property (P)**: The desired behavior — the accept handlers SHALL resolve the target file
  path from `suggestionFilePaths` and apply the optimization without requiring an active editor
- **Preservation**: Existing accept/reject behavior when a text editor IS active, and all
  reject behavior, must remain unchanged by the fix
- **suggestionFilePaths**: `Map<string, string>` in `extension.ts` that maps `suggestionId →
  filePath`; populated in `optimizeWithLLM` alongside `activeSuggestions`
- **activeSuggestions**: `Map<string, OptimizationSuggestion>` in `extension.ts` that holds
  suggestions pending user action
- **acceptSuggestion**: The `kiro-profiler.acceptSuggestion` command handler in `extension.ts`
- **acceptAllSuggestions**: The `kiro-profiler.acceptAllSuggestions` command handler in
  `extension.ts`

## Bug Details

### Bug Condition

The bug manifests when the user clicks "Accept" or "Accept All" in the dashboard while the
dashboard webview panel is focused. In that state `vscode.window.activeTextEditor` is
`undefined`, so any code path that uses the active editor to determine the target file path
will fail with a "No active editor" error.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input — { suggestionId: string, activeEditor: vscode.TextEditor | undefined }
  OUTPUT: boolean

  RETURN input.activeEditor === undefined
         AND suggestionFilePaths.has(input.suggestionId)
         AND activeSuggestions.has(input.suggestionId)
END FUNCTION
```

### Examples

- User runs "Optimize with LLM" from the dashboard, then clicks "Accept" on a suggestion
  while the dashboard is still focused → "No active editor" error, optimization not applied
- User runs "Optimize with LLM", switches focus to the dashboard, then clicks "Accept All"
  → "No active editor" error, no optimizations applied
- User runs "Optimize with LLM", then opens a text file (active editor present), then clicks
  "Accept" → optimization applies correctly (not a bug condition)
- User clicks "Accept" for a suggestionId that has no entry in `suggestionFilePaths` → error
  message "Could not determine file for this suggestion" (edge case, not the primary bug)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- When a text editor IS active, clicking "Accept" must continue to apply the optimization and
  re-profile the file exactly as before
- When a text editor IS active, clicking "Accept All" must continue to apply all optimizations
  sequentially and re-profile the file exactly as before
- Clicking "Reject" on a suggestion must continue to remove it from `activeSuggestions` and
  update the dashboard, regardless of editor focus
- When a suggestion's diff cannot be applied to the current file content, the error message
  "Could not apply suggestion: the file has changed since profiling" must still be shown and
  the file must remain unchanged

**Scope:**
All inputs that do NOT involve the bug condition (i.e. where `activeEditor` is defined, or
where the action is "Reject") should be completely unaffected by this fix. This includes:
- Accept/Accept All when a text editor is focused
- Reject in any editor focus state
- Profile, Monitor, and other commands

## Hypothesized Root Cause

Based on the bug description and code review of `extension.ts`, the root cause is already
identified and fixed. The analysis below documents what the original defect was:

1. **Missing file-path resolution fallback**: The original `acceptSuggestion` handler relied
   on `vscode.window.activeTextEditor` to obtain the file path. When the dashboard webview
   was focused, this returned `undefined` and the handler exited with an error before reaching
   the diff-apply logic.

2. **`acceptAllSuggestions` same issue**: The original `acceptAllSuggestions` handler had the
   same dependency on `activeTextEditor` for file path resolution.

3. **No pre-stored file mapping**: Before the fix, there was no `suggestionFilePaths` map.
   The file path was only available at the time of suggestion generation (inside
   `optimizeWithLLM`) but was not persisted for later use by the accept handlers.

4. **Webview focus semantics**: VS Code sets `activeTextEditor` to `undefined` whenever a
   non-editor panel (such as a webview) is focused. This is expected VS Code behavior, not a
   bug in VS Code itself.

## Correctness Properties

Property 1: Bug Condition - Accept Resolves File Without Active Editor

_For any_ `suggestionId` where `isBugCondition` holds (i.e. `activeEditor` is `undefined`,
`suggestionFilePaths` has the id, and `activeSuggestions` has the id), the fixed
`acceptSuggestion` handler SHALL resolve the target file path from `suggestionFilePaths` and
proceed to apply the diff, without requiring `vscode.window.activeTextEditor` to be defined.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Accept Behavior Is Unchanged When Editor Is Active

_For any_ `suggestionId` where the bug condition does NOT hold (i.e. `activeEditor` is
defined), the fixed `acceptSuggestion` and `acceptAllSuggestions` handlers SHALL produce the
same observable outcome as the original handlers — the diff is applied, the file is saved,
and re-profiling is triggered — preserving all existing accept behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

The fix is already implemented in `extension.ts`. This section documents the changes for
traceability.

**File**: `kiro-code-profiler/src/extension.ts`

**Specific Changes**:

1. **Added `suggestionFilePaths` map**: A new module-level `Map<string, string>` exported as
   `suggestionFilePaths` stores `suggestionId → filePath` for every active suggestion.

2. **Populated in `optimizeWithLLM`**: After generating suggestions, the handler now calls
   `suggestionFilePaths.set(suggestion.id, session.filePath)` for each suggestion alongside
   `activeSuggestions.set(suggestion.id, suggestion)`.

3. **`acceptSuggestion` uses `suggestionFilePaths`**: The handler now calls
   `suggestionFilePaths.get(suggestionId)` to resolve the file path. If the entry is missing,
   it shows an error asking the user to re-run LLM optimization. It no longer reads
   `vscode.window.activeTextEditor` for file path resolution.

4. **`acceptAllSuggestions` uses `suggestionFilePaths`**: The handler groups suggestions by
   file path using `suggestionFilePaths` (via the `byFile` map) instead of relying on the
   active editor.

5. **Cleanup on accept**: Both handlers call `suggestionFilePaths.delete(suggestionId)` after
   successfully applying a suggestion, keeping the map consistent with `activeSuggestions`.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that
demonstrate the bug on unfixed code, then verify the fix works correctly and preserves
existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix.
Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Extract the file-path resolution logic from `acceptSuggestion` and
`acceptAllSuggestions` into a pure helper function. Write tests that call this helper with
`activeEditor = undefined` and assert that the file path is resolved from `suggestionFilePaths`.
Run these tests against the UNFIXED logic (which reads from `activeEditor`) to observe failures.

**Test Cases**:
1. **Accept with no active editor**: Call accept logic with `activeEditor = undefined` and a
   valid `suggestionFilePaths` entry — should return the stored file path (fails on unfixed code)
2. **Accept All with no active editor**: Call accept-all logic with `activeEditor = undefined`
   and valid `suggestionFilePaths` entries — should group by stored file paths (fails on unfixed code)
3. **Accept with missing file path entry**: Call accept logic with `activeEditor = undefined`
   and no `suggestionFilePaths` entry — should return an error, not crash (may fail on unfixed code)
4. **Accept All with empty suggestionFilePaths**: Call accept-all with no file path entries —
   should show warning and return early (may fail on unfixed code)

**Expected Counterexamples**:
- File path resolution returns `undefined` when `activeEditor` is `undefined`
- Possible causes: no fallback to `suggestionFilePaths`, missing map population in
  `optimizeWithLLM`, or map not exported for testing

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function
produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := resolveFilePath_fixed(input.suggestionId, activeEditor=undefined)
  ASSERT result === suggestionFilePaths.get(input.suggestionId)
  ASSERT result !== undefined
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function
produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT resolveFilePath_original(input) === resolveFilePath_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for accept with an active editor, then
write property-based tests capturing that behavior.

**Test Cases**:
1. **Accept with active editor preservation**: Verify that when `activeEditor` is defined and
   `suggestionFilePaths` has the entry, the resolved file path is the same in both original
   and fixed code
2. **Reject preservation**: Verify that reject logic is completely unaffected by the
   `suggestionFilePaths` map changes
3. **Diff apply failure preservation**: Verify that when `applyUnifiedDiff` returns `null`,
   the error message path is unchanged

### Unit Tests

- Test `resolveFilePath` helper: returns stored path when `activeEditor` is `undefined`
- Test `resolveFilePath` helper: returns stored path when `activeEditor` is defined (same result)
- Test `resolveFilePath` helper: returns `undefined` when `suggestionId` not in map
- Test accept-all file grouping: `byFile` map is correctly built from `suggestionFilePaths`
- Test accept-all with empty `suggestionFilePaths`: shows warning and returns early

### Property-Based Tests

- For any `suggestionId` and `filePath` pair stored in `suggestionFilePaths`, the fixed
  `resolveFilePath` function SHALL return `filePath` regardless of `activeEditor` state
- For any set of suggestions all mapped to the same file path, `acceptAllSuggestions` SHALL
  group them into a single `byFile` entry
- For any `suggestionId` not in `suggestionFilePaths`, the accept handler SHALL return an
  error result (not throw)

### Integration Tests

- Full flow: run `optimizeWithLLM` from dashboard (no active editor), then `acceptSuggestion`
  — verify optimization is applied and re-profile is triggered
- Full flow: run `optimizeWithLLM` from dashboard, then `acceptAllSuggestions` — verify all
  applicable diffs are applied
- Verify `suggestionFilePaths` is cleaned up after accept (no stale entries)
- Verify reject flow is unaffected: reject a suggestion, confirm it is removed from
  `activeSuggestions` and `suggestionFilePaths`
