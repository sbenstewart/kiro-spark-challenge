import { describe, it, expect } from 'vitest';
import { EnergyEstimator } from '../energyEstimator';

// Formula: energyMwh = (tdpWatts * avgCpuPercent/100 * executionTimeMs) / 3_600_000 * 1000

describe('EnergyEstimator', () => {
  describe('estimate() with known TDP override', () => {
    it('calculates correct mWh for 15W TDP, 50% CPU, 1000ms', () => {
      // (15 * 0.5 * 1000) / 3_600_000 * 1000 = 7500 / 3_600_000 * 1000 ≈ 0.002083...
      const estimator = new (EnergyEstimator as any)(15);
      const result = estimator.estimate(50, 1000, 15);
      const expected = (15 * (50 / 100) * 1000) / 3_600_000 * 1000;
      expect(result).toBeCloseTo(expected, 10);
    });

    it('returns 0 mWh when CPU is 0%', () => {
      const estimator = new (EnergyEstimator as any)(15);
      expect(estimator.estimate(0, 1000, 15)).toBe(0);
    });

    it('calculates correctly at 100% CPU', () => {
      const estimator = new (EnergyEstimator as any)(65);
      const expected = (65 * 1.0 * 5000) / 3_600_000 * 1000;
      expect(estimator.estimate(100, 5000, 65)).toBeCloseTo(expected, 10);
    });

    it('uses custom tdpWatts override instead of system TDP', () => {
      const estimator = new (EnergyEstimator as any)(15);
      const withOverride = estimator.estimate(50, 1000, 45);
      const expected = (45 * 0.5 * 1000) / 3_600_000 * 1000;
      expect(withOverride).toBeCloseTo(expected, 10);
    });
  });

  describe('estimate() using system TDP (no override)', () => {
    it('uses the cached system TDP when no override is passed', () => {
      const estimator = new (EnergyEstimator as any)(30);
      const result = estimator.estimate(50, 2000);
      const expected = (30 * 0.5 * 2000) / 3_600_000 * 1000;
      expect(result).toBeCloseTo(expected, 10);
    });
  });

  describe('EnergyEstimator.create() factory', () => {
    it('falls back to 15W when systeminformation has no TDP field', async () => {
      // systeminformation's cpu() doesn't expose a 'tdp' field in practice,
      // so create() always falls back to 15W in test environments.
      const estimator = await EnergyEstimator.create();
      // With 15W fallback: (15 * 0.5 * 1000) / 3_600_000 * 1000
      const expected = (15 * 0.5 * 1000) / 3_600_000 * 1000;
      expect(estimator.estimate(50, 1000)).toBeCloseTo(expected, 10);
    });

    it('returns an EnergyEstimator instance', async () => {
      const estimator = await EnergyEstimator.create();
      expect(estimator).toBeInstanceOf(EnergyEstimator);
    });

    it('produces a valid energy estimate after creation', async () => {
      const estimator = await EnergyEstimator.create();
      const result = estimator.estimate(50, 1000);
      // With any TDP >= 15W, result should be > 0
      expect(result).toBeGreaterThan(0);
    });
  });
});
