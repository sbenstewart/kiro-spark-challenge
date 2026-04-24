import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Optimizer } from '../optimizer';
import { MetricsSummary, OptimizationSuggestion, ProfileSession } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<MetricsSummary> = {}): MetricsSummary {
  return {
    peakRamMb: 100,
    avgRamMb: 80,
    totalDiskReadBytes: 0,
    totalDiskWriteBytes: 0,
    avgCpuPercent: 10,
    totalNetworkBytesSent: 0,
    totalNetworkBytesReceived: 0,
    totalFsOpen: 0,
    totalFsRead: 0,
    totalFsWrite: 0,
    totalFsClose: 0,
    executionTimeMs: 100,
    energyMwh: 0.01,
    samples: [],
    ...overrides,
  };
}

function makeSession(metricsOverrides: Partial<MetricsSummary> = {}): ProfileSession {
  return {
    id: 'test-session',
    workspacePath: '/workspace',
    filePath: '/workspace/test.ts',
    language: 'typescript',
    sessionType: 'profile',
    startTime: Date.now(),
    endTime: Date.now() + 100,
    exitCode: 0,
    stdout: '',
    stderr: '',
    metrics: makeMetrics(metricsOverrides),
    isBaseline: false,
    optimizationSuggestions: [],
  };
}

// ---------------------------------------------------------------------------
// Property 5: Suggestions have explanations and are ranked
// Feature: kiro-code-profiler, Property 5: Suggestions have explanations and are ranked
// Validates: Requirements 4.2, 4.6
// ---------------------------------------------------------------------------

