# Carbon Accountability — Design

## Architecture

```
ProfileSession (executionTimeMs, metrics)
  │
  ▼
carbonGrams(executionTimeMs)
  ├── getGridIntensity()  ← region dropdown value (g CO₂/kWh, EPA eGRID 2022)
  └── LAPTOP_TDP_W × time → joules → kWh → CO₂ grams
  │
  ▼
getCarbonGrade(grams)   → badge { letter, cssClass }
  │
  ▼
renderEquivalencies(annualKg)
  ├── car km  (EPA 404 g CO₂/mile)
  ├── phone charges  (8.22 g CO₂/charge)
  └── LED hours  (10W at grid intensity)
  │
  ▼
Dashboard webview
  ├── Grade badge (A–F, color-coded)
  ├── Region selector (EPA eGRID 2022 values)
  ├── Production scale input (runs/day)
  ├── Metrics grid (per-run, annual, trees)
  ├── Equivalency chips (car, phone, LED)
  └── Carbon savings banner (vs baseline)
```

## Hot-path extraction architecture

```
sourceCode + language
  │
  ▼
hotPathExtractor.extractHotPath()
  ├── extractPythonFunctions()  OR  extractJsFunctions()
  │     └── regex-based function boundary detection
  ├── scoreComplexity()
  │     ├── loop count × 3
  │     ├── branch count × 1
  │     ├── nesting depth × 2
  │     └── array method count × 2
  └── top-5 by score → HotPathResult { context, meta }
  │
  ▼
LlmOptimizer.buildPrompt()
  ├── embeds hotPath.context (not full source)
  ├── adds carbon impact section (g CO₂/run, annual kg, car-km)
  └── frames instructions around carbon savings priority
```

## Data sources and verifiability

| Value | Source | Verified |
|---|---|---|
| US grid: 386 g CO₂/kWh | EPA eGRID 2022, US average | ✓ |
| AWS us-west-2: 136 g CO₂/kWh | EPA eGRID 2022, WECC Northwest | ✓ |
| AWS eu-west-1: 279 g CO₂/kWh | EEA 2022, Ireland | ✓ |
| AWS ap-southeast-1: 493 g CO₂/kWh | IEA 2022, Singapore | ✓ |
| Tree absorption: 21 kg CO₂/year | USDA Forest Service | ✓ |
| Car: 404 g CO₂/mile | EPA GHG Equivalencies Calculator | ✓ |
| Phone charge: 8.22 g CO₂ | EPA GHG Equivalencies Calculator | ✓ |
| TDP: 15W laptop default | Industry average; real TDP fetched via systeminformation | ✓ |

## Correctness properties

1. **Grade monotonicity**: getCarbonGrade(x) ≤ getCarbonGrade(y) whenever x ≤ y
2. **Region sensitivity**: changing region produces proportionally different CO₂ values
3. **Scale linearity**: doubling runs/day doubles annual CO₂e exactly
4. **Token reduction**: hotPath.reductionPercent ≥ 0 always; ≥ 70 for files with ≥ 5 functions
5. **Baseline delta sign**: savedG > 0 iff current run is more efficient than baseline
6. **Source attribution**: all data points cite year and agency in UI footer
