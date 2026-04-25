# kiro-spark-challenge

24th April hackathon at ASU

## EcoSpec ML + Context Integration

This VS Code extension now includes EcoSpec ML-based static analysis and surgical code analysis for Python energy optimization.

### Features

- **Static Analysis**: Predicts energy consumption without running code (100× faster than profiling)
- **ML-Powered**: Uses trained LightGBM model with 12 AST-based features
- **Complexity Detection**: Identifies O(1), O(n), O(n²), O(n³) algorithmic complexity
- **Risk Warnings**: Provides low/medium/high energy risk levels
- **Energy Hotspot Detection**: Finds functions with high complexity or deep loop nesting
- **Surgical Code Analysis**: Get function/class details without reading entire files
- **Interactive Navigation**: Jump to hotspots directly from analysis results
- **Smart Suggestions**: Combines ML + code analysis + runtime metrics

### New Commands

1. **Kiro Profiler: Profile Active File** - Full profiling with ML + context analysis
2. **Kiro Profiler: Find Energy Hotspots** - Quick hotspot detection (no execution needed)
3. **Kiro Profiler: Show Dashboard** - View profiling history and suggestions
4. **Kiro Profiler: Monitor** - Real-time process monitoring
5. **Kiro Profiler: Clear History** - Clear profiling data

### How It Works

1. When profiling Python files, the extension automatically runs:
   - EcoSpec ML prediction (energy estimate)
   - Energy hotspot detection (code analysis)
   - Runtime profiling (actual metrics)
2. Results are combined into actionable optimization suggestions
3. Dashboard shows all insights with priority ranking

### Testing

Use `test_ecospec.py` to test the integration:

```bash
# Open test_ecospec.py in VS Code

# Quick hotspot detection (no execution):
# Run Command: "Kiro Profiler: Find Energy Hotspots"
# Should detect nested_loops and triple_nested as hotspots

# Full profiling with all analysis:
# Run Command: "Kiro Profiler: Profile Active File"
# You'll see ML prediction + hotspots + runtime metrics
```

### Architecture

- `src/ecospecPredictor.ts`: TypeScript wrapper for ML model
- `src/ecospecContext.ts`: TypeScript wrapper for code analysis
- `../ecospec_cli.py`: CLI script for ML predictions
- `../ecospec_context_cli.py`: CLI script for code analysis
- `../ecospec/mcp_server/`: Core ML model and analysis logic
- Model: `../ecospec/mcp_server/models/ecospec_model.lgb`

### Value Proposition

- **Speed**: Static analysis completes in <100ms vs seconds/minutes for profiling
- **No Overhead**: Zero runtime instrumentation or monitoring
- **Early Detection**: Catch energy issues during development, not production
- **Actionable**: Identifies specific code patterns driving energy consumption
- **Surgical**: Get only the context you need, when you need it
- **Interactive**: Jump directly to problematic code

### Documentation

- Full integration guide: `ECOSPEC_INTEGRATION.md`
- Context integration: `CONTEXT_INTEGRATION.md`
- Quick start: `../ECOSPEC_CONTEXT_QUICKSTART.md`
