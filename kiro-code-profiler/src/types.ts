export interface RunRequest {
  filePath: string;
  language: 'javascript' | 'typescript' | 'python';
  runtimePath?: string;
  selectedCode?: string;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  startTime: number;
  endTime: number;
}

export interface MetricSample {
  timestamp: number;
  ramMb: number;
  cpuPercent: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  networkBytesSent: number;
  networkBytesReceived: number;
  fsOpen: number;
  fsRead: number;
  fsWrite: number;
  fsClose: number;
}

export interface MetricsSummary {
  peakRamMb: number;
  avgRamMb: number;
  totalDiskReadBytes: number;
  totalDiskWriteBytes: number;
  avgCpuPercent: number;
  totalNetworkBytesSent: number;
  totalNetworkBytesReceived: number;
  totalFsOpen: number;
  totalFsRead: number;
  totalFsWrite: number;
  totalFsClose: number;
  gcEvents?: number;
  gcPauseTotalMs?: number;
  executionTimeMs: number;
  energyMwh: number;
  samples: MetricSample[];
}

export interface OptimizationSuggestion {
  id: string;
  title: string;
  explanation: string;
  estimatedImpact: number;
  affectedMetric: 'ram' | 'cpu' | 'energy' | 'disk' | 'network';
  diff: string;
}

export interface ProfileSession {
  id: string;
  workspacePath: string;
  filePath: string;
  language: 'javascript' | 'typescript' | 'python';
  sessionType: 'profile' | 'monitor';
  startTime: number;
  endTime: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  metrics: MetricsSummary;
  isBaseline: boolean;
  optimizationSuggestions: OptimizationSuggestion[];
  linkedPreSessionId?: string;
}

export interface SessionSummary {
  id: string;
  filePath: string;
  sessionType: 'profile' | 'monitor';
  startTime: number;
  endTime: number;
  peakRamMb: number;
  avgCpuPercent: number;
  executionTimeMs: number;
  isBaseline: boolean;
}

export interface BaselineComparison {
  baselineSessionId: string;
  currentSessionId: string;
  deltas: {
    ramMb: number;
    cpuPercent: number;
    energyMwh: number;
    executionTimeMs: number;
    diskReadBytes: number;
    diskWriteBytes: number;
  };
}

export interface MonitorConfig {
  sampleIntervalMs: number;
  ramAlertThresholdMb: number;
  cpuAlertThresholdPercent: number;
}

export interface MetricAlert {
  type: 'ram' | 'cpu';
  value: number;
  threshold: number;
  timestamp: number;
}

export interface ProfilerConfig {
  ramAlertThresholdMb: number;
  cpuAlertThresholdPercent: number;
  sampleIntervalMs: number;
  runtimePaths: {
    node?: string;
    python?: string;
  };
}
