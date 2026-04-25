# Bugfix Requirements Document

## Introduction

When optimization suggestions are displayed in the Kiro Code Profiler dashboard, clicking the "Accept" or "Accept All" button triggers a "No active editor" error. This happens because the dashboard is a webview panel — when it is focused, `vscode.window.activeTextEditor` returns `undefined`. Any code path in the accept/accept-all commands that falls back to requiring an active editor will fail in this context. The fix must ensure suggestions can be accepted regardless of whether a text editor is currently active.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user clicks "Accept" on a suggestion in the dashboard AND no text editor is active (e.g. the dashboard webview is the focused panel) THEN the system shows a "No active editor" error and does not apply the optimization.

1.2 WHEN the user clicks "Accept All" in the dashboard AND no text editor is active THEN the system shows a "No active editor" error and does not apply any optimizations.

### Expected Behavior (Correct)

2.1 WHEN the user clicks "Accept" on a suggestion in the dashboard AND no text editor is active THEN the system SHALL resolve the target file from the stored suggestion-to-file mapping and apply the optimization without requiring an active editor.

2.2 WHEN the user clicks "Accept All" in the dashboard AND no text editor is active THEN the system SHALL resolve the target file from the stored suggestion-to-file mapping and apply all optimizations without requiring an active editor.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user clicks "Accept" on a suggestion AND a text editor is active THEN the system SHALL CONTINUE TO apply the optimization and re-profile the file.

3.2 WHEN the user clicks "Accept All" AND a text editor is active THEN the system SHALL CONTINUE TO apply all optimizations sequentially and re-profile the file.

3.3 WHEN the user clicks "Reject" on a suggestion THEN the system SHALL CONTINUE TO remove the suggestion from the active list and update the dashboard.

3.4 WHEN a suggestion's diff cannot be applied to the current file content THEN the system SHALL CONTINUE TO show an appropriate error message and leave the file unchanged.
