# Carbon Accountability — Tasks

## Implementation

- [x] 1. Add CSS for carbon grade badge (.carbon-grade, .grade-a through .grade-f)
- [x] 2. Add carbon-header-row with grade badge to carbon card HTML
- [x] 3. Add region selector dropdown with EPA eGRID 2022 values
- [x] 4. Add production scale input (runs/day) with live re-render
- [x] 5. Add equivalency chips row (car, phone, LED)
- [x] 6. Implement getCarbonGrade() with A–F thresholds
- [x] 7. Implement getGridIntensity() reading region dropdown
- [x] 8. Implement getRunsPerDay() reading scale input
- [x] 9. Implement renderEquivalencies() with EPA conversion factors
- [x] 10. Update renderCarbon() to use dynamic region, scale, grade, and equivalencies
- [x] 11. Add source attribution footer to carbon card
- [x] 12. Fix dead-code bug: add baselineUpdated case to webview message handler
- [x] 13. Register kiro-profiler.markBaseline command in extension.ts
- [x] 14. Register kiro-profiler.loadSession command in extension.ts
- [x] 15. Add sendBaseline() method to DashboardPanel
- [x] 16. Create hotPathExtractor.ts with extractHotPath(), scoreComplexity(), extractPythonFunctions(), extractJsFunctions()
- [x] 17. Update LlmOptimizer.buildPrompt() to use hot-path extraction
- [x] 18. Add carbon context section to LLM prompt (g CO₂/run, annual kg, car-km equivalent)
- [x] 19. Log token reduction metadata to console on every LLM call
- [x] 20. Create package.json and tsconfig.json for extension packaging
- [x] 21. Write carbon-accountability spec (this file)
