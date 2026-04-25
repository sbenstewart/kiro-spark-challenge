# Kiro Spark Challenge Scorecard

This scorecard evaluates the current `kiro-spark-challenge` project against the April 24, 2026 challenge materials in:

- `DRAFT Kickoff_Kiro Spark Challenge.pdf`
- `Kiro Spark Challenge_ How to compete.pdf`

## Current assessment

### Frame fit: Environment / Accountability Guardrail

**Score: 8.5 / 10**

Why it scores well:

- The project clearly bridges a macro problem and a micro action
- The environmental claim is grounded in explicit energy and water projection logic
- The Kiro workflow is visible through specs, MCP registration, and hooks

What holds it back:

- The demo path is not yet simplified to one obvious user journey
- The repo currently presents multiple partially overlapping sub-projects

## Rubric score

### 1. Potential Value

**Score: 7.5 / 10**

Strengths:

- Clear real-world need: developers rarely see the environmental impact of code
- Credible expansion path for education, enterprise engineering, and FinOps-style review workflows
- Strong environment-track narrative

Gaps:

- The target user and customer journey need to be stated more directly
- Accessibility and UI polish are not yet strong enough in the visible repo assets

### 2. Implementation

**Score: 7.0 / 10**

Strengths:

- Real Python implementation with predictor, feedback loop, retrainer, scale projector, and MCP server
- `.kiro/specs`, `.kiro/hooks`, and `.kiro/settings/mcp.json` provide evidence of Kiro usage
- Python tests mostly pass

Gaps:

- The extension project under `kiro-code-profiler/` is missing packaging files needed for judge installation
- Some documentation overstates integration that is not visible in the checked-in extension source
- A failing test existed before cleanup, which reduces confidence unless fully green at submission time

### 3. Quality & Design

**Score: 6.5 / 10**

Strengths:

- Original angle with strong environmental accountability framing
- Good architectural thinking and reusable backend components

Gaps:

- Minimal product polish in the project-facing docs until now
- The visible user experience is less compelling than the backend story
- The project still needs a tighter, more delightful end-to-end demo

## Total

**21.0 / 30**

That is credible hackathon material, but not yet a likely grand-prize winner in its current state.

## Signal readiness

### Build signal

**7.5 / 10**

The backend and Kiro integration are real. The score drops because the install/demo surface is not yet clean enough.

### Collaboration signal

**5.0 / 10**

The repo does not yet clearly show who owned research, specs, ML, IDE workflow, UX, and storytelling. Judges asked for this explicitly.

### Impact signal

**8.5 / 10**

This is the strongest area. The project addresses a real problem with a plausible user action and explicit responsible-design framing.

### Story signal

**5.5 / 10**

The story is promising, but the submission package still needs a concise write-up, a polished 2-3 minute demo, and evidence of public sharing.

## What would move this into winning range

Priority 1:

- Make the submission center on one product: EcoSpec inside Kiro
- Ensure all tests are green and the demo path works with no setup surprises
- Remove or down-rank any claim not backed by the checked-in code

Priority 2:

- Add a strong customer journey: who uses this, when, and what decision changes
- Explicitly document team roles and how each person used Kiro
- Produce a short, polished demo showing before/after optimization and annual impact delta

Priority 3:

- Package the extension properly if it is part of the judged product
- Add screenshots or a short architecture diagram to support the story
- Publish at least one strong public post for the story signal

## Recommended target score after cleanup

If the repo is tightened, the demo is polished, and collaboration/story artifacts are added, this project can realistically move to:

**26 to 28 / 30**

That would put it in strong contention for:

- Environment frame
- Impact signal
- Build signal

## One-sentence pitch

EcoSpec turns code efficiency into a visible climate accountability workflow inside Kiro, helping developers see the energy and water cost of a Python file before it ships to production.
