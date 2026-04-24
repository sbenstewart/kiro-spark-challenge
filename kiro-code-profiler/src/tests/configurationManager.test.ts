// Feature: kiro-code-profiler, Property 13: Configuration validation
// Validates: Requirements 8.4

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigurationManager } from '../configurationManager';

const mockSource = (overrides: Record<string, unknown> = {}) => ({
  get: <T>(key: string, defaultValue: T): T =>
    key in overrides ? (overrides[key] as T) : defaultValue,
});

// ---------------------------------------------------------------------------
// Property 13: Configuration validation
// ---------------------------------------------------------------------------

describe('Property 13: Configuration validation', () => {
  it('sampleIntervalMs < 100 is always clamped to 100', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 99 }), (interval) => {
        const mgr = new ConfigurationManager(mockSource({ sampleIntervalMs: interval }));
        const config = mgr.getConfig();
        expect(config.sampleIntervalMs).toBe(100);
      }),
      { numRuns: 100 }
    );
  });

  it('sampleIntervalMs >= 100 is accepted as-is', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 1_000_000 }), (interval) => {
        const mgr = new ConfigurationManager(mockSource({ sampleIntervalMs: interval }));
        const config = mgr.getConfig();
        expect(config.sampleIntervalMs).toBe(interval);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests for ConfigurationManager (Task 7.3)
// ---------------------------------------------------------------------------

describe('ConfigurationManager – default values', () => {
  it('returns ramAlertThresholdMb=512 by default', () => {
    const mgr = new ConfigurationManager(mockSource());
    expect(mgr.getConfig().ramAlertThresholdMb).toBe(512);
  });

  it('returns cpuAlertThresholdPercent=80 by default', () => {
    const mgr = new ConfigurationManager(mockSource());
    expect(mgr.getConfig().cpuAlertThresholdPercent).toBe(80);
  });

  it('returns sampleIntervalMs=1000 by default', () => {
    const mgr = new ConfigurationManager(mockSource());
    expect(mgr.getConfig().sampleIntervalMs).toBe(1000);
  });
});

describe('ConfigurationManager – sampleIntervalMs boundary', () => {
  it('sampleIntervalMs=100 is accepted as-is', () => {
    const mgr = new ConfigurationManager(mockSource({ sampleIntervalMs: 100 }));
    expect(mgr.getConfig().sampleIntervalMs).toBe(100);
  });

  it('sampleIntervalMs=99 is clamped to 100', () => {
    const mgr = new ConfigurationManager(mockSource({ sampleIntervalMs: 99 }));
    expect(mgr.getConfig().sampleIntervalMs).toBe(100);
  });

  it('sampleIntervalMs=0 is clamped to 100', () => {
    const mgr = new ConfigurationManager(mockSource({ sampleIntervalMs: 0 }));
    expect(mgr.getConfig().sampleIntervalMs).toBe(100);
  });
});

describe('ConfigurationManager – custom values', () => {
  it('reads custom ramAlertThresholdMb', () => {
    const mgr = new ConfigurationManager(mockSource({ ramAlertThresholdMb: 1024 }));
    expect(mgr.getConfig().ramAlertThresholdMb).toBe(1024);
  });

  it('reads custom cpuAlertThresholdPercent', () => {
    const mgr = new ConfigurationManager(mockSource({ cpuAlertThresholdPercent: 95 }));
    expect(mgr.getConfig().cpuAlertThresholdPercent).toBe(95);
  });

  it('reads custom sampleIntervalMs above minimum', () => {
    const mgr = new ConfigurationManager(mockSource({ sampleIntervalMs: 500 }));
    expect(mgr.getConfig().sampleIntervalMs).toBe(500);
  });
});

describe('ConfigurationManager – runtimePaths', () => {
  it('reads runtimePaths.node', () => {
    const mgr = new ConfigurationManager(mockSource({ 'runtimePaths.node': '/usr/local/bin/node' }));
    expect(mgr.getConfig().runtimePaths.node).toBe('/usr/local/bin/node');
  });

  it('reads runtimePaths.python', () => {
    const mgr = new ConfigurationManager(mockSource({ 'runtimePaths.python': '/usr/bin/python3' }));
    expect(mgr.getConfig().runtimePaths.python).toBe('/usr/bin/python3');
  });

  it('runtimePaths default to undefined', () => {
    const mgr = new ConfigurationManager(mockSource());
    expect(mgr.getConfig().runtimePaths.node).toBeUndefined();
    expect(mgr.getConfig().runtimePaths.python).toBeUndefined();
  });
});
