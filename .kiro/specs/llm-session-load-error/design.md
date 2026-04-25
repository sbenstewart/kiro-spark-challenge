# LLM Session Load Error Bugfix Design

## Overview

When the user right-clicks a file in the editor and selects "Kiro Profiler: Optimize with LLM" from the context menu, VS Code passes the active file's `Uri` object as the first argument to the command handler. The handler's `if (sessionIdArg)` check is truthy for a `Uri` object, so it enters the session-by-ID branch and calls `persister.load(uri)` with a non-string argument. That load fails, the fallback may also fail, and the user sees "Could not load the requested session." instead of running LLM optimization.

The fix is a one-line change: replace `if (sessionIdArg)` with `if (typeof sessionIdArg === 'string')` in the `optimizeWithLLM` command handler in `extension.ts`. This ensures a `Uri` object falls through to the active-editor path, while dashboard invocations with a real string session ID continue to work as before.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — `sessionIdArg` is a truthy non-string value (specifically a `vscode.Uri` object passed by VS Code from the context menu)
- **Property (P)**: The desired behavior when the bug condition holds — the handler treats the invocation as a context-menu call and uses the active editor path
- **Preservation**: Existing dashboard invocation behavior (string `sessionId`) and all other command paths that must remain unchanged by the fix
- **optimizeWithLLM**: The command handler registered in `kiro-code-profiler/src/extension.ts` that dispatches between the dashboard path (string `sessionId`) and the active-editor path (no `sessionId`)
- **sessionIdArg**: The optional first argument passed to the `optimizeWithLLM` command handler; a string when invoked from the dashboard, a `vscode.Uri` when invoked from the editor context menu, and `undefined` when invoked from the command palette
- **active-editor path**: The code branch in `optimizeWithLLM` that uses `vscode.window.activeTextEditor` to find the file and look up the most recent session for it

## Bug Details

### Bug Condition

The bug manifests when the user invokes "Optimize with LLM" from the editor context menu. VS Code passes the active file's `Uri` as `sessionIdArg`. Because `Uri` objects are truthy, the handler enters the `if (sessionIdArg)` branch and calls `persister.load(sessionIdArg)` with a `Uri` instead of a session ID string. The load fails (the file path constructed from a `Uri` object is nonsensical), the fallback to the most recent session may also fail or be absent, and the error message is shown.

**Formal Specification:**
```
FUNCTION isBugCondition(sessionIdArg)
  INPUT: sessionIdArg of type string | vscode.Uri | undefined
  OUTPUT: boolean

  RETURN sessionIdArg IS NOT undefined
         AND typeof sessionIdArg !== 'string'
END FUNCTION
```

### Examples

- User right-clicks `metricsCollector.ts` → context menu → "Optimize with LLM": `sessionIdArg` is `Uri { fsPath: '/workspace/metricsCollector.ts' }`, handler enters the string branch, `persister.load(uri)` fails → "Could not load the requested session." shown, no optimization runs
- User right-clicks any file with no prior profiling session: same Uri-passing behavior, same failure
- User invokes from command palette (no argument): `sessionIdArg` is `undefined`, falls through to active-editor path correctly — this is NOT the bug condition
- User invokes from dashboard with `sessionId = "abc-123"`: `sessionIdArg` is a string, enters string branch correctly — this is NOT the bug condition

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Dashboard invocations with a valid string `sessionId` must continue to load the session by ID and run LLM optimization
- Dashboard invocations with an invalid or missing `sessionId` must continue to fall back to the most recent session and show "Could not load the requested session." if none is found
- Context-menu invocations where no prior session exists for the active file must continue to show "Profile this file first before requesting optimization."
- Context-menu invocations where no active editor is open must continue to show "No active editor."

**Scope:**
All inputs where `sessionIdArg` is a string (dashboard path) or `undefined` (command palette path) must be completely unaffected by this fix. The only change in behavior is for inputs where `sessionIdArg` is a non-string truthy value (i.e., a `vscode.Uri`).

## Hypothesized Root Cause

The root cause is a type-unsafe truthiness check in the `optimizeWithLLM` command handler:

1. **Overly broad truthy check**: `if (sessionIdArg)` treats any truthy value as a valid session ID string. A `vscode.Uri` object is truthy, so it passes the check even though it is not a string.

2. **VS Code context menu argument injection**: When a command is registered and invoked from the editor context menu (via `menus` contribution in `package.json`), VS Code automatically passes the active resource `Uri` as the first argument. The handler was not written to account for this.

3. **No type guard before `persister.load`**: The handler passes `sessionIdArg` directly to `persister.load()` without verifying it is a string. `SessionPersister.load` constructs a file path using the argument as a session ID string, producing a nonsensical path when given a `Uri` object.

## Correctness Properties

Property 1: Bug Condition - Uri Argument Falls Through to Active-Editor Path

