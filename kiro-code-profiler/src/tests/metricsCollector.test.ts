import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { aggregateSamples, MetricsCollector } from '../metricsCollector';
import { MetricSample } from '../types';

// Arbitrary generator for a single MetricSample
const metricSampleArb = fc.record<MetricSample>({
  timestamp: fc.integer({ min: 0 }),
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

describe('aggregateSamples', () => {
  describe('empty samples', () => {
    it('returns zeros for all fields when samples is empty', () => {
      const result = aggregateSamples([], 500, 0.01);
      expect(result.peakRamMb).toBe(0);
      expect(result.avgRamMb).toBe(0);
      expect(result.avgCpuPercent).toBe(0);
      expect(result.totalDiskReadBytes).toBe(0);
      expect(result.totalDiskWriteBytes).toBe(0);
      expect(result.totalNetworkBytesSent).toBe(0);
      expect(result.totalNetworkBytesReceived).toBe(0);
      expect(result.totalFsOpen).toBe(0);
      expect(result.totalFsRead).toBe(0);
      expect(result.totalFsWrite).toBe(0);
      expect(result.totalFsClose).toBe(0);
      expect(result.sampleCount).toBe(0);
      expect(result.dataStatus).toBe('empty');
    });

    it('passes through executionTimeMs and energyMwh when empty', () => {
      const result = aggregateSamples([], 1234, 5.678);
      expect(result.executionTimeMs).toBe(1234);
      expect(result.energyMwh).toBe(5.678);
      expect(result.samples).toEqual([]);
    });
  });

  describe('single sample', () => {
    it('peak and avg equal the single sample value', () => {
      const sample: MetricSample = {
        timestamp: 1000, ramMb: 128, cpuPercent: 42,
        diskReadBytes: 100, diskWriteBytes: 200,
        networkBytesSent: 300, networkBytesReceived: 400,
        fsOpen: 1, fsRead: 2, fsWrite: 3, fsClose: 4,
      };
      const result = aggregateSamples([sample], 1000, 0.5);
      expect(result.peakRamMb).toBe(128);
      expect(result.avgRamMb).toBe(128);
      expect(result.avgCpuPercent).toBe(42);
      expect(result.totalDiskReadBytes).toBe(100);
      expect(result.totalDiskWriteBytes).toBe(200);
      expect(result.totalNetworkBytesSent).toBe(300);
      expect(result.totalNetworkBytesReceived).toBe(400);
      expect(result.totalFsOpen).toBe(1);
      expect(result.totalFsRead).toBe(2);
      expect(result.totalFsWrite).toBe(3);
      expect(result.totalFsClose).toBe(4);
      expect(result.sampleCount).toBe(1);
      expect(result.dataStatus).toBe('partial');
    });
  });

  describe('multiple samples', () => {
    it('computes correct peak, avg, and totals for known inputs', () => {
      const samples: MetricSample[] = [
        { timestamp: 0, ramMb: 100, cpuPercent: 20, diskReadBytes: 10, diskWriteBytes: 5, networkBytesSent: 1, networkBytesReceived: 2, fsOpen: 1, fsRead: 1, fsWrite: 1, fsClose: 1 },
        { timestamp: 1000, ramMb: 200, cpuPercent: 60, diskReadBytes: 20, diskWriteBytes: 10, networkBytesSent: 2, networkBytesReceived: 4, fsOpen: 2, fsRead: 2, fsWrite: 2, fsClose: 2 },
        { timestamp: 2000, ramMb: 150, cpuPercent: 40, diskReadBytes: 30, diskWriteBytes: 15, networkBytesSent: 3, networkBytesReceived: 6, fsOpen: 3, fsRead: 3, fsWrite: 3, fsClose: 3 },
      ];
      const result = aggregateSamples(samples, 3000, 1.0);
      expect(result.peakRamMb).toBe(200);
      expect(result.avgRamMb).toBeCloseTo((100 + 200 + 150) / 3);
      expect(result.avgCpuPercent).toBeCloseTo((20 + 60 + 40) / 3);
      expect(result.totalDiskReadBytes).toBe(60);
      expect(result.totalDiskWriteBytes).toBe(30);
      expect(result.totalNetworkBytesSent).toBe(6);
      expect(result.totalNetworkBytesReceived).toBe(12);
      expect(result.totalFsOpen).toBe(6);
      expect(result.totalFsRead).toBe(6);
      expect(result.totalFsWrite).toBe(6);
      expect(result.totalFsClose).toBe(6);
      expect(result.sampleCount).toBe(3);
      expect(result.dataStatus).toBe('ok');
    });

    it('preserves the original samples array reference', () => {
      const samples: MetricSample[] = [
        { timestamp: 0, ramMb: 50, cpuPercent: 10, diskReadBytes: 0, diskWriteBytes: 0, networkBytesSent: 0, networkBytesReceived: 0, fsOpen: 0, fsRead: 0, fsWrite: 0, fsClose: 0 },
      ];
      const result = aggregateSamples(samples, 100, 0);
      expect(result.samples).toBe(samples);
    });
  });

  // Feature: kiro-code-profiler, Property 1: Metrics summary completeness
  // Validates: Requirements 1.2, 1.3, 1.5, 3.1, 3.3, 3.4
  describe('Property 1: Metrics summary completeness', () => {
    it('all required fields are finite non-negative numbers for any MetricSample[]', () => {
      fc.assert(
        fc.property(
          fc.array(metricSampleArb, { minLength: 0, maxLength: 50 }),
          fc.float({ min: 0, max: 1e9, noNaN: true }),
          fc.float({ min: 0, max: 1e6, noNaN: true }),
          (samples, executionTimeMs, energyMwh) => {
            const result = aggregateSamples(samples, executionTimeMs, energyMwh);
            const numericFields = [
              result.peakRamMb,
              result.avgRamMb,
              result.avgCpuPercent,
              result.totalDiskReadBytes,
              result.totalDiskWriteBytes,
              result.totalNetworkBytesSent,
              result.totalNetworkBytesReceived,
              result.totalFsOpen,
              result.totalFsRead,
              result.totalFsWrite,
              result.totalFsClose,
              result.executionTimeMs,
              result.energyMwh,
            ];
            return numericFields.every(v => typeof v === 'number' && isFinite(v) && v >= 0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('peakRamMb >= avgRamMb for any non-empty sample array', () => {
      fc.assert(
        fc.property(
          fc.array(metricSampleArb, { minLength: 1, maxLength: 50 }),
          (samples) => {
            const result = aggregateSamples(samples, 1000, 0);
            return result.peakRamMb >= result.avgRamMb;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

describe('MetricsCollector stub', () => {
  it('start() is a no-op', () => {
    const collector = new MetricsCollector();
    expect(() => collector.start(1234, 500)).not.toThrow();
  });

  it('getSamples() returns empty array', () => {
    const collector = new MetricsCollector();
    expect(collector.getSamples()).toEqual([]);
  });

  it('stop() returns a MetricsSummary with all zeros', () => {
    const collector = new MetricsCollector();
    const summary = collector.stop();
    expect(summary.peakRamMb).toBe(0);
    expect(summary.avgRamMb).toBe(0);
    expect(summary.avgCpuPercent).toBe(0);
    expect(summary.executionTimeMs).toBe(0);
    expect(summary.energyMwh).toBe(0);
    expect(summary.samples).toEqual([]);
  });
});
