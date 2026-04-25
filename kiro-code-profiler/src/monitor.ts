import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { aggregateSamples } from './metricsCollector';
import {
  RunRequest,
  MonitorConfig,
  MetricSample,
  MetricAlert,
  ProfileSession,
} from './types';
import { buildRuntimeCommand } from './runtimeCommandResolver';

/**
 * Pure function: checks a sample against thresholds and returns any alerts to emit.
 * Exported for direct testing without running real processes.
 */
export function checkThresholds(
  sample: MetricSample,
  config: MonitorConfig
): MetricAlert[] {
  const alerts: MetricAlert[] = [];

  if (sample.ramMb > config.ramAlertThresholdMb) {
    alerts.push({
      type: 'ram',
      value: sample.ramMb,
      threshold: config.ramAlertThresholdMb,
      timestamp: sample.timestamp,
    });
  }

  if (sample.cpuPercent > config.cpuAlertThresholdPercent) {
    alerts.push({
      type: 'cpu',
      value: sample.cpuPercent,
      threshold: config.cpuAlertThresholdPercent,
      timestamp: sample.timestamp,
    });
  }

  return alerts;
}

export class Monitor extends EventEmitter {
  private pid: number | null = null;
  private config: MonitorConfig | null = null;
  private samples: MetricSample[] = [];
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private sessionFilePath = '';
  private sessionLanguage: ProfileSession['language'] = 'javascript';

  attach(
    pid: number,
    config: MonitorConfig,
    metadata?: { filePath: string; language: ProfileSession['language'] }
  ): void {
    this.pid = pid;
    this.config = config;
    this.samples = [];
    this.sessionFilePath = metadata?.filePath ?? `PID ${pid}`;
    this.sessionLanguage = metadata?.language ?? 'javascript';
    this._startPolling();
  }

  async launch(request: RunRequest, config: MonitorConfig): Promise<number> {
    const { cmd, args } = this._buildCommand(request);
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    if (!child.pid) {
      throw new Error(`Failed to spawn process for ${request.filePath}`);
    }

    this.attach(child.pid, config, {
      filePath: request.filePath,
      language: request.language,
    });
    return child.pid;
  }

  async stop(): Promise<ProfileSession> {
    this._stopPolling();

    const samples = this.samples;
    const n = samples.length;
    const startTime = n > 0 ? samples[0].timestamp : Date.now();
    const endTime = n > 0 ? samples[n - 1].timestamp : Date.now();
    const executionTimeMs = endTime - startTime;

    const metrics = aggregateSamples(samples, executionTimeMs, 0);

    const session: ProfileSession = {
      id: uuidv4(),
      workspacePath: '',
      filePath: this.sessionFilePath,
      language: this.sessionLanguage,
      sessionType: 'monitor',
      startTime,
      endTime,
      exitCode: 0,
      stdout: '',
      stderr: '',
      metrics,
      isBaseline: false,
      optimizationSuggestions: [],
    };

    if (n === 1) {
      session.metrics.dataWarning = 'Only 1 monitor sample was collected before monitoring stopped.';
    } else if (n === 0) {
      session.metrics.dataWarning = 'No monitor samples were collected before monitoring stopped.';
    }

    return session;
  }

  private _startPolling(): void {
    if (!this.config || this.pid === null) return;

    const config = this.config;
    const pid = this.pid;

    this.intervalHandle = setInterval(async () => {
      try {
        // Dynamically import pidusage to allow mocking in tests
        const pidusage = (await import('pidusage')).default;
        const usage = await pidusage(pid);

        const sample: MetricSample = {
          timestamp: Date.now(),
          ramMb: usage.memory / (1024 * 1024),
          cpuPercent: usage.cpu,
          diskReadBytes: 0,
          diskWriteBytes: 0,
          networkBytesSent: 0,
          networkBytesReceived: 0,
          fsOpen: 0,
          fsRead: 0,
          fsWrite: 0,
          fsClose: 0,
        };

        this.samples.push(sample);
        this.emit('sample', sample);

        const alerts = checkThresholds(sample, config);
        for (const alert of alerts) {
          this.emit('alert', alert);
        }
      } catch {
        // Process likely exited — stop polling gracefully
        this._stopPolling();
      }
    }, config.sampleIntervalMs);
  }

  private _stopPolling(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private _buildCommand(request: RunRequest): { cmd: string; args: string[] } {
    return buildRuntimeCommand(request.language, request.filePath, request.runtimePath);
  }
}