_For any_ invocation where `sessionIdArg` is a non-string truthy value (isBugCondition returns true), the fixed `optimizeWithLLM` handler SHALL treat the invocation as a context-menu call with no explicit session ID, using the active editor's file path to look up the most recent session — identical to the behavior when `sessionIdArg` is `undefined`.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - String SessionId Behavior Unchanged

_For any_ invocation where `sessionIdArg` is a string (isBugCondition returns false), the fixed handler SHALL produce exactly the same behavior as the original handler, preserving the dashboard session-load path including both the success case and the fallback-to-most-recent-session case.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

**File**: `kiro-code-profiler/src/extension.ts`

**Function**: `optimizeWithLLM` command handler (the anonymous async function passed to `registerCommand`)

**Specific Changes**:

1. **Replace truthiness check with type guard**: Change the condition from `if (sessionIdArg)` to `if (typeof sessionIdArg === 'string')`.
   - Before: `if (sessionIdArg) {`
   - After: `if (typeof sessionIdArg === 'string') {`

2. **Update the parameter type annotation** (optional but recommended): Change `sessionIdArg?: string` to `sessionIdArg?: string | unknown` or leave as `string` since the runtime value may be a `Uri` — the type guard handles it either way.

That is the complete fix. No other changes are required.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis.

**Test Plan**: Write a test that simulates the `optimizeWithLLM` handler receiving a `Uri` object as `sessionIdArg`. Assert that the handler enters the active-editor path (not the session-load path). Run on UNFIXED code to observe that it incorrectly enters the session-load branch.

**Test Cases**:
1. **Uri as sessionIdArg**: Call the handler with a mock `vscode.Uri` object as the argument; assert that `persister.load` is NOT called with the Uri (will fail on unfixed code)
2. **Uri with valid session**: Call the handler with a Uri when a valid session exists for the active file; assert that optimization proceeds without error (will fail on unfixed code)
3. **Uri with no active editor**: Call the handler with a Uri when no active editor is open; assert "No active editor." warning is shown (will fail on unfixed code — currently shows "Could not load the requested session." instead)
4. **Uri with no prior session**: Call the handler with a Uri when no session exists for the active file; assert "Profile this file first…" warning is shown (will fail on unfixed code)

**Expected Counterexamples**:
- `persister.load` is called with a `Uri` object instead of a string session ID
- Possible causes: missing type guard, VS Code context menu argument injection not accounted for

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL sessionIdArg WHERE isBugCondition(sessionIdArg) DO
  result := optimizeWithLLM_fixed(sessionIdArg)
  ASSERT persister.load was NOT called with sessionIdArg
  ASSERT handler used active-editor path
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL sessionIdArg WHERE NOT isBugCondition(sessionIdArg) DO
  ASSERT optimizeWithLLM_original(sessionIdArg) = optimizeWithLLM_fixed(sessionIdArg)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many string session ID values automatically, covering valid UUIDs, empty strings, and arbitrary strings
- It catches edge cases that manual unit tests might miss (e.g., numeric strings, strings that look like file paths)
- It provides strong guarantees that the string-sessionId path is completely unaffected

**Test Plan**: Observe behavior on UNFIXED code for string `sessionId` and `undefined` inputs, then write property-based tests capturing that behavior.

**Test Cases**:
1. **String sessionId preservation**: Verify that passing a valid UUID string still calls `persister.load` with that string
2. **Undefined preservation**: Verify that passing `undefined` still uses the active-editor path
3. **Invalid string sessionId preservation**: Verify that passing an invalid string still falls back to most-recent-session and shows the error if none found
4. **No active editor preservation**: Verify that the "No active editor." warning still fires when no editor is open and no string sessionId is provided

### Unit Tests

- Test that `typeof sessionIdArg === 'string'` correctly distinguishes string session IDs from Uri objects
- Test the handler with a mock Uri object: assert active-editor path is taken, `persister.load` not called with Uri
- Test the handler with a valid string sessionId: assert `persister.load` called with that string
- Test the handler with `undefined`: assert active-editor path is taken

### Property-Based Tests

- Generate arbitrary string values as `sessionIdArg` and verify the handler always enters the session-load branch (not the active-editor branch)
- Generate arbitrary non-string truthy values (objects, arrays, numbers) as `sessionIdArg` and verify the handler always enters the active-editor branch
- Generate random `vscode.Uri`-shaped objects and verify none of them cause `persister.load` to be called with a non-string

### Integration Tests

- Full flow: right-click context menu simulation → handler receives Uri → active-editor path → session found → LLM optimization runs
- Full flow: dashboard invocation → handler receives string sessionId → session loaded by ID → LLM optimization runs
- Edge case: context menu invocation with no prior session → "Profile this file first…" shown
- Edge case: context menu invocation with no active editor → "No active editor." shown
