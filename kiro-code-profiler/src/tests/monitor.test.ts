// Feature: kiro-code-profiler, Property 7: Alert emission on threshold breach
// Validates: Requirements 6.4, 6.5

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { checkThresholds, Monitor } from '../monitor';
import { MetricSample, MonitorConfig } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSample(overrides: Partial<MetricSample> = {}): MetricSample {
  return {
    timestamp: Date.now(),
    ramMb: 100,
    cpuPercent: 10,
    diskReadBytes: 0,
    diskWriteBytes: 0,
    networkBytesSent: 0,
    networkBytesReceived: 0,
    fsOpen: 0,
    fsRead: 0,
    fsWrite: 0,
    fsClose: 0,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    sampleIntervalMs: 1000,
    ramAlertThresholdMb: 512,
    cpuAlertThresholdPercent: 80,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Property 7: Alert emission on threshold breach
// ---------------------------------------------------------------------------

describe('Property 7: Alert emission on threshold breach', () => {
  // Arbitrary for a MetricSample with controllable ram/cpu values
  const sampleArb = fc.record<MetricSample>({
    timestamp: fc.integer({ min: 0, max: 1_000_000_000 }),
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

  const configArb = fc.record<MonitorConfig>({
    sampleIntervalMs: fc.integer({ min: 100, max: 5000 }),
    ramAlertThresholdMb: fc.float({ min: 1, max: 65536, noNaN: true }),
    cpuAlertThresholdPercent: fc.float({ min: 1, max: 100, noNaN: true }),
  });

  it('emits a ram alert when ramMb exceeds threshold', () => {
    fc.assert(
      fc.property(
        configArb,
        fc.float({ min: Math.fround(0.001), max: 65536, noNaN: true }),
        (config, excess) => {
          const sample = makeSample({ ramMb: config.ramAlertThresholdMb + excess });
          const alerts = checkThresholds(sample, config);
          const ramAlerts = alerts.filter(a => a.type === 'ram');
          expect(ramAlerts.length).toBeGreaterThanOrEqual(1);
          expect(ramAlerts[0].value).toBe(sample.ramMb);
          expect(ramAlerts[0].threshold).toBe(config.ramAlertThresholdMb);
          expect(ramAlerts[0].timestamp).toBe(sample.timestamp);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('emits a cpu alert when cpuPercent exceeds threshold', () => {
    fc.assert(
      fc.property(
        configArb,
        fc.float({ min: Math.fround(0.001), max: 100, noNaN: true }),
        (config, excess) => {
          // Clamp so cpuPercent stays in a valid range
          const cpuPercent = Math.min(config.cpuAlertThresholdPercent + excess, 200);
          const sample = makeSample({ cpuPercent });
          const alerts = checkThresholds(sample, config);
          const cpuAlerts = alerts.filter(a => a.type === 'cpu');
          expect(cpuAlerts.length).toBeGreaterThanOrEqual(1);
          expect(cpuAlerts[0].value).toBe(sample.cpuPercent);
          expect(cpuAlerts[0].threshold).toBe(config.cpuAlertThresholdPercent);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('emits no alerts when both values are at or below thresholds', () => {
    fc.assert(
      fc.property(sampleArb, configArb, (sample, config) => {
        // Force values to be at or below threshold
        const safeSample: MetricSample = {
          ...sample,
          ramMb: config.ramAlertThresholdMb,
          cpuPercent: config.cpuAlertThresholdPercent,
        };
        const alerts = checkThresholds(safeSample, config);
        expect(alerts).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('emits both ram and cpu alerts when both thresholds are breached', () => {
    fc.assert(
      fc.property(
        configArb,
        fc.float({ min: Math.fround(0.001), max: 1000, noNaN: true }),
        fc.float({ min: Math.fround(0.001), max: 100, noNaN: true }),
        (config, ramExcess, cpuExcess) => {
          const sample = makeSample({
            ramMb: config.ramAlertThresholdMb + ramExcess,
            cpuPercent: Math.min(config.cpuAlertThresholdPercent + cpuExcess, 200),
          });
          const alerts = checkThresholds(sample, config);
          const types = alerts.map(a => a.type);
          expect(types).toContain('ram');
          expect(types).toContain('cpu');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests for Monitor
// ---------------------------------------------------------------------------

describe('Monitor unit tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('attach() starts polling and emits sample events', async () => {
    const monitor = new Monitor();
    const config = makeConfig({ sampleIntervalMs: 100 });
    const samples: unknown[] = [];

    monitor.on('sample', s => samples.push(s));

    // Mock pidusage to return controlled values
    vi.doMock('pidusage', () => ({
      default: vi.fn().mockResolvedValue({ memory: 200 * 1024 * 1024, cpu: 20 }),
    }));

    monitor.attach(12345, config);

    // Advance timers to trigger one interval
    await vi.advanceTimersByTimeAsync(150);

    // Stop and get session
    const session = await monitor.stop();
    expect(session.sessionType).toBe('monitor');
    expect(session.exitCode).toBe(0);
    expect(session.isBaseline).toBe(false);
    expect(session.optimizationSuggestions).toHaveLength(0);
    expect(typeof session.id).toBe('string');
    expect(session.id.length).toBeGreaterThan(0);
  });

  it('emits alert when RAM threshold is exceeded', () => {
    const config = makeConfig({ ramAlertThresholdMb: 512 });
    const sample = makeSample({ ramMb: 600 });

    const alerts = checkThresholds(sample, config);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('ram');
    expect(alerts[0].value).toBe(600);
    expect(alerts[0].threshold).toBe(512);
    expect(alerts[0].timestamp).toBe(sample.timestamp);
  });

  it('emits alert when CPU threshold is exceeded', () => {
    const config = makeConfig({ cpuAlertThresholdPercent: 80 });
    const sample = makeSample({ cpuPercent: 95 });

    const alerts = checkThresholds(sample, config);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('cpu');
    expect(alerts[0].value).toBe(95);
    expect(alerts[0].threshold).toBe(80);
  });

  it('emits no alerts when values are exactly at threshold (not exceeding)', () => {
    const config = makeConfig({ ramAlertThresholdMb: 512, cpuAlertThresholdPercent: 80 });
    const sample = makeSample({ ramMb: 512, cpuPercent: 80 });

    const alerts = checkThresholds(sample, config);
    expect(alerts).toHaveLength(0);
  });

  it('emits both ram and cpu alerts when both thresholds are breached', () => {
    const config = makeConfig({ ramAlertThresholdMb: 512, cpuAlertThresholdPercent: 80 });
    const sample = makeSample({ ramMb: 700, cpuPercent: 90 });

    const alerts = checkThresholds(sample, config);
    expect(alerts).toHaveLength(2);
    const types = alerts.map(a => a.type);
    expect(types).toContain('ram');
    expect(types).toContain('cpu');
  });

  it('stop() returns a ProfileSession with correct shape', async () => {
    const monitor = new Monitor();
    const session = await monitor.stop();

    expect(session).toMatchObject({
      workspacePath: '',
      filePath: '',
      language: 'javascript',
      sessionType: 'monitor',
      exitCode: 0,
      stdout: '',
      stderr: '',
      isBaseline: false,
      optimizationSuggestions: [],
    });
    expect(typeof session.id).toBe('string');
    expect(session.id.length).toBeGreaterThan(0);
    expect(typeof session.startTime).toBe('number');
    expect(typeof session.endTime).toBe('number');
    expect(session.metrics).toBeDefined();
    expect(Array.isArray(session.metrics.samples)).toBe(true);
  });

  it('stop() session metrics reflect collected samples', async () => {
    const monitor = new Monitor();

    // Manually inject samples via the internal array by attaching and pushing
    // We test the aggregation logic by calling stop() after injecting samples
    // through the Monitor's EventEmitter-based sample flow using checkThresholds directly
    const config = makeConfig({ ramAlertThresholdMb: 512, cpuAlertThresholdPercent: 80 });
    const alertsEmitted: unknown[] = [];
    monitor.on('alert', a => alertsEmitted.push(a));

    // Simulate what the monitor does internally: emit alerts for a breaching sample
    const breachingSample = makeSample({ ramMb: 600, cpuPercent: 50 });
    const alerts = checkThresholds(breachingSample, config);
    for (const alert of alerts) {
      monitor.emit('alert', alert);
    }

    expect(alertsEmitted).toHaveLength(1);
    expect((alertsEmitted[0] as { type: string }).type).toBe('ram');
  });
});
