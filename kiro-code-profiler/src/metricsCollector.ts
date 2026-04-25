import { MetricSample, MetricsSummary } from './types';

type PidusageResult = { memory: number; cpu: number };
type PidusageFn = (pid: number) => Promise<PidusageResult>;

let pidusagePromise: Promise<PidusageFn> | null = null;
let systemInformationPromise: Promise<typeof import('systeminformation')> | null = null;

async function getPidusage(): Promise<PidusageFn> {
  if (!pidusagePromise) {
    pidusagePromise = import('pidusage').then((mod) => {
      const resolved = (mod as unknown as { default?: PidusageFn }).default ?? (mod as unknown as PidusageFn);
      return resolved;
    });
  }
  return pidusagePromise;
}

async function getSystemInformation(): Promise<typeof import('systeminformation')> {
  if (!systemInformationPromise) {
    systemInformationPromise = import('systeminformation');
  }
  return systemInformationPromise;
}

export function aggregateSamples(
  samples: MetricSample[],
  executionTimeMs: number,
  energyMwh: number
): MetricsSummary {
  const n = samples.length;

  const peakRamMb = n === 0 ? 0 : Math.max(...samples.map(s => s.ramMb));
  const avgRamMb = n === 0 ? 0 : samples.reduce((sum, s) => sum + s.ramMb, 0) / n;
  const avgCpuPercent = n === 0 ? 0 : samples.reduce((sum, s) => sum + s.cpuPercent, 0) / n;

  const totalDiskReadBytes = samples.reduce((sum, s) => sum + s.diskReadBytes, 0);
  const totalDiskWriteBytes = samples.reduce((sum, s) => sum + s.diskWriteBytes, 0);
  const totalNetworkBytesSent = samples.reduce((sum, s) => sum + s.networkBytesSent, 0);
  const totalNetworkBytesReceived = samples.reduce((sum, s) => sum + s.networkBytesReceived, 0);
  const totalFsOpen = samples.reduce((sum, s) => sum + s.fsOpen, 0);
  const totalFsRead = samples.reduce((sum, s) => sum + s.fsRead, 0);
  const totalFsWrite = samples.reduce((sum, s) => sum + s.fsWrite, 0);
  const totalFsClose = samples.reduce((sum, s) => sum + s.fsClose, 0);

  return {
    peakRamMb,
    avgRamMb,
    avgCpuPercent,
    totalDiskReadBytes,
    totalDiskWriteBytes,
    totalNetworkBytesSent,
    totalNetworkBytesReceived,
    totalFsOpen,
    totalFsRead,
    totalFsWrite,
    totalFsClose,
    executionTimeMs,
    energyMwh,
    samples,
    sampleCount: n,
    dataStatus: n >= 2 ? 'ok' : n === 1 ? 'partial' : 'empty',
  };
}

// Network and disk I/O stats are expensive OS calls (~100ms on macOS).
// We refresh them at most once every 2s regardless of the sample interval.
const IO_REFRESH_MS = 2000;

export class MetricsCollector {
  private samples: MetricSample[] = [];
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastError: string | null = null;
  private pollInFlight = false;

  private prevDiskRIO = 0;
  private prevDiskWIO = 0;
  private prevNetRx = 0;
  private prevNetTx = 0;

  // Cached I/O deltas — reused on ticks that fall within IO_REFRESH_MS
  private lastIoRefreshAt = 0;
  private cachedDiskRead = 0;
  private cachedDiskWrite = 0;
  private cachedNetSent = 0;
  private cachedNetRecv = 0;

  start(pid: number, intervalMs: number): void {
    this.samples = [];
    this.intervalHandle = null;
    this.prevDiskRIO = 0;
    this.prevDiskWIO = 0;
    this.prevNetRx = 0;
    this.prevNetTx = 0;
    this.lastIoRefreshAt = 0;
    this.cachedDiskRead = 0;
    this.cachedDiskWrite = 0;
    this.cachedNetSent = 0;
    this.cachedNetRecv = 0;
    this.lastError = null;
    this.pollInFlight = false;

    this.intervalHandle = setInterval(async () => {
      if (this.pollInFlight) {
        return;
      }

      this.pollInFlight = true;
      try {
        const now = Date.now();
        const needsIoRefresh = (now - this.lastIoRefreshAt) >= IO_REFRESH_MS;
        const pidusage = await getPidusage();

        // pidusage is cheap (reads /proc or similar) — always fetch it
        const usagePromise = pidusage(pid);

        // Only call the expensive systeminformation APIs when the cache is stale
        const ioPromise = needsIoRefresh
          ? getSystemInformation().then((si) => Promise.all([si.networkStats(), si.disksIO()]))
          : Promise.resolve(null);

        const [usage, ioResult] = await Promise.all([usagePromise, ioPromise]);

        if (ioResult) {
          const [netStats, diskIO] = ioResult;
          const totalRx = netStats.reduce((sum: number, iface) => sum + (iface.rx_bytes ?? 0), 0);
          const totalTx = netStats.reduce((sum: number, iface) => sum + (iface.tx_bytes ?? 0), 0);
          this.cachedNetRecv = Math.max(0, totalRx - this.prevNetRx);
          this.cachedNetSent = Math.max(0, totalTx - this.prevNetTx);
          this.prevNetRx = totalRx;
          this.prevNetTx = totalTx;

          const curRIO = diskIO?.rIO ?? 0;
          const curWIO = diskIO?.wIO ?? 0;
          this.cachedDiskRead = Math.max(0, curRIO - this.prevDiskRIO);
          this.cachedDiskWrite = Math.max(0, curWIO - this.prevDiskWIO);
          this.prevDiskRIO = curRIO;
          this.prevDiskWIO = curWIO;
          this.lastIoRefreshAt = now;
        }

        const sample: MetricSample = {
          timestamp: now,
          ramMb: usage.memory / (1024 * 1024),
          cpuPercent: usage.cpu,
          diskReadBytes: this.cachedDiskRead,
          diskWriteBytes: this.cachedDiskWrite,
          networkBytesSent: this.cachedNetSent,
          networkBytesReceived: this.cachedNetRecv,
          fsOpen: 0,
          fsRead: 0,
          fsWrite: 0,
          fsClose: 0,
        };

        this.samples.push(sample);
      } catch (err: unknown) {
        this.lastError = err instanceof Error ? err.message : 'Metric collection stopped unexpectedly.';
        // Process likely exited — stop polling gracefully
        this.clearInterval();
      } finally {
        this.pollInFlight = false;
      }
    }, intervalMs);
  }

  stop(): MetricsSummary {
    this.clearInterval();

    const n = this.samples.length;
    const executionTimeMs =
      n >= 2 ? this.samples[n - 1].timestamp - this.samples[0].timestamp : 0;

    const summary = aggregateSamples(this.samples, executionTimeMs, 0);

    if (this.lastError) {
      summary.dataStatus = n > 0 ? 'partial' : 'error';
      summary.dataWarning = `Metric collection stopped early: ${this.lastError}`;
      return summary;
    }

    if (n === 1) {
      summary.dataWarning = 'Only 1 sample was collected. Run a longer script or lower the sampling interval.';
    } else if (n === 0) {
      summary.dataWarning = 'No samples were collected. The script may have finished before the sampler fired.';
    }

    return summary;
  }

  getSamples(): MetricSample[] {
    return this.samples;
  }

  private clearInterval(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
