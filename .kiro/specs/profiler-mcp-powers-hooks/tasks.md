# Implementation Plan: Profiler MCP Server, Powers Packaging, and Agent Hooks

## Overview

Implement the MCP server (`src/mcp/server.ts`), wire it into `extension.ts`, create the Power manifest, and add the three agent hook YAML files. Tests cover each tool handler in isolation, correctness properties via fast-check, and an end-to-end integration flow.

## Tasks

- [x] 1. Create `McpServer` class skeleton and JSON-RPC read loop
  - Create `kiro-code-profiler/src/mcp/server.ts` with the `McpServer` class
  - Implement constructor accepting `persister`, `runner`, `optimizer`, `llmOptimizer`, `workspacePath`
  - Implement `start()` / `stop()` methods
  - Implement `readLoop()`: buffer stdin line-by-line, parse JSON, dispatch, write response to stdout; on parse error write `-32700` and continue; exit cleanly when stdin closes
  - Implement `dispatch()`: handle `initialize`, `tools/list`, and `tools/call`; return `-32601` for unknown methods
  - Never write non-JSON-RPC output to stdout (use `process.stderr` for logs)
  - _Requirements: McpServer interface, readLoop spec, dispatch algorithm from design_

- [x] 2. Implement `list_sessions` tool handler
  - [x] 2.1 Implement `listSessionsTool(args, persister, workspacePath)`
    - Call `persister.list(args.workspacePath ?? workspacePath)` and return the `SessionSummary[]` as JSON text content
    - Return `isError: true` content block on any thrown error
    - _Requirements: MCP Tools table — list_sessions_

  - [ ]* 2.2 Write unit tests for `list_sessions`
    - Test happy path: mock persister returns summaries, verify response content is valid JSON array
    - Test empty workspace: persister returns `[]`, verify response is `[]`
    - Test error path: persister throws, verify `isError: true` in response
    - _Requirements: Unit Testing Approach from design_

- [x] 3. Implement `get_session` tool handler
  - [x] 3.1 Implement `getSessionTool(args, persister)`
    - Call `persister.load(args.sessionId)` and return the `ProfileSession` as JSON text content
    - Return `isError: true` content block when `sessionId` is missing or `load` throws
    - _Requirements: MCP Tools table — get_session_

  - [ ]* 3.2 Write unit tests for `get_session`
    - Test happy path: mock persister returns a session, verify JSON content matches
    - Test missing `sessionId`: verify `isError: true`
    - Test session not found: persister throws, verify `isError: true`
    - _Requirements: Unit Testing Approach from design_

- [x] 4. Implement `run_profile` tool handler
  - [x] 4.1 Implement `runProfileTool(args, runner, persister, optimizer, workspacePath)`
    - Validate `args.filePath` is within `workspacePath`; return `isError: true` if not
    - Build a `RunRequest` and call `runner.run(request)`
    - Aggregate samples via `aggregateSamples`, estimate energy via `EnergyEstimator`
    - Construct a `ProfileSession` with a uuid v4 `id`, call `persister.save(session)`
    - Call `optimizer.suggest(session)` and attach suggestions to the session
    - Return the full `ProfileSession` as JSON text content
    - If execution fails (non-zero exit), still save and return the session with `isError: true`
    - _Requirements: runProfileTool spec, Postconditions from design_

  - [ ]* 4.2 Write unit tests for `run_profile`
    - Test happy path: mock runner + persister + optimizer, verify session is saved and returned
    - Test non-zero exit code: verify session is still saved and `isError: true` in response
    - Test invalid language: verify `isError: true` without calling runner
    - Test path outside workspace: verify `isError: true` without calling runner
    - _Requirements: Unit Testing Approach, Error Handling — run_profile from design_

  - [ ]* 4.3 Write property test for `run_profile` round-trip (Property 2)
    - **Property 2: run_profile → get_session round-trip consistency**
    - For any valid `run_profile` call, the returned `sessionId` is loadable via `get_session` and returns the same session
    - Use `fc.record({ filePath: fc.string(), language: fc.constantFrom('javascript','typescript','python') })` with mocked runner/persister
    - `numRuns: 100`
    - **Validates: runProfileTool Postconditions**
    - _Requirements: Property-Based Testing Approach, Correctness Properties from design_

- [x] 5. Implement `get_suggestions` tool handler
  - [x] 5.1 Implement `getSuggestionsTool(args, persister, llmOptimizer)`
    - Call `persister.load(args.sessionId)` to retrieve the session
    - If `args.useLlm === true`, read source from disk and call `llmOptimizer.suggest(session, sourceCode)`; otherwise return `session.optimizationSuggestions`
    - Return the `OptimizationSuggestion[]` as JSON text content
    - Return `isError: true` on any thrown error
    - _Requirements: MCP Tools table — get_suggestions, get_suggestions sequence diagram from design_

  - [ ]* 5.2 Write unit tests for `get_suggestions`
    - Test rule-based path (`useLlm` falsy): verify returns `session.optimizationSuggestions`
    - Test LLM path (`useLlm: true`): mock `llmOptimizer.suggest`, verify its result is returned
    - Test missing `sessionId`: verify `isError: true`
    - _Requirements: Unit Testing Approach from design_

