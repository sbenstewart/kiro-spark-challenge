const DEFAULT_TDP_WATTS = 15;

export class EnergyEstimator {
  private systemTdpWatts: number;

  private constructor(systemTdpWatts: number) {
    this.systemTdpWatts = systemTdpWatts;
  }

  /**
   * Factory method that pre-fetches system TDP via systeminformation.
   * Falls back to 15W if TDP is unavailable.
   */
  static async create(): Promise<EnergyEstimator> {
    let tdp = DEFAULT_TDP_WATTS;
    try {
      const si = await import('systeminformation');
      const cpuData = await si.cpu();
      // systeminformation doesn't expose TDP directly; use fallback
      const maybeTdp = (cpuData as unknown as Record<string, unknown>)['tdp'];
      if (typeof maybeTdp === 'number' && maybeTdp > 0) {
        tdp = maybeTdp;
      }
    } catch {
      // systeminformation unavailable — use default
    }
    return new EnergyEstimator(tdp);
  }

  /**
   * Estimates energy consumption in milliwatt-hours (mWh).
   *
   * Uses CPU-weighted TDP when CPU data is available, but always applies
   * a minimum idle floor (10% TDP) so energy is never zero for a running process.
   *
   * Formula: energyMwh = (tdpWatts * max(avgCpuPercent, 10)/100 * executionTimeMs) / 3_600_000 * 1000
   *
   * @param avgCpuPercent  Average CPU utilisation (0–100)
   * @param executionTimeMs  Wall-clock execution time in milliseconds
   * @param tdpWatts  Optional TDP override; uses cached system TDP when omitted
   */
  estimate(avgCpuPercent: number, executionTimeMs: number, tdpWatts?: number): number {
    const tdp = tdpWatts !== undefined ? tdpWatts : this.systemTdpWatts;
    // Floor at 10% TDP — a running process always consumes some energy
    const effectiveCpu = Math.max(avgCpuPercent, 10);
    return (tdp * (effectiveCpu / 100) * executionTimeMs) / 3_600_000 * 1000;
  }
}
