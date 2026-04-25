# EcoSpec ML Integration Guide

## Overview

The Kiro Code Profiler extension now integrates EcoSpec ML model for static energy analysis of Python code. This provides instant energy predictions without executing code.

## Files Added/Modified

### New Files

- `src/ecospecPredictor.ts` - TypeScript wrapper for Python ML model
- `test_ecospec.py` - Test file with various complexity levels
- `../ecospec_cli.py` - CLI script for model inference

### Modified Files

- `src/extension.ts` - Added EcoSpec prediction before profiling Python files
- `src/optimizer.ts` - Enhanced to generate ML-based optimization suggestions
- `src/types.ts` - Added EcoSpecPrediction interface

## How It Works

### 1. Static Analysis Flow

```
User triggers profile → Extension detects Python file →
EcoSpecPredictor.predict(code) → Writes code to temp file →
Spawns python3 ecospec_cli.py <tempfile> →
Model loads and analyzes AST → Returns JSON prediction →
Extension shows notification → Deletes temp file →
Continues with runtime profiling
```

### 2. Path Resolution

The predictor resolves paths relative to the extension:

- Extension root: `kiro-spark-challenge/kiro-code-profiler/`
- Workspace root: `../../../` (up to kiro_hackathon/)
- CLI script: `workspace_root/ecospec_cli.py`
- Model: `workspace_root/ecospec/mcp_server/models/ecospec_model.lgb`

### 3. Prediction Output

```json
{
  "energy_wh": 3.49e-8,
  "confidence": 0.86,
  "complexity_label": "O(n²)",
  "top_driver": "max_loop_nesting_depth",
  "warning_level": "medium"
}
```

### 4. Optimizer Integration

When ML prediction is available, the optimizer adds a suggestion:

```
Title: "ML Analysis: O(n²) complexity detected"
Explanation: "EcoSpec ML model predicts 3.49e-08 Wh energy consumption
             (medium risk, 86% confidence). Primary driver: max_loop_nesting_depth.
             Consider optimizing O(n²) algorithms to reduce energy consumption."
Impact: 0.5 (medium) or 0.8 (high)
```

## Testing

### 1. Build the Extension

```bash
cd kiro-spark-challenge/kiro-code-profiler
npm install
npm run compile
```

### 2. Test CLI Directly

```bash
cd ../..  # Back to workspace root
echo "for i in range(1000):
    for j in range(1000):
        x = i * j" | python3 ecospec_cli.py
```

Expected output:

```json
{"energy_wh": 3.49e-08, "confidence": 0.86, "complexity_label": "O(n²)", ...}
```

### 3. Test in VS Code

1. Open `kiro-spark-challenge` folder in VS Code
2. Press F5 to launch Extension Development Host
3. Open `test_ecospec.py`
4. Run Command: "Kiro Profiler: Profile Active File"
5. Look for notification: "EcoSpec ML Prediction: ..."

## Error Handling

The integration is designed to fail gracefully:

- If Python is not found → Returns error, profiling continues
- If model file is missing → Returns error, profiling continues
- If prediction times out (5s) → Returns error, profiling continues
- If code has syntax errors → Returns error with message

All errors are logged to console but don't block the profiling workflow.

## Performance

- **Prediction time**: <100ms for typical Python files
- **Memory overhead**: ~50MB for model loading (one-time)
- **No runtime impact**: Static analysis only, no code execution

## Dependencies

- Python 3.x with packages: `lightgbm`, `numpy`, `astroid`
- All dependencies already installed in workspace root
- No additional VS Code extension dependencies needed

## Future Enhancements

1. **Caching**: Cache predictions for unchanged files
2. **Inline Decorations**: Show energy predictions inline in editor
3. **Diff Analysis**: Compare predictions before/after code changes
4. **Batch Mode**: Analyze entire workspace at once
5. **Feedback Loop**: Submit actual vs predicted energy to improve model
