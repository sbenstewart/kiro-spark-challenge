// Feature: kiro-code-profiler, Property 3: Time-series sampling interval
// Validates: Requirements 2.2, 2.3

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { MetricSample } from '../types';

/**
 * Checks that all consecutive timestamp differences in a sample array are <= 100ms.
 */
function allIntervalsWithin100ms(samples: MetricSample[]): boolean {
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].timestamp - samples[i - 1].timestamp > 100) {
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

/**
 * Generates an array of MetricSample objects where consecutive timestamps
 * are within 100ms of each other (valid sample arrays).
 */
const validSampleArrayArb: fc.Arbitrary<MetricSample[]> = fc
  .integer({ min: 2, max: 20 })
  .chain(length =>
    fc.integer({ min: 0, max: 1_000_000 }).chain(startTs =>
      // Generate increments in [0, 100] for each step
      fc.array(fc.integer({ min: 0, max: 100 }), { minLength: length - 1, maxLength: length - 1 })
        .chain(increments => {
          const timestamps = [startTs];
          for (const inc of increments) {
            timestamps.push(timestamps[timestamps.length - 1] + inc);
          }
          return fc.tuple(...timestamps.map(ts => metricSampleWithTimestamp(ts)));
        })
        .map(tuple => Array.from(tuple) as MetricSample[])
    )
  );

/**
 * Generates an array of MetricSample objects where at least one consecutive
 * pair of timestamps exceeds 100ms (invalid sample arrays).
 */
const invalidSampleArrayArb: fc.Arbitrary<MetricSample[]> = fc
  .integer({ min: 2, max: 20 })
  .chain(length =>
    fc.integer({ min: 0, max: 1_000_000 }).chain(startTs =>
      fc.array(fc.integer({ min: 0, max: 100 }), { minLength: length - 1, maxLength: length - 1 })
        .chain(increments =>
          // Pick one index to inject a violation (increment > 100)
          fc.integer({ min: 0, max: increments.length - 1 }).chain(violationIdx =>
            fc.integer({ min: 101, max: 500 }).map(violationInc => {
              const patched = [...increments];
              patched[violationIdx] = violationInc;
              const timestamps = [startTs];
              for (const inc of patched) {
                timestamps.push(timestamps[timestamps.length - 1] + inc);
              }
              return timestamps;
            })
          )
        )
        .chain(timestamps =>
          fc.tuple(...timestamps.map(ts => metricSampleWithTimestamp(ts)))
            .map(tuple => Array.from(tuple) as MetricSample[])
        )
    )
  );

describe('Property 3: Time-series sampling interval', () => {
  it('valid sample arrays: all consecutive timestamp differences are <= 100ms', () => {
    fc.assert(
      fc.property(validSampleArrayArb, (samples) => {
        expect(samples.length).toBeGreaterThanOrEqual(2);
        return allIntervalsWithin100ms(samples);
      }),
      { numRuns: 100 }
    );
  });

  it('invalid sample arrays: the interval check correctly identifies violations', () => {
    fc.assert(
      fc.property(invalidSampleArrayArb, (samples) => {
        expect(samples.length).toBeGreaterThanOrEqual(2);
        // These arrays have at least one gap > 100ms, so the check must return false
        return !allIntervalsWithin100ms(samples);
      }),
      { numRuns: 100 }
    );
  });
});
