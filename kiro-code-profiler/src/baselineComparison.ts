import { ProfileSession, BaselineComparison } from './types';

function percentageDelta(baseline: number, current: number): number {
  if (baseline === 0) return 0;
  return Math.round(((current - baseline) / baseline) * 100 * 100) / 100;
}

export function computeBaselineComparison(
  baselineSession: ProfileSession,
  currentSession: ProfileSession
): BaselineComparison {
  const bm = baselineSession.metrics;
  const cm = currentSession.metrics;

  return {
    baselineSessionId: baselineSession.id,
    currentSessionId: currentSession.id,
    deltas: {
      ramMb: percentageDelta(bm.peakRamMb, cm.peakRamMb),
      cpuPercent: percentageDelta(bm.avgCpuPercent, cm.avgCpuPercent),
      energyMwh: percentageDelta(bm.energyMwh, cm.energyMwh),
      executionTimeMs: percentageDelta(bm.executionTimeMs, cm.executionTimeMs),
      diskReadBytes: percentageDelta(bm.totalDiskReadBytes, cm.totalDiskReadBytes),
      diskWriteBytes: percentageDelta(bm.totalDiskWriteBytes, cm.totalDiskWriteBytes),
    },
  };
}
