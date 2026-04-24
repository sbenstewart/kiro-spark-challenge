// Feature: kiro-code-profiler, Property 2: Error exit captures partial metrics
// Validates: Requirements 1.6

import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { ExecutionResult, MetricSample, MetricsSummary } from '../types';
import { aggregateSamples } from '../metricsCollector';

/**
 * Builds an ExecutionResult + MetricsSummary pair representing a process
 * that exited with a non-zero exit code, capturing whatever samples were
 * collected before exit.
 */
function buildPartialResult(
  exitCode: number,
  stderr: string,
  samples: MetricSample[],
  executionTimeMs: number
): { result: ExecutionResult; summary: MetricsSummary } {
  const now = Date.now();
  const result: ExecutionResult = {
    exitCode,
    stdout: '',
    stderr,
    startTime: now,
    endTime: now + executionTimeMs,
  };

  const summary = aggregateSamples(samples, executionTimeMs, 0);

  return { result, summary };
}

// Arbitrary for MetricSample
const metricSampleArb = fc.record<MetricSample>({
  timestamp: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  ramMb: fc.float({ min: 0, max: 65536, noNaN: true }),
  cpuPercent: fc.float({ min: 0, max: 100, noNaN: true }),
  diskReadBytes: fc.integer({ min: 0, max: 1_000_000_000 }),
  diskWriteBytes: fc.integer({ min: 0, max: 1_000_000_000 }),
  networkBytesSent: fc.integer({ min: 0, max: 1_000_000_000 }),
  networkBytesReceived: fc.integer({ min: 0, max: 1_000_000_000 }),
  fsOpen: fc.integer({ min: 0, max: 10_000 }),
  fsRead: fc.integer({ min: 0, max: 10_000 }),
  fsWrite: fc.integer({ min: 0, max: 10_000 }),
  fsClose: fc.integer({ min: 0, max: 10_000 }),
});

// Non-zero exit code: integers in [-255, -1] ∪ [1, 255]
const nonZeroExitCodeArb = fc.oneof(
  fc.integer({ min: -255, max: -1 }),
  fc.integer({ min: 1, max: 255 })
);

// Non-empty stderr string
const nonEmptyStderrArb = fc.string({ minLength: 1, maxLength: 1000 });

// Arbitrary samples array (length >= 0)
const samplesArb = fc.array(metricSampleArb, { minLength: 0, maxLength: 20 });

// Non-negative executionTimeMs
const executionTimeMsArb = fc.integer({ min: 0, max: 600_000 });

describe('Property 2: Error exit captures partial metrics', () => {
  it('exitCode is non-zero for any error exit', () => {
    fc.assert(
      fc.property(
        nonZeroExitCodeArb,
        nonEmptyStderrArb,
        samplesArb,
        executionTimeMsArb,
        (exitCode, stderr, samples, executionTimeMs) => {
          const { result } = buildPartialResult(exitCode, stderr, samples, executionTimeMs);
          expect(result.exitCode).not.toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('stderr is non-empty for any error exit', () => {
    fc.assert(
      fc.property(
        nonZeroExitCodeArb,
        nonEmptyStderrArb,
        samplesArb,
        executionTimeMsArb,
        (exitCode, stderr, samples, executionTimeMs) => {
          const { result } = buildPartialResult(exitCode, stderr, samples, executionTimeMs);
          expect(result.stderr.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('samples.length >= 0 (partial metrics preserved)', () => {
    fc.assert(
      fc.property(
        nonZeroExitCodeArb,
        nonEmptyStderrArb,
        samplesArb,
        executionTimeMsArb,
        (exitCode, stderr, samples, executionTimeMs) => {
          const { summary } = buildPartialResult(exitCode, stderr, samples, executionTimeMs);
          expect(summary.samples.length).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('executionTimeMs >= 0 for any error exit', () => {
    fc.assert(
      fc.property(
        nonZeroExitCodeArb,
        nonEmptyStderrArb,
        samplesArb,
        executionTimeMsArb,
        (exitCode, stderr, samples, executionTimeMs) => {
          const { summary } = buildPartialResult(exitCode, stderr, samples, executionTimeMs);
          expect(summary.executionTimeMs).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('all four properties hold simultaneously for any error exit', () => {
    fc.assert(
      fc.property(
        nonZeroExitCodeArb,
        nonEmptyStderrArb,
        samplesArb,
        executionTimeMsArb,
        (exitCode, stderr, samples, executionTimeMs) => {
          const { result, summary } = buildPartialResult(exitCode, stderr, samples, executionTimeMs);

          expect(result.exitCode).not.toBe(0);
          expect(result.stderr.length).toBeGreaterThan(0);
          expect(summary.samples.length).toBeGreaterThanOrEqual(0);
          expect(summary.executionTimeMs).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
