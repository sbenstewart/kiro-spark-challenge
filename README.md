# EcoSpec — Carbon-Aware Code Profiler

**Kiro Spark Challenge · ASU · April 24, 2026 · Environment Track**

EcoSpec turns a macro problem — software energy waste — into a micro action a developer can take inside Kiro: profile a file, see its carbon grade, and get AI-powered optimization suggestions that reduce both runtime and emissions before the code ships.

---

## The problem

Data centers consumed ~240 TWh globally in 2022 (IEA). Developers write the code that runs on those servers, but have zero visibility into the carbon cost of their choices at write time. A nested loop that runs once locally can emit dozens of kilograms of CO₂ per year when deployed at scale. No IDE extension exposes this.

**EcoSpec fixes that.** Every profile session shows a carbon grade, an annual CO₂ projection at production scale, and equivalencies in terms developers and stakeholders can communicate — car kilometres driven, phone charges consumed, LED hours burned.

---

## Challenge frame

**Environment: The Accountability Guardrail**

> Your app must bridge the gap between a macro-problem (climate change) and a micro-action. The spec must rely on verifiable data points, not just 'vibes.'

EcoSpec bridges:
- **Macro**: software workloads are a measurable, growing source of CO₂ emissions
- **Micro**: a developer saves a file → EcoSpec profiles it → the dashboard shows a carbon grade in seconds

Every number in the dashboard cites its source: **EPA eGRID 2022**, **EEA 2022**, **IEA 2023**, **USDA Forest Service**, **EPA GHG Equivalencies Calculator**. No vibes.

---

## Demo

```
1. Open slow_demo.py in Kiro
2. Run: EcoSpec: Profile & Analyze Carbon Cost
3. Dashboard shows: Grade F — 0.84 g CO₂e/run — 30.7 kg/year at 100 runs/day
                    ≈ 122 km driven · 3,737 phone charges
4. Click "Optimize with LLM (Hot-Path)"
   → EcoSpec extracts the 5 most complex functions (87% token reduction)
   → LLM suggests: replace recursive Fibonacci with memoization, bubble sort with list.sort()
5. Accept suggestions → re-profile
6. Dashboard shows: Grade B — 0.006 g CO₂e/run — 0.22 kg/year
                    ✓ Saves 30.5 kg CO₂e/year ≈ 121 km of driving
```

---

## Carbon grading (verifiable thresholds)

| Grade | Per-run CO₂e | Meaning |
|---|---|---|
| **A** | < 0.001 g | Negligible — ships |
| **B** | 0.001–0.01 g | Good — acceptable for most use cases |
| **C** | 0.01–0.1 g | Review before scaling |
| **D** | 0.1–1 g | Optimize before deployment |
| **F** | ≥ 1 g | Block — high environmental debt |

Carbon intensity is drawn from regional grid data. Users select their deployment region:

| Region | g CO₂/kWh | Source |
|---|---|---|
| AWS us-east-1 (N. Virginia) | 386 | EPA eGRID 2022 |
| AWS us-west-2 (Oregon) | 136 | EPA eGRID 2022 |
| AWS eu-west-1 (Ireland) | 279 | EEA 2022 |
| AWS ap-southeast-1 (Singapore) | 493 | IEA 2022 |
| US Average | 386 | EPA eGRID 2022 |
| EU Average | 255 | EEA 2022 |

---

## How hot-path LLM optimization works

Standard LLM optimization sends the full source file — up to 32,000 characters. EcoSpec doesn't.

`hotPathExtractor.ts` parses the source into function-level AST nodes using regex-based boundary detection, scores each function by a cyclomatic complexity proxy (loops × 3 + branches + nesting depth × 2), and sends only the top-5 most complex functions to the LLM.

**Result**: 70–95% token reduction on typical files. The LLM call itself consumes less energy — the tool practices what it preaches.

The LLM prompt also includes explicit carbon context:
```
Carbon Impact:
- CO₂e per run: 0.84 g (EPA eGRID 2022, US average)
- Projected annual at 100 runs/day: 30.7 kg (≈ 122 km driven)
- Token reduction: 87% (8,000 → 1,040 tokens, 5 of 6 functions selected)
```

---

## Kiro-native workflow

This repo was built spec-first using Kiro's spec system. Judges can inspect the artifacts directly:

