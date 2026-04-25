# Carbon Accountability — Requirements

## Problem statement

Developers have no visibility into the environmental cost of their code at write time. A nested loop that runs once locally but deploys to 1 million API calls/day silently accumulates a measurable carbon debt. No IDE extension exposes this at the function level.

## User stories

### US-1 Carbon grade
As a developer, I want to see a letter grade (A–F) for my code's carbon footprint immediately after profiling, so I can understand its environmental impact at a glance without reading raw numbers.

**Acceptance criteria:**
- Grade A: < 0.001 g CO₂e per run
- Grade B: 0.001–0.01 g CO₂e per run
- Grade C: 0.01–0.1 g CO₂e per run
- Grade D: 0.1–1 g CO₂e per run
- Grade F: ≥ 1 g CO₂e per run
- Grade badge is colour-coded (green → red)
- Grade updates in real time when region or scale changes

### US-2 Verifiable regional carbon intensity
As a developer deploying to a specific cloud region, I want to select my deployment region so that carbon estimates use verified grid data rather than global averages.

**Acceptance criteria:**
- Dropdown includes AWS us-east-1, us-west-2, eu-west-1, ap-southeast-1
- Includes US average (EPA eGRID 2022) and EU average (EEA 2022)
- All intensity values cite their source (EPA eGRID 2022 / EEA 2022 / IEA 2023)
- Source attribution displayed in dashboard footer
- Changing region immediately re-renders all carbon metrics

### US-3 Production scale projection
As a developer, I want to input how many times my code runs per day in production, so I can see the annualised carbon footprint at real-world scale rather than just a single-run estimate.

**Acceptance criteria:**
- Numeric input for runs/day (default: 100, min: 1, no upper cap)
- Annual CO₂e recalculates on input change
- Annual label shows the configured runs/day count
- Changing scale updates grade, equivalencies, and chart simultaneously

### US-4 Carbon equivalency translations
As a non-specialist stakeholder, I want carbon numbers translated into everyday equivalencies (car km, phone charges, LED hours), so I can communicate the environmental impact to non-technical audiences.

**Acceptance criteria:**
- Car km: EPA 404 g CO₂/mile conversion
- Phone charges: 8.22 g CO₂ per charge (US average)
- LED hours: 10W LED at local grid intensity
- Equivalencies update whenever region or scale changes
- Source: EPA Greenhouse Gas Equivalencies Calculator

### US-5 Hot-path LLM token reduction
As an operator running EcoSpec at scale, I want the LLM optimization call to use the minimum tokens necessary, so the tool practices the carbon efficiency it preaches.

**Acceptance criteria:**
- Source code is parsed into function-level AST nodes before calling the LLM
- Functions are scored by cyclomatic complexity proxy (loops × 3 + branches + nesting depth)
- Only the top-5 highest-complexity functions are sent to the LLM
- Token reduction ≥ 70% vs. sending the full file for files with ≥ 5 functions
- Token reduction percentage is logged to the extension console on every LLM call
- LLM prompt explicitly frames suggestions in terms of carbon savings

### US-6 Baseline carbon comparison
As a developer who has applied an optimization, I want to see the carbon savings vs. the pre-optimization baseline, so I can quantify the environmental benefit of my changes.

**Acceptance criteria:**
- Marking a session as baseline persists it to disk
- Carbon delta (g CO₂e/run and kg/year) shown vs baseline
- "Carbon saved" banner appears when current session outperforms baseline
- Savings expressed in both raw CO₂e and car-km equivalent
