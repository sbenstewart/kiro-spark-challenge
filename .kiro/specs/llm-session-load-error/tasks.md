# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Uri Argument Incorrectly Enters Session-Load Branch
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to the concrete failing case — a `vscode.Uri` object passed as `sessionIdArg`
  - Create `kiro-code-profiler/src/tests/llmSessionLoadError.test.ts`
  - Mock `persister.load` and `persister.list` to observe which branch is taken
  - Test: call the handler logic with a mock `vscode.Uri` object as `sessionIdArg`; assert `persister.load` is NOT called with the Uri object (isBugCondition: `sessionIdArg` is truthy AND `typeof sessionIdArg !== 'string'`)
  - Test: call the handler logic with a Uri when no active editor is open; assert "No active editor." warning is shown (not "Could not load the requested session.")
  - Test: call the handler logic with a Uri when no prior session exists; assert "Profile this file first…" warning is shown
  - Run test on UNFIXED code (`if (sessionIdArg)` branch)
  - **EXPECTED OUTCOME**: Tests FAIL (proves the bug — Uri enters the session-load branch instead of the active-editor path)
  - Document counterexamples found (e.g., `persister.load` called with `Uri { fsPath: '/workspace/file.ts' }`)
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - String SessionId and Undefined Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: calling handler with a valid string `sessionId` calls `persister.load(sessionId)` on unfixed code
  - Observe: calling handler with `undefined` uses the active-editor path on unfixed code
  - Observe: calling handler with an invalid string falls back to most-recent session and shows "Could not load the requested session." if none found
  - Write property-based tests in `kiro-code-profiler/src/tests/llmSessionLoadError.test.ts`:
    - For all string values as `sessionIdArg` (valid UUIDs, empty strings, arbitrary strings): assert `persister.load` is called with that string (not the active-editor path)
    - For `undefined` as `sessionIdArg`: assert active-editor path is taken
    - For invalid string `sessionId` with no sessions: assert "Could not load the requested session." warning is shown
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix the Uri argument type guard bug in optimizeWithLLM

  - [x] 3.1 Implement the one-line fix in extension.ts
    - In `kiro-code-profiler/src/extension.ts`, locate the `optimizeWithLLM` command handler
    - Change `if (sessionIdArg) {` to `if (typeof sessionIdArg === 'string') {`
    - This ensures a `vscode.Uri` object (truthy but not a string) falls through to the active-editor path
    - No other changes are required
    - _Bug_Condition: isBugCondition(sessionIdArg) where sessionIdArg IS NOT undefined AND typeof sessionIdArg !== 'string'_
    - _Expected_Behavior: handler treats Uri invocation as context-menu call, uses active-editor path, does NOT call persister.load with the Uri_
    - _Preservation: string sessionId path and undefined path must produce identical behavior to the original handler_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Uri Argument Falls Through to Active-Editor Path
    - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
    - The tests from task 1 encode the expected behavior (persister.load not called with Uri, correct warnings shown)
    - Run bug condition exploration tests from step 1
    - **EXPECTED OUTCOME**: Tests PASS (confirms the Uri is no longer treated as a session ID)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - String SessionId and Undefined Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in dashboard and command-palette paths)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the full test suite: `cd kiro-code-profiler && npx vitest --run`
  - Ensure all tests pass, ask the user if questions arise.