```
.kiro/specs/
  kiro-code-profiler/          # Core profiler: 15 tasks, 8 requirements, 14 correctness properties
    requirements.md
    design.md
    tasks.md
  llm-code-optimization/       # LLM integration: 8 requirements, diff lifecycle
    requirements.md
    design.md
    tasks.md
  llm-session-load-error/      # Bugfix spec: Kiro-driven root cause analysis
    bugfix.md
    design.md
    tasks.md
  carbon-accountability/       # Carbon features: 6 user stories, verifiable data sources
    requirements.md
    design.md
    tasks.md
```

**Kiro workflow by role:**
- **Builder**: Used Kiro specs to drive implementation — requirements → design → tasks → code. Used Kiro's autopilot to generate the 18 property-based test suite with `fast-check`.
- **Designer**: Used Kiro to spec the dashboard UX — what metrics appear above the fold, how the carbon grade communicates urgency without overwhelming. The carbon card layout came from a Kiro design spec iteration.
- **Strategist**: Used Kiro to research EPA eGRID data sources and write `carbon-accountability/requirements.md`. The production-scale input came from a Kiro-assisted user story session.

---

## Architecture

```
Developer profiles a file
        │
        ▼
ExecutionRunner (child_process)
        │
        ▼
MetricsCollector (pidusage + systeminformation)
        │
        ▼
EnergyEstimator (CPU × TDP → mWh)
        │
        ▼
SessionPersister (.kiro/profiler/sessions/)
        │
        ├──→ Optimizer (rule-based suggestions)
        │
        └──→ LlmOptimizer
               ├── hotPathExtractor (complexity scoring → top-5 functions)
               ├── buildPrompt (carbon context + hot-path source)
               └── OpenAI gpt-4o-mini
                         │
                         ▼
                   DashboardPanel (webview)
                         ├── Carbon grade (A–F)
                         ├── Region selector (EPA eGRID 2022)
                         ├── Production scale input
                         ├── Equivalency chips (car, phone, LED)
                         └── Carbon savings vs baseline
```

---

## Installation

```bash
cd kiro-code-profiler
npm install
npm run build
# Install the extension in Kiro/VS Code:
# Extensions → Install from VSIX → select kiro-code-profiler-0.1.0.vsix
```

**Requirements**: Node.js ≥ 18, Python 3 (for Python profiling), OpenAI API key (for LLM optimization).

Add your API key: `Extensions → EcoSpec → OpenAI API Key`, or set `OPENAI_API_KEY` in your environment.

---

## Running the demo

```bash
# The intentionally-inefficient demo file is in demo/
python3 demo/slow_demo.py

# Or open it in Kiro and run:
# EcoSpec: Profile & Analyze Carbon Cost
```

`slow_demo.py` contains 6 anti-patterns: recursive Fibonacci, bubble sort on 8,000 elements, naive prime finding, string concatenation loops, linear search on lists, and a distance matrix with unnecessary nested loops. Each generates measurable CPU and RAM metrics. The profiler consistently grades it F.

---

## Testing

```bash
cd kiro-code-profiler
npm test
```

18 test files covering: energy estimation, metrics aggregation, diff application, baseline comparisons, configuration validation, session persistence, suggestion ranking, alert emission, error handling, and property-based invariants via `fast-check`.

---

## Responsible design

- **Data privacy**: source code is never sent anywhere unless you explicitly click "Optimize with LLM." LLM calls require opt-in API key.
- **Accuracy**: carbon estimates show a ±20% uncertainty note (real TDP varies; EcoSpec fetches actual TDP via `systeminformation` where available, falls back to 15W laptop average).
- **Source attribution**: every carbon number in the UI cites its data source and year.
- **No overclaiming**: grades are thresholds, not rankings. A Grade A doesn't mean "zero impact" — it means "negligible at this scale."

---

## Next steps

1. **CI/CD GitHub Action** — fail PRs that regress carbon grade
2. **Multi-language AST parser** — replace regex-based extractor with tree-sitter for higher accuracy
3. **Real-time grid carbon API** — integrate Electricity Maps API for live intensity vs. static 2022 data
4. **Team carbon dashboard** — aggregate carbon debt across a codebase, not just individual files
5. **Water usage projection** — data centers use ~1.8 L water/kWh cooling; surface alongside CO₂

---

## Prize signals

| Signal | Evidence |
|---|---|
| **Build** | 18 tests, property-based testing, hot-path extractor, full TypeScript architecture |
| **Collaboration** | 4 Kiro spec modules, role-split documentation, bugfix spec showing process |
| **Impact** | Verifiable EPA data, production-scale projection, real-world carbon grade |
| **Story** | Complete spec-driven workflow, reproducible demo, architecture diagram |
