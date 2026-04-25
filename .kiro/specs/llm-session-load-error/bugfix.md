# Bugfix Requirements Document

## Introduction

When the user right-clicks a supported file in the editor and selects "Kiro Profiler: Optimize with LLM" from the context menu, the error "Could not load the requested session." is shown instead of running the LLM optimization. The root cause is that VS Code passes the active file's `Uri` object as the first argument to the command handler. The handler treats any truthy first argument as a `sessionId` string, so it calls `persister.load(uri)` with a `Uri` object instead of a session ID string. That load fails, the fallback also fails (or no sessions exist), and the error message is displayed. The fix must detect when the argument is a `Uri` (context menu invocation) and treat it as a no-`sessionId` call, falling back to the active editor path.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user right-clicks a file in the editor and invokes "Optimize with LLM" THEN the system passes the file `Uri` as `sessionIdArg`, enters the `if (sessionIdArg)` branch, and calls `persister.load(uri)` with a non-string argument, causing the load to fail
1.2 WHEN `persister.load(uri)` fails due to the invalid argument THEN the system falls back to the most recent session and attempts `persister.load(summary.id)`, which may also fail or be absent, resulting in the error message "Could not load the requested session." being shown to the user
1.3 WHEN the error message is shown THEN the system returns early and no LLM optimization is performed

### Expected Behavior (Correct)

2.1 WHEN the user right-clicks a file in the editor and invokes "Optimize with LLM" THEN the system SHALL detect that `sessionIdArg` is a `vscode.Uri` (not a string session ID) and treat the invocation as a context-menu call with no explicit session ID
2.2 WHEN the invocation is treated as a context-menu call THEN the system SHALL use the active editor's file path to look up the most recent session for that file, matching the existing no-`sessionIdArg` code path
2.3 WHEN a valid session exists for the active file THEN the system SHALL load that session and proceed with LLM optimization without showing any error

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the command is invoked from the dashboard with a valid string `sessionId` THEN the system SHALL CONTINUE TO load the session by that ID and run LLM optimization
3.2 WHEN the command is invoked from the dashboard with an invalid or missing `sessionId` THEN the system SHALL CONTINUE TO fall back to the most recent session and show "Could not load the requested session." if no session is found
3.3 WHEN the command is invoked from the editor context menu and no prior session exists for the active file THEN the system SHALL CONTINUE TO show "Profile this file first before requesting optimization."
3.4 WHEN the command is invoked from the editor context menu and no active editor is open THEN the system SHALL CONTINUE TO show "No active editor."
