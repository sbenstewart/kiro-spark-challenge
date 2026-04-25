# Implementation Plan

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Accept Resolves File Without Active Editor
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to the concrete failing case — `activeEditor = undefined` with a valid `suggestionFilePaths` entry
  - Create a test file `kiro-code-profiler/src/tests/suggestionAcceptNoActiveEditor.test.ts`
  - Import `activeSuggestions`, `suggestionFilePaths` from `extension.ts` and `applyUnifiedDiff` from `diffApplier.ts`
  - Simulate the bug condition: populate `activeSuggestions` and `suggestionFilePaths` with a suggestion, then call the file-path resolution logic with `activeEditor = undefined`
  - For all `suggestionId` values where `isBugCondition` holds (`activeEditor === undefined`, `suggestionFilePaths.has(id)`, `activeSuggestions.has(id)`), assert that the resolved file path equals `suggestionFilePaths.get(id)` and is not `undefined`
  - Run test on UNFIXED code (before the `suggestionFilePaths` map and its usage in accept handlers exist)
  - **EXPECTED OUTCOME**: Test FAILS (proves the bug — file path resolution returns `undefined` when `activeEditor` is `undefined`)
  - Document counterexamples found (e.g., `resolveFilePath(id, undefined)` returns `undefined` instead of the stored path)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Accept Behavior Is Unchanged When Editor Is Active
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (cases where `activeEditor` is defined)
  - Observe: when `activeEditor` is defined and `suggestionFilePaths` has the entry, the resolved file path is the stored path
  - Observe: reject logic removes the suggestion from `activeSuggestions` regardless of editor focus
  - Observe: when `applyUnifiedDiff` returns `null`, the error path is reached and the file is unchanged
  - Write property-based tests in `kiro-code-profiler/src/tests/suggestionAcceptNoActiveEditor.test.ts`:
    - For all `suggestionId` values where `activeEditor` is defined, assert the resolved file path is the same in both original and fixed code
    - For any suggestion rejected via `rejectSuggestion`, assert it is removed from `activeSuggestions` and `suggestionFilePaths`
    - For any diff that `applyUnifiedDiff` returns `null` for, assert the error message path is reached and the file is not modified
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 3. Fix: accept suggestion/accept-all without requiring active editor

  - [ ] 3.1 Implement the fix in `extension.ts`
    - Add module-level `suggestionFilePaths` map: `export const suggestionFilePaths = new Map<string, string>()`
    - In `optimizeWithLLM`, after `activeSuggestions.set(suggestion.id, suggestion)`, also call `suggestionFilePaths.set(suggestion.id, session.filePath)` for each suggestion
    - In `acceptSuggestion`: replace the `vscode.window.activeTextEditor` file-path lookup with `suggestionFilePaths.get(suggestionId)`; show error "Could not determine file for this suggestion. Please re-run LLM optimization." if the entry is missing; call `suggestionFilePaths.delete(suggestionId)` after successful apply
    - In `acceptAllSuggestions`: build the `byFile` grouping map from `suggestionFilePaths` instead of from `activeTextEditor`; show warning and return early if `byFile.size === 0`; call `suggestionFilePaths.delete(suggestion.id)` for each applied suggestion
    - _Bug_Condition: `isBugCondition(input)` where `input.activeEditor === undefined` AND `suggestionFilePaths.has(input.suggestionId)` AND `activeSuggestions.has(input.suggestionId)`_
    - _Expected_Behavior: `resolveFilePath(suggestionId, undefined)` returns `suggestionFilePaths.get(suggestionId)` (not `undefined`); accept proceeds to apply diff and re-profile_
    - _Preservation: accept/accept-all with active editor, reject in any focus state, and diff-apply-failure error path must all behave identically to pre-fix code_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_

  - [ ] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Accept Resolves File Without Active Editor
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the fixed `acceptSuggestion` and `acceptAllSuggestions` handlers resolve the file path from `suggestionFilePaths` when `activeEditor` is `undefined`
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2_

  - [ ] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Accept Behavior Is Unchanged When Editor Is Active
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in accept-with-editor, reject, and diff-failure paths)
    - Confirm all tests still pass after fix (no regressions)

- [ ] 4. Checkpoint - Ensure all tests pass
  - Run the full test suite: `cd kiro-code-profiler && npx vitest --run`
  - Ensure all tests pass, ask the user if questions arise.