describe('Property 5: Suggestions have explanations and are ranked', () => {
  it('every suggestion has a non-empty explanation and list is sorted by estimatedImpact descending', async () => {
    // Use a low threshold so suggestions are reliably generated
    const optimizer = new Optimizer({
      ramThresholdMb: 1,
      cpuThresholdPercent: 1,
      energyThresholdMwh: 0.001,
      executionTimeThresholdMs: 1,
    });

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          peakRamMb: fc.double({ min: 2, max: 10000, noNaN: true }),
          avgCpuPercent: fc.double({ min: 2, max: 100, noNaN: true }),
          energyMwh: fc.double({ min: 0.002, max: 100, noNaN: true }),
          executionTimeMs: fc.integer({ min: 2, max: 100000 }),
        }),
        async (metrics) => {
          const session = makeSession(metrics);
          const suggestions = await optimizer.suggest(session, 'const x = 1;');

          // Every suggestion must have a non-empty explanation
          for (const s of suggestions) {
            expect(s.explanation.length).toBeGreaterThan(0);
          }

          // List must be sorted by estimatedImpact descending
          for (let i = 0; i < suggestions.length - 1; i++) {
            expect(suggestions[i].estimatedImpact).toBeGreaterThanOrEqual(
              suggestions[i + 1].estimatedImpact
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14: Threshold suggestions triggered
// Feature: kiro-code-profiler, Property 14: Threshold suggestions triggered
// Validates: Requirements 4.1
// ---------------------------------------------------------------------------

describe('Property 14: Threshold suggestions triggered', () => {
  it('returns at least one suggestion when at least one metric exceeds its threshold', async () => {
    const thresholds = {
      ramThresholdMb: 512,
      cpuThresholdPercent: 80,
      energyThresholdMwh: 1.0,
      executionTimeThresholdMs: 5000,
    };
    const optimizer = new Optimizer(thresholds);

    // Arbitrarily pick which metric to breach
    const metricBreachArb = fc.oneof(
      fc.record({ peakRamMb: fc.double({ min: 513, max: 10000, noNaN: true }) }),
      fc.record({ avgCpuPercent: fc.double({ min: 81, max: 100, noNaN: true }) }),
      fc.record({ energyMwh: fc.double({ min: 1.01, max: 100, noNaN: true }) }),
      fc.record({ executionTimeMs: fc.integer({ min: 5001, max: 100000 }) })
    );

    await fc.assert(
      fc.asyncProperty(metricBreachArb, async (breach) => {
        const session = makeSession(breach);
        const suggestions = await optimizer.suggest(session, '');
        expect(suggestions.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests for Optimizer
// ---------------------------------------------------------------------------

describe('Optimizer unit tests', () => {
  it('returns no suggestions when no thresholds are exceeded', async () => {
    const optimizer = new Optimizer();
    const session = makeSession({
      peakRamMb: 100,
      avgCpuPercent: 10,
      energyMwh: 0.1,
      executionTimeMs: 500,
    });
    const suggestions = await optimizer.suggest(session, '');
    expect(suggestions).toHaveLength(0);
  });

  it('generates a suggestion when RAM threshold is exceeded', async () => {
    const optimizer = new Optimizer({ ramThresholdMb: 512 });
    const session = makeSession({ peakRamMb: 1024 });
    const suggestions = await optimizer.suggest(session, '');
    const ramSuggestion = suggestions.find((s) => s.affectedMetric === 'ram');
    expect(ramSuggestion).toBeDefined();
    expect(ramSuggestion!.explanation.length).toBeGreaterThan(0);
  });

  it('generates a suggestion when CPU threshold is exceeded', async () => {
    const optimizer = new Optimizer({ cpuThresholdPercent: 80 });
    const session = makeSession({ avgCpuPercent: 95 });
    const suggestions = await optimizer.suggest(session, '');
    const cpuSuggestion = suggestions.find((s) => s.affectedMetric === 'cpu');
    expect(cpuSuggestion).toBeDefined();
  });

  it('generates a suggestion when energy threshold is exceeded', async () => {
    const optimizer = new Optimizer({ energyThresholdMwh: 1.0 });
    const session = makeSession({ energyMwh: 5.0 });
    const suggestions = await optimizer.suggest(session, '');
    const energySuggestion = suggestions.find((s) => s.affectedMetric === 'energy');
    expect(energySuggestion).toBeDefined();
  });

  it('generates a suggestion when execution time threshold is exceeded', async () => {
    const optimizer = new Optimizer({ executionTimeThresholdMs: 5000 });
    const session = makeSession({ executionTimeMs: 10000 });
    const suggestions = await optimizer.suggest(session, '');
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('sorts suggestions by estimatedImpact descending', async () => {
    const optimizer = new Optimizer({
      ramThresholdMb: 100,
      cpuThresholdPercent: 10,
      energyThresholdMwh: 0.001,
      executionTimeThresholdMs: 50,
    });
    const session = makeSession({
      peakRamMb: 200,    // 100% over threshold → impact 1.0
      avgCpuPercent: 20, // 100% over threshold → impact 1.0
      energyMwh: 0.01,   // 900% over threshold → impact capped at 1.0
      executionTimeMs: 100, // 100% over threshold → impact 1.0
    });
    const suggestions = await optimizer.suggest(session, '');
    for (let i = 0; i < suggestions.length - 1; i++) {
      expect(suggestions[i].estimatedImpact).toBeGreaterThanOrEqual(
        suggestions[i + 1].estimatedImpact
      );
    }
  });

  it('returns empty array on error (graceful fallback)', async () => {
    const optimizer = new Optimizer();
    // Pass null as session to trigger an error path
    const suggestions = await optimizer.suggest(null as unknown as ProfileSession, '');
    expect(suggestions).toEqual([]);
  });

  it('each suggestion has a unique id', async () => {
    const optimizer = new Optimizer({
      ramThresholdMb: 1,
      cpuThresholdPercent: 1,
      energyThresholdMwh: 0.001,
      executionTimeThresholdMs: 1,
    });
    const session = makeSession({
      peakRamMb: 100,
      avgCpuPercent: 50,
      energyMwh: 1.0,
      executionTimeMs: 5000,
    });
    const suggestions = await optimizer.suggest(session, '');
    const ids = suggestions.map((s: OptimizationSuggestion) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