- [x] 6. Implement JSON-RPC protocol compliance and `id` echoing
  - [x] 6.1 Ensure every response echoes the request `id` exactly
    - All four tool handlers and `initialize` / `tools/list` must copy `request.id` into the response
    - Unknown method responses must also echo `request.id`
    - _Requirements: McpRequest/McpResponse validation rules, handleToolCall Postconditions from design_

  - [ ]* 6.2 Write property test for `id` echoing (Property 1)
    - **Property 1: Response id always equals request id**
    - For any `McpRequest` with `id` drawn from `fc.oneof(fc.integer(), fc.string())` and a valid method, the response `id` equals the request `id`
    - `numRuns: 100`
    - **Validates: Correctness Properties — id echoing**
    - _Requirements: Correctness Properties from design_

  - [ ]* 6.3 Write property test for parse error resilience (Property 4)
    - **Property 4: Malformed JSON never crashes the server**
    - For any arbitrary byte string on stdin, the read loop writes a `-32700` error response and continues (does not throw or exit)
    - Use `fc.string()` to generate arbitrary inputs; feed through the dispatch path
    - `numRuns: 100`
    - **Validates: Correctness Properties — malformed JSON**
    - _Requirements: Error Handling — MCP Parse Error, readLoop spec from design_

  - [ ]* 6.4 Write property test for unknown tool names (Property 5)
    - **Property 5: Unknown tool names return -32601 without mutating state**
    - For any `tools/call` request with a tool name not in the registered set, the response error code is `-32601` and `persister.save` is never called
    - Use `fc.string().filter(s => !['list_sessions','get_session','run_profile','get_suggestions'].includes(s))`
    - `numRuns: 100`
    - **Validates: Correctness Properties — unknown tool names**
    - _Requirements: Correctness Properties, dispatch algorithm from design_

- [x] 7. Checkpoint — Ensure all MCP server unit and property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Wire `McpServer` into `extension.ts` `activate()`
  - Import `McpServer` from `./mcp/server`
  - Instantiate `McpServer` with the existing `persister`, `runner` (new `ExecutionRunner()`), `optimizer`, `llmOptimizer`, and `workspacePath`
  - Call `mcpServer.start()` after instantiation
  - Push `{ dispose: () => mcpServer.stop() }` to `context.subscriptions`
  - _Requirements: Example Usage section from design_

  - [ ]* 8.1 Write unit test for `activate()` wiring
    - Verify `McpServer.start()` is called during activation
    - Verify `mcpServer.stop()` is called when the subscription is disposed
    - _Requirements: Unit Testing Approach from design_

- [x] 9. Create Power manifest
  - Create `.kiro/powers/profiler/power.json` with the concrete manifest from the design:
    - `name: "kiro-code-profiler"`, `version: "0.0.1"`
    - `mcp.command: "node"`, `mcp.args: ["./out/mcp/server.js"]`, `mcp.env: {}`
    - `steering` array pointing to the three existing steering docs via relative paths
  - _Requirements: Power Manifest interface and concrete example from design_

- [x] 10. Create agent hook YAML files
  - [x] 10.1 Create `.kiro/hooks/re-profile-on-edit.kiro.yaml`
    - `trigger: fileEdited`, `filePattern: "**/*.{py,ts,js}"`
    - Step: `vscode-command: kiro-profiler.profile` with `args.filePath: "{{event.filePath}}"`
    - _Requirements: Hook Definitions — re-profile-on-edit from design_

  - [x] 10.2 Create `.kiro/hooks/post-task-test.kiro.yaml`
    - `trigger: postTaskExecution`
    - Step: `shell: "cd kiro-code-profiler && npm test"`
    - _Requirements: Hook Definitions — post-task-test from design_

  - [x] 10.3 Create `.kiro/hooks/profile-this-file.kiro.yaml`
    - `trigger: userTriggered`
    - Step: `vscode-command: kiro-profiler.profile` with `args.filePath: "{{activeFile}}"`
    - _Requirements: Hook Definitions — profile-this-file from design_

- [x] 11. Write integration tests for the full `run_profile → get_session → get_suggestions` workflow
  - Create `kiro-code-profiler/src/tests/mcpIntegration.test.ts`
  - Instantiate a real `McpServer` with real `SessionPersister` (temp dir), real `ExecutionRunner`, real `Optimizer`, and a mocked `LlmOptimizer`
  - Send `run_profile` for `demo/demo.py` via the server's dispatch method; assert response contains a valid `ProfileSession`
  - Send `get_session` with the returned `sessionId`; assert the session matches
  - Send `get_suggestions` with `useLlm: false`; assert the suggestions array is returned
  - Verify `list_sessions` includes the new session's `id`
  - _Requirements: Integration Testing Approach, Correctness Properties 2 and 3 from design_

- [x] 12. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Property tests use fast-check with `numRuns: 100` per the architecture conventions
- PBT files follow the tag comment format: `// Feature: profiler-mcp-powers-hooks, Property N: <text>`
- The MCP server must never write non-JSON-RPC content to stdout — use `process.stderr` for all debug logging
- `run_profile` path validation must check that `filePath` is within `workspacePath` before spawning any process
