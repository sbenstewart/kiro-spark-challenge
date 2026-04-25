# Requirements Document

## Introduction

This feature adds LLM-powered code optimization to the kiro-code-profiler extension. When a user profiles a file, they can trigger an LLM analysis that examines the profiling metrics and source code, then produces targeted suggestions to improve execution speed. Suggestions are surfaced in the Kiro AI chat panel as well as in the existing dashboard. The user can accept individual suggestions (applying the diff directly to the source file), reject them, or accept all at once. After applying changes, the extension automatically re-profiles the file against the previously saved baseline so the user can see a concrete before/after metrics comparison.

## Glossary

- **Optimizer**: The extension module responsible for constructing LLM prompts and parsing LLM responses into structured suggestions.
- **LLM_Client**: The VS Code / Kiro language model API (`vscode.lm`) used to send requests to the configured language model.
- **Dashboard**: The existing webview panel (`DashboardPanel`) that displays profiling results.
- **AI_Panel**: The Kiro / VS Code AI chat panel where LLM suggestions are surfaced as a chat response.
- **ProfileSession**: A persisted record of a single profiling run, including metrics and source snapshot.
- **Suggestion**: A structured optimization recommendation containing a title, explanation, estimated impact, affected metric, and a unified diff.
- **Baseline**: A previously saved `ProfileSession` marked by the user as the reference point for comparison.
- **Re-profile**: A new profiling run triggered automatically after applying a suggestion, using the same file and configuration as the original session.

## Requirements

### Requirement 1: Trigger LLM Optimization from the Editor

**User Story:** As a developer, I want to trigger LLM-based optimization from the editor context menu, so that I can request suggestions without leaving my code.

#### Acceptance Criteria

1. THE Extension SHALL register a command `kiro-profiler.optimizeWithLLM` accessible via the editor right-click context menu when the active file language is JavaScript, TypeScript, or Python.
2. WHEN the command `kiro-profiler.optimizeWithLLM` is invoked and no prior `ProfileSession` exists for the active file, THEN THE Extension SHALL display a warning message: "Profile this file first before requesting optimization."
3. WHEN the command `kiro-profiler.optimizeWithLLM` is invoked and a `ProfileSession` exists for the active file, THE Extension SHALL proceed to the LLM analysis flow defined in Requirement 3.

---

### Requirement 2: Trigger LLM Optimization from the Dashboard

**User Story:** As a developer, I want to trigger LLM-based optimization from the profiling dashboard, so that I can request suggestions in context of the metrics I am viewing.

#### Acceptance Criteria

1. THE Dashboard SHALL display an "Optimize with LLM" button in the primary metrics card whenever a `ProfileSession` is loaded.
2. WHEN the "Optimize with LLM" button is clicked, THE Dashboard SHALL send a `requestLLMOptimization` message to the extension host containing the current `sessionId`.
3. WHEN the extension host receives a `requestLLMOptimization` message, THE Extension SHALL proceed to the LLM analysis flow defined in Requirement 3.

---

### Requirement 3: LLM Analysis and Suggestion Generation

**User Story:** As a developer, I want the extension to send my code and profiling metrics to an LLM, so that I receive targeted, metric-aware optimization suggestions.

#### Acceptance Criteria

1. WHEN the LLM analysis flow is initiated, THE Optimizer SHALL construct a prompt containing: the source code of the profiled file, the `MetricsSummary` (peak RAM, avg CPU, execution time, energy, disk I/O), and an instruction to return suggestions as a JSON array.
2. THE Optimizer SHALL invoke `LLM_Client` using `vscode.lm.selectChatModels` to select the user's active language model, falling back to the first available model if none is selected.
3. WHEN `LLM_Client` returns a response, THE Optimizer SHALL parse the response into an array of `Suggestion` objects, each containing: `id` (UUID), `title` (string), `explanation` (string), `estimatedImpact` (number 0–1), `affectedMetric` ('ram' | 'cpu' | 'energy' | 'disk' | 'network'), and `diff` (unified diff string).
4. IF the LLM response cannot be parsed into valid `Suggestion` objects, THEN THE Optimizer SHALL return an empty array and THE Extension SHALL display a warning: "LLM returned an unrecognized response format."
5. IF `LLM_Client` throws an error (e.g. model unavailable, rate limit), THEN THE Extension SHALL display an error message containing the error reason and SHALL NOT modify any source files.
6. THE Optimizer SHALL limit the prompt source code to 8000 tokens by truncating from the end and appending a `// [truncated]` comment when the file exceeds this limit.

