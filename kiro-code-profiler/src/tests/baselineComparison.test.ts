import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeBaselineComparison } from '../baselineComparison';
import { ProfileSession, MetricsSummary } from '../types';

// Helper to build a minimal ProfileSession with specific metric values
function makeSession(id: string, metrics: Partial<MetricsSummary>): ProfileSession {
  const defaultMetrics: MetricsSummary = {
    peakRamMb: 0,
    avgRamMb: 0,
    totalDiskReadBytes: 0,
    totalDiskWriteBytes: 0,
    avgCpuPercent: 0,
    totalNetworkBytesSent: 0,
    totalNetworkBytesReceived: 0,
    totalFsOpen: 0,
    totalFsRead: 0,
    totalFsWrite: 0,
    totalFsClose: 0,
    executionTimeMs: 0,
    energyMwh: 0,
    samples: [],
  };
  return {
    id,
    workspacePath: '/workspace',
    filePath: '/workspace/test.ts',
    language: 'typescript',
    sessionType: 'profile',
    startTime: 0,
    endTime: 1000,
    exitCode: 0,
    stdout: '',
    stderr: '',
    metrics: { ...defaultMetrics, ...metrics },
    isBaseline: false,
    optimizationSuggestions: [],
  };
}

// Feature: kiro-code-profiler, Property 4: Baseline delta correctness
// Validates: Requirements 2.4, 5.4
describe('Property 4: Baseline delta correctness', () => {
  it('delta equals (current - baseline) / baseline * 100 rounded to 2dp for non-zero baselines', () => {
    fc.assert(
      fc.property(
        // Use finite positive doubles for baseline (non-zero) and any finite double for current
        fc.double({ min: 0.01, max: 1e6, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        (baseline, current) => {
          const baselineSession = makeSession('base', {
            peakRamMb: baseline,
            avgCpuPercent: baseline,
            energyMwh: baseline,
            executionTimeMs: baseline,
            totalDiskReadBytes: baseline,
            totalDiskWriteBytes: baseline,
          });
          const currentSession = makeSession('curr', {
            peakRamMb: current,
            avgCpuPercent: current,
            energyMwh: current,
            executionTimeMs: current,
            totalDiskReadBytes: current,
            totalDiskWriteBytes: current,
          });

          const result = computeBaselineComparison(baselineSession, currentSession);
          const expected = Math.round(((current - baseline) / baseline) * 100 * 100) / 100;

          const { deltas } = result;
          return (
            deltas.ramMb === expected &&
            deltas.cpuPercent === expected &&
            deltas.energyMwh === expected &&
            deltas.executionTimeMs === expected &&
            deltas.diskReadBytes === expected &&
            deltas.diskWriteBytes === expected
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('computeBaselineComparison() unit tests', () => {
  it('returns correct session IDs', () => {
    const base = makeSession('baseline-id', { peakRamMb: 100 });
    const curr = makeSession('current-id', { peakRamMb: 150 });
    const result = computeBaselineComparison(base, curr);
    expect(result.baselineSessionId).toBe('baseline-id');
    expect(result.currentSessionId).toBe('current-id');
  });

  it('zero-baseline guard: returns 0 delta when baseline is 0', () => {
    const base = makeSession('base', {
      peakRamMb: 0,
      avgCpuPercent: 0,
      energyMwh: 0,
      executionTimeMs: 0,
      totalDiskReadBytes: 0,
      totalDiskWriteBytes: 0,
    });
    const curr = makeSession('curr', {
      peakRamMb: 100,
      avgCpuPercent: 50,
      energyMwh: 10,
      executionTimeMs: 500,
      totalDiskReadBytes: 1024,
      totalDiskWriteBytes: 2048,
    });
    const result = computeBaselineComparison(base, curr);
    expect(result.deltas.ramMb).toBe(0);
    expect(result.deltas.cpuPercent).toBe(0);
    expect(result.deltas.energyMwh).toBe(0);
    expect(result.deltas.executionTimeMs).toBe(0);
    expect(result.deltas.diskReadBytes).toBe(0);
    expect(result.deltas.diskWriteBytes).toBe(0);
  });

  it('positive delta when current > baseline', () => {
    // baseline=100, current=150 → (150-100)/100*100 = 50%
    const base = makeSession('base', { peakRamMb: 100 });
    const curr = makeSession('curr', { peakRamMb: 150 });
    const result = computeBaselineComparison(base, curr);
    expect(result.deltas.ramMb).toBe(50);
  });

  it('negative delta when current < baseline', () => {
    // baseline=200, current=100 → (100-200)/200*100 = -50%
    const base = makeSession('base', { peakRamMb: 200 });
    const curr = makeSession('curr', { peakRamMb: 100 });
    const result = computeBaselineComparison(base, curr);
    expect(result.deltas.ramMb).toBe(-50);
  });

  it('zero delta when current equals baseline', () => {
    const base = makeSession('base', { peakRamMb: 128 });
    const curr = makeSession('curr', { peakRamMb: 128 });
    const result = computeBaselineComparison(base, curr);
    expect(result.deltas.ramMb).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    // baseline=3, current=4 → (4-3)/3*100 = 33.333... → 33.33
    const base = makeSession('base', { peakRamMb: 3 });
    const curr = makeSession('curr', { peakRamMb: 4 });
    const result = computeBaselineComparison(base, curr);
    expect(result.deltas.ramMb).toBe(33.33);
  });

  it('computes all six metrics independently', () => {
    const base = makeSession('base', {
      peakRamMb: 100,
      avgCpuPercent: 50,
      energyMwh: 10,
      executionTimeMs: 1000,
      totalDiskReadBytes: 4096,
      totalDiskWriteBytes: 2048,
    });
    const curr = makeSession('curr', {
      peakRamMb: 200,   // +100%
      avgCpuPercent: 25, // -50%
      energyMwh: 10,    // 0%
      executionTimeMs: 1500, // +50%
      totalDiskReadBytes: 8192, // +100%
      totalDiskWriteBytes: 1024, // -50%
    });
    const { deltas } = computeBaselineComparison(base, curr);
    expect(deltas.ramMb).toBe(100);
    expect(deltas.cpuPercent).toBe(-50);
    expect(deltas.energyMwh).toBe(0);
    expect(deltas.executionTimeMs).toBe(50);
    expect(deltas.diskReadBytes).toBe(100);
    expect(deltas.diskWriteBytes).toBe(-50);
  });
});
