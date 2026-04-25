import { ProfilerConfig } from './types';

const DEFAULTS: ProfilerConfig = {
  ramAlertThresholdMb: 512,
  cpuAlertThresholdPercent: 80,
  sampleIntervalMs: 1000,
  runtimePaths: {
    node: undefined,
    python: undefined,
  },
  openaiApiKey: undefined,
};

const MIN_SAMPLE_INTERVAL_MS = 100;

type ConfigSource = {
  get<T>(key: string, defaultValue: T): T;
};

export class ConfigurationManager {
  constructor(private configSource?: ConfigSource) {}

  private getSource(): ConfigSource {
    if (this.configSource) {
      return this.configSource;
    }
    // Lazy-load vscode to allow unit testing without the vscode module
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const vscode = require('vscode');
      return vscode.workspace.getConfiguration('kiro-profiler');
    } catch {
      // vscode not available (e.g. in unit tests without a mock) — return empty source
      return { get: <T>(_key: string, defaultValue: T) => defaultValue };
    }
  }

  getConfig(): ProfilerConfig {
    const src = this.getSource();

    const ramAlertThresholdMb = src.get<number>(
      'ramAlertThresholdMb',
      DEFAULTS.ramAlertThresholdMb
    );

    const cpuAlertThresholdPercent = src.get<number>(
      'cpuAlertThresholdPercent',
      DEFAULTS.cpuAlertThresholdPercent
    );

    let sampleIntervalMs = src.get<number>(
      'sampleIntervalMs',
      DEFAULTS.sampleIntervalMs
    );

    if (sampleIntervalMs < MIN_SAMPLE_INTERVAL_MS) {
      console.warn(
        `[kiro-profiler] sampleIntervalMs value ${sampleIntervalMs} is below the minimum of ` +
          `${MIN_SAMPLE_INTERVAL_MS}ms. Clamping to ${MIN_SAMPLE_INTERVAL_MS}ms.`
      );
      sampleIntervalMs = MIN_SAMPLE_INTERVAL_MS;
    }

    const nodeRuntime = src.get<string | undefined>(
      'runtimePaths.node',
      DEFAULTS.runtimePaths.node
    );

    const pythonRuntime = src.get<string | undefined>(
      'runtimePaths.python',
      DEFAULTS.runtimePaths.python
    );

    const openaiApiKey = src.get<string>('openaiApiKey', '');

    return {
      ramAlertThresholdMb,
      cpuAlertThresholdPercent,
      sampleIntervalMs,
      runtimePaths: {
        node: nodeRuntime,
        python: pythonRuntime,
      },
      openaiApiKey: openaiApiKey || undefined,
    };
  }
}