---

### Requirement 4: Surface Suggestions in the Kiro AI Panel

**User Story:** As a developer, I want optimization suggestions shown in the Kiro AI chat panel, so that I can read the LLM's reasoning in a familiar conversational interface.

#### Acceptance Criteria

1. WHEN `Suggestion` objects are generated, THE Extension SHALL open a Kiro / VS Code chat session using `vscode.chat` and post each suggestion as a formatted message containing the title, explanation, estimated impact percentage, affected metric, and the unified diff in a fenced code block.
2. THE AI_Panel message for each `Suggestion` SHALL include inline action buttons "Accept" and "Reject" rendered via `vscode.ChatResponseCommandButtonPart` (or equivalent Kiro chat API).
3. WHEN the user clicks "Accept" on a suggestion in the AI_Panel, THE Extension SHALL apply the suggestion's diff to the source file as defined in Requirement 5.
4. WHEN the user clicks "Reject" on a suggestion in the AI_Panel, THE Extension SHALL mark the suggestion as rejected and remove it from the active suggestion list without modifying the source file.

---

### Requirement 5: Apply Suggestion Diff to Source File

**User Story:** As a developer, I want to accept an individual optimization suggestion and have it applied to my file automatically, so that I don't have to manually edit the code.

#### Acceptance Criteria

1. WHEN a suggestion is accepted (from either the AI_Panel or the Dashboard), THE Extension SHALL apply the suggestion's unified diff to the target source file using the VS Code workspace edit API.
2. WHEN the diff is applied successfully, THE Extension SHALL save the modified file and display an information message: "Optimization applied. Re-profiling…"
3. IF the diff cannot be applied cleanly (e.g. the file has changed since profiling), THEN THE Extension SHALL display an error message: "Could not apply suggestion: the file has changed since profiling. Please re-profile and try again." and SHALL NOT modify the source file.
4. THE Extension SHALL support accepting multiple suggestions sequentially; each accepted suggestion SHALL be applied to the current state of the file at the time of acceptance.

---

### Requirement 6: Accept All Suggestions

**User Story:** As a developer, I want to accept all suggestions at once, so that I can apply every recommended optimization in a single action.

#### Acceptance Criteria

1. THE Dashboard SHALL display an "Accept All" button in the suggestions section when two or more `Suggestion` objects are present.
2. WHEN the "Accept All" button is clicked, THE Extension SHALL apply each suggestion's diff sequentially in descending order of `estimatedImpact`.
3. IF any individual diff fails to apply during an "Accept All" operation, THE Extension SHALL skip that suggestion, record a warning, and continue applying the remaining suggestions.
4. WHEN all applicable diffs have been applied, THE Extension SHALL display a summary message: "Applied N of M suggestions. Re-profiling…"

---

### Requirement 7: Automatic Re-profile After Applying Suggestions

**User Story:** As a developer, I want the file to be automatically re-profiled after I apply suggestions, so that I can immediately see whether the optimization improved the metrics.

#### Acceptance Criteria

1. WHEN one or more suggestions are applied successfully, THE Extension SHALL automatically trigger a new profiling run on the modified file using the same configuration as the original `ProfileSession`.
2. THE Extension SHALL link the new `ProfileSession` to the original session by setting `linkedPreSessionId` to the original session's `id`.
3. WHEN the re-profile run completes, THE Dashboard SHALL display the improvement visualization section comparing the original session metrics to the new session metrics.
4. IF a `Baseline` session exists for the file, THE Dashboard SHALL also display baseline deltas for the new session alongside the improvement visualization.
5. IF the re-profile run fails (non-zero exit code), THEN THE Extension SHALL display a warning: "Re-profile completed with errors. Check the dashboard for details." and SHALL still save and display the partial session.

---

### Requirement 8: Reject Individual Suggestions

**User Story:** As a developer, I want to reject suggestions I don't want, so that they are dismissed without affecting my code.

#### Acceptance Criteria

1. WHEN a suggestion is rejected (from either the AI_Panel or the Dashboard), THE Extension SHALL remove the suggestion from the active suggestion list displayed in the Dashboard.
2. WHEN a suggestion is rejected, THE Extension SHALL NOT modify the source file.
3. THE Extension SHALL persist rejected suggestion IDs for the current session so that rejected suggestions do not reappear if the dashboard is refreshed within the same session.
