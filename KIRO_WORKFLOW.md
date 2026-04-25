# How We Used Kiro — Submission Write-Up

## Overview

EcoSpec was built spec-first, entirely inside Kiro. We did not write a line of implementation code before Kiro had a spec for it. This document walks through how each Kiro feature shaped the final product.

---

## 1. Spec-driven development from day one

Every component started as a `.kiro/specs/` module before any implementation. The process for each feature was identical:

1. Open Kiro, create a new spec
2. Write `requirements.md` — user stories with acceptance criteria
3. Write `design.md` — architecture diagram, interfaces, correctness properties
4. Write `tasks.md` — ordered implementation checklist
5. Hand the spec to Kiro's autopilot to generate the implementation scaffold

We have four spec modules:

### `kiro-code-profiler/` — Core profiler
- **136 requirements** across 8 user stories covering execution, metrics, energy estimation, session persistence, and real-time monitoring
- **14 correctness properties** that Kiro's autopilot used to generate property-based tests with `fast-check` (e.g., "energy estimate is always positive for a running process", "baseline delta is always zero when comparing a session to itself")
- **15 implementation tasks**, all checked off — the task list became our burndown chart

### `llm-code-optimization/` — AI optimization pipeline
- 8 requirements covering the full suggestion lifecycle: trigger → LLM call → diff validation → accept/reject → re-profile
- Kiro's steering helped us decide to use unified diff format for suggestions rather than full-file rewrites, because the spec's "apply individual suggestions" requirement made targeted diffs necessary

### `llm-session-load-error/` — Bugfix spec
- When session loading broke under an edge case, we created a **bugfix spec** rather than jumping straight to a fix
- `bugfix.md` captured the reproduction steps and root cause; `design.md` described the fix; `tasks.md` had two steps
- This was one of Kiro's most valuable contributions: forcing us to understand the bug before fixing it

### `carbon-accountability/` — Carbon features
- 6 user stories for the carbon grade, region selector, production scale, equivalencies, hot-path LLM, and baseline comparison
- The design spec's data-sources table (EPA eGRID 2022, EEA 2022, IEA 2023) became the literal content of the dashboard footer — spec and code stayed in sync

---

## 2. How each role used Kiro

### Builder
Used Kiro specs to drive implementation top-to-bottom. The `tasks.md` checklist in each spec was the work queue. Kiro's autopilot generated the initial scaffold for `metricsCollector.ts`, `diffApplier.ts`, and the 18-file test suite. The builder's job was to review, correct, and extend what Kiro produced — not to write from scratch.

Key decision made with Kiro: the `hotPathExtractor.ts` architecture. The spec asked for "minimum tokens to the LLM." Kiro's steering suggested AST-based function extraction. The builder chose regex-based boundary detection (not a full parser) because it requires zero external dependencies — a tradeoff documented in `carbon-accountability/design.md`.

### Designer
Used Kiro to spec the dashboard UX before any HTML was written. The spec asked: what goes above the fold? The designer's Kiro session produced the answer: the carbon grade badge is the hero element — 36px circle, letter grade, color-coded — because it communicates pass/fail in under a second. The metrics grid (per-run, annual, trees) supports the grade; the equivalency chips make it human.

Kiro also helped the designer identify the "delight" problem: plain numbers (0.84 g CO₂e) don't land. Translating to "122 km of driving" does. That insight came from a Kiro-assisted brainstorm of the user story "As a non-specialist stakeholder..."

### Strategist
Used Kiro to research the problem space and frame the Environment pitch. The strategist used Kiro's chat to pull EPA eGRID regional intensity values, verify the tree-absorption figure against USDA sources, and structure the requirements so the Accountability Guardrail was provably satisfied. The `carbon-accountability/requirements.md` acceptance criteria are directly derived from that research session.

The production-scale input feature came from a Kiro-assisted edge case: "what if the code runs a billion times a day?" The spec explicitly calls for no upper cap on the runs/day input, which is why the dashboard shows scientific notation for very large scales.

---

## 3. Specific Kiro features used

| Feature | Where used |
|---|---|
| **Spec system** (requirements, design, tasks) | All 4 spec modules |
| **Autopilot** | Generated test scaffolds, initial component skeletons |
| **Steering** | Architecture decisions (diff format, function extraction approach, grade thresholds) |
| **Bugfix spec** | `llm-session-load-error/` — structured debugging |
| **Chat** | EPA data research, user story edge cases, UI copy |

---

## 4. What Kiro changed about the final product

Three decisions were directly shaped by Kiro that would not have happened otherwise:

1. **Property-based tests**: The `design.md` correctness properties section prompted Kiro's autopilot to suggest `fast-check`. We had not planned to use property-based testing. The 18-file test suite with formal invariants is a direct result.

2. **Hot-path extraction**: The carbon-accountability spec required "minimum tokens to the LLM." Kiro's steering surfaced the architectural option of extracting only the complex functions. Without the spec forcing the question, we would have left the naive full-file approach in place.

3. **Source attribution in UI**: The design spec's data-sources table (with agency and year for every value) prompted us to add the citation footer to the carbon card. "Not just vibes" is now verifiable in the UI itself.

---

## 5. Scalability of this workflow

The spec-driven approach is inherently scalable because the specs are the handoff artifact between roles. A new team member can onboard by reading `.kiro/specs/` rather than reading code. The bugfix spec pattern means debugging decisions are documented, not just the fixes. And because specs drive autopilot, adding a new feature starts with a spec — not a blank file.

For teams using CI/CD, the `tasks.md` checklist maps directly to a PR checklist. Every acceptance criterion in `requirements.md` is a testable assertion. The workflow EcoSpec used today is the same workflow a 10-person team would use to extend it to 10 languages and a real-time carbon API.
