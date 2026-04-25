---
inclusion: always
---

# Bugfix Workflow Conventions

## File Location and Naming

Bugfix specs live at `.kiro/specs/{kebab-case-bug-name}/bugfix.md`.

The directory name is the kebab-case bug identifier (e.g. `suggestion-accept-no-active-editor`). Each bug gets its own directory under `.kiro/specs/`.

---

## Three Mandatory Sections

Every `bugfix.md` contains exactly three sections:

### 1. Bug Analysis

Documents the **current defective behavior**. Criteria use the EARS pattern:

```
WHEN <trigger> AND <condition> THEN the system shows/does <wrong thing>
```

- Use lowercase "the" — this is describing the bug, not a requirement.
- No `SHALL` — defective behavior is observed, not specified.
- Use `AND` to precisely identify the defect trigger and the condition that activates it.

### 2. Expected Behavior

Documents the **correct behavior** after the fix. Criteria use the EARS pattern:

```
WHEN <trigger> AND <condition> THEN THE system SHALL <correct outcome>
```

- Use uppercase `THE` and `SHALL` — this is a requirement.

### 3. Regression Prevention

Documents **behaviors that must not regress**. Criteria use the EARS pattern:

```
WHEN <trigger> THEN THE system SHALL CONTINUE TO <existing behavior>
```

- Must enumerate every related behavior that must not regress.
- Must cover both the **happy path** (normal operation) and known error paths of the affected commands or components.

---

## Bug Condition Pattern

Use `WHEN <trigger> AND <condition> THEN <wrong outcome>` to precisely identify the defect:

- `WHEN` — the user action or system event that initiates the flow
- `AND` — the environmental condition that causes the bug to manifest (e.g. no active editor, missing file, empty map)
- `THEN` — the wrong outcome the user observes

---

## Criterion Numbering

Criteria are numbered within their section using `<section>.<criterion>` format:

- Section 1 (Bug Analysis): `1.1`, `1.2`, …
- Section 2 (Expected Behavior): `2.1`, `2.2`, …
- Section 3 (Regression Prevention): `3.1`, `3.2`, `3.3`, …

---

## Regression Prevention Scope

The Regression Prevention section must be comprehensive:

- Cover the **happy path** — normal operation of the affected command when preconditions are met.
- Cover known **error paths** — what happens when diffs fail to apply, files are missing, etc.
- Include all related commands or flows that share the affected code path.

---

## Annotated Example

From `.kiro/specs/suggestion-accept-no-active-editor/bugfix.md`:

```markdown
## Bug Analysis

1.1 WHEN the user clicks "Accept" on a suggestion in the dashboard
    AND no text editor is active (e.g. the dashboard webview is the focused panel)
    THEN the system shows a "No active editor" error and does not apply the optimization.
    ^^^ WHEN/AND/THEN pattern — trigger + condition + wrong outcome

1.2 WHEN the user clicks "Accept All" in the dashboard
    AND no text editor is active
    THEN the system shows a "No active editor" error and does not apply any optimizations.

## Expected Behavior

2.1 WHEN the user clicks "Accept" on a suggestion in the dashboard
    AND no text editor is active
    THEN THE system SHALL resolve the target file from the stored suggestion-to-file mapping
         and apply the optimization without requiring an active editor.
    ^^^ uppercase THE + SHALL — this is the requirement

2.2 WHEN the user clicks "Accept All" in the dashboard
    AND no text editor is active
    THEN THE system SHALL resolve the target file from the stored suggestion-to-file mapping
         and apply all optimizations without requiring an active editor.

## Regression Prevention

3.1 WHEN the user clicks "Accept" on a suggestion AND a text editor is active
    THEN THE system SHALL CONTINUE TO apply the optimization and re-profile the file.
    ^^^ happy path — normal operation must not regress

3.2 WHEN the user clicks "Accept All" AND a text editor is active
    THEN THE system SHALL CONTINUE TO apply all optimizations sequentially and re-profile the file.

3.3 WHEN the user clicks "Reject" on a suggestion
    THEN THE system SHALL CONTINUE TO remove the suggestion from the active list and update the dashboard.

3.4 WHEN a suggestion's diff cannot be applied to the current file content
    THEN THE system SHALL CONTINUE TO show an appropriate error message and leave the file unchanged.
    ^^^ error path — failure handling must not regress
```

Key observations from this example:
- Bug Analysis uses `AND` to isolate the exact condition (`no text editor is active`) that triggers the defect.
- Expected Behavior mirrors the Bug Analysis criteria but replaces the wrong outcome with `SHALL <correct behavior>`.
- Regression Prevention covers the **happy path** (3.1, 3.2 — editor is active), a related command (3.3 — reject), and an **error path** (3.4 — diff failure).
