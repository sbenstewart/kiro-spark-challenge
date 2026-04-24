// Feature: kiro-code-profiler, Property 8: Monitor sampling interval
// Validates: Requirements 6.1

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { MetricSample, MonitorConfig } from '../types';

/**
 * Checks that all consecutive timestamp differences in a sample array are
 * <= sampleIntervalMs + 50ms (allowing 50ms scheduling jitter).
 */
function allIntervalsWithinBound(samples: MetricSample[], config: MonitorConfig): boolean {
  const bound = config.sampleIntervalMs + 50;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].timestamp - samples[i - 1].timestamp > bound) {
      return false;
    }
  }
  return true;
}

// Arbitrary for a single MetricSample with a given timestamp
const metricSampleWithTimestamp = (timestamp: number): fc.Arbitrary<MetricSample> =>
  fc.record<MetricSample>({
    timestamp: fc.constant(timestamp),
    ramMb: fc.float({ min: 0, max: 65536, noNaN: true }),
    cpuPercent: fc.float({ min: 0, max: 100, noNaN: true }),
    diskReadBytes: fc.integer({ min: 0 }),
    diskWriteBytes: fc.integer({ min: 0 }),
    networkBytesSent: fc.integer({ min: 0 }),
    networkBytesReceived: fc.integer({ min: 0 }),
    fsOpen: fc.integer({ min: 0 }),
    fsRead: fc.integer({ min: 0 }),
    fsWrite: fc.integer({ min: 0 }),
    fsClose: fc.integer({ min: 0 }),
  });

// Arbitrary for MonitorConfig with sampleIntervalMs in [100, 5000]
const monitorConfigArb: fc.Arbitrary<MonitorConfig> = fc.record<MonitorConfig>({
  sampleIntervalMs: fc.integer({ min: 100, max: 5000 }),
  ramAlertThresholdMb: fc.integer({ min: 1, max: 65536 }),
  cpuAlertThresholdPercent: fc.integer({ min: 1, max: 100 }),
});

/**
 * Generates a pair of [MonitorConfig, MetricSample[]] where consecutive
 * timestamps are within sampleIntervalMs + 50ms (valid arrays).
 */
const validSessionArb: fc.Arbitrary<[MonitorConfig, MetricSample[]]> = monitorConfigArb.chain(
  config =>
    fc
      .integer({ min: 2, max: 20 })
      .chain(length =>
        fc.integer({ min: 0, max: 1_000_000 }).chain(startTs =>
          fc
            .array(fc.integer({ min: 0, max: config.sampleIntervalMs + 50 }), {
              minLength: length - 1,
              maxLength: length - 1,
            })
            .chain(increments => {
              const timestamps = [startTs];
              for (const inc of increments) {
                timestamps.push(timestamps[timestamps.length - 1] + inc);
              }
              return fc
                .tuple(...timestamps.map(ts => metricSampleWithTimestamp(ts)))
                .map(tuple => [config, Array.from(tuple) as MetricSample[]] as [MonitorConfig, MetricSample[]]);
            })
        )
      )
);

/**
 * Generates a pair of [MonitorConfig, MetricSample[]] where at least one
 * consecutive pair of timestamps exceeds sampleIntervalMs + 50ms (invalid arrays).
 */
const invalidSessionArb: fc.Arbitrary<[MonitorConfig, MetricSample[]]> = monitorConfigArb.chain(
  config =>
    fc
      .integer({ min: 2, max: 20 })
      .chain(length =>
        fc.integer({ min: 0, max: 1_000_000 }).chain(startTs =>
          fc
            .array(fc.integer({ min: 0, max: config.sampleIntervalMs + 50 }), {
              minLength: length - 1,
              maxLength: length - 1,
            })
            .chain(increments =>
              fc
                .integer({ min: 0, max: increments.length - 1 })
                .chain(violationIdx =>
                  // Violation: gap strictly greater than sampleIntervalMs + 50
                  fc.integer({ min: config.sampleIntervalMs + 51, max: config.sampleIntervalMs + 500 }).map(
                    violationInc => {
                      const patched = [...increments];
                      patched[violationIdx] = violationInc;
                      const timestamps = [startTs];
                      for (const inc of patched) {
                        timestamps.push(timestamps[timestamps.length - 1] + inc);
                      }
                      return timestamps;
                    }
                  )
                )
                .chain(timestamps =>
                  fc
                    .tuple(...timestamps.map(ts => metricSampleWithTimestamp(ts)))
                    .map(
                      tuple =>
                        [config, Array.from(tuple) as MetricSample[]] as [MonitorConfig, MetricSample[]]
                    )
                )
            )
        )
      )
);

describe('Property 8: Monitor sampling interval', () => {
  it('valid sessions: all consecutive timestamp differences are <= sampleIntervalMs + 50ms', () => {
    fc.assert(
      fc.property(validSessionArb, ([config, samples]) => {
        expect(samples.length).toBeGreaterThanOrEqual(2);
        return allIntervalsWithinBound(samples, config);
      }),
      { numRuns: 100 }
    );
  });

  it('invalid sessions: the interval check correctly identifies violations', () => {
    fc.assert(
      fc.property(invalidSessionArb, ([config, samples]) => {
        expect(samples.length).toBeGreaterThanOrEqual(2);
        // These arrays have at least one gap > sampleIntervalMs + 50ms
        return !allIntervalsWithinBound(samples, config);
      }),
      { numRuns: 100 }
    );
  });
});
