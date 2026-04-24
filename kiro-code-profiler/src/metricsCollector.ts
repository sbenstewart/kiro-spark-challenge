import pidusage from 'pidusage';
import * as si from 'systeminformation';
import { MetricSample, MetricsSummary } from './types';

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
  };
}

export class MetricsCollector {
  private samples: MetricSample[] = [];
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  // Cumulative counters from previous poll for delta computation
  private prevDiskRIO = 0;
  private prevDiskWIO = 0;
  private prevNetRx = 0;
  private prevNetTx = 0;

  start(pid: number, intervalMs: number): void {
    this.samples = [];
    this.intervalHandle = null;
    this.prevDiskRIO = 0;
    this.prevDiskWIO = 0;
    this.prevNetRx = 0;
    this.prevNetTx = 0;

    this.intervalHandle = setInterval(async () => {
      try {
        const [usage, netStats, diskIO] = await Promise.all([
          pidusage(pid),
          si.networkStats(),
          si.disksIO(),
        ]);

        const ramMb = usage.memory / (1024 * 1024);
        const cpuPercent = usage.cpu;

        // Network deltas
        const totalRx = netStats.reduce((sum, iface) => sum + (iface.rx_bytes ?? 0), 0);
        const totalTx = netStats.reduce((sum, iface) => sum + (iface.tx_bytes ?? 0), 0);
        const networkBytesReceived = Math.max(0, totalRx - this.prevNetRx);
        const networkBytesSent = Math.max(0, totalTx - this.prevNetTx);
        this.prevNetRx = totalRx;
        this.prevNetTx = totalTx;

        // Disk I/O deltas
        const curRIO = diskIO?.rIO ?? 0;
        const curWIO = diskIO?.wIO ?? 0;
        const diskReadBytes = Math.max(0, curRIO - this.prevDiskRIO);
        const diskWriteBytes = Math.max(0, curWIO - this.prevDiskWIO);
        this.prevDiskRIO = curRIO;
        this.prevDiskWIO = curWIO;

        const sample: MetricSample = {
          timestamp: Date.now(),
          ramMb,
          cpuPercent,
          diskReadBytes,
          diskWriteBytes,
          networkBytesSent,
          networkBytesReceived,
          fsOpen: 0,
          fsRead: 0,
          fsWrite: 0,
          fsClose: 0,
        };

        this.samples.push(sample);
      } catch {
        // Process likely exited — stop polling gracefully
        this.clearInterval();
      }
    }, intervalMs);
  }

  stop(): MetricsSummary {
    this.clearInterval();

    const n = this.samples.length;
    const executionTimeMs =
      n >= 2 ? this.samples[n - 1].timestamp - this.samples[0].timestamp : 0;

    return aggregateSamples(this.samples, executionTimeMs, 0);
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
