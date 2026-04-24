import { v4 as uuidv4 } from 'uuid';
import { OptimizationSuggestion, ProfileSession } from './types';

export interface OptimizerThresholds {
  ramThresholdMb?: number;
  cpuThresholdPercent?: number;
  energyThresholdMwh?: number;
  executionTimeThresholdMs?: number;
}

const DEFAULTS: Required<OptimizerThresholds> = {
  ramThresholdMb: 512,
  cpuThresholdPercent: 80,
  energyThresholdMwh: 1.0,
  executionTimeThresholdMs: 5000,
};

export class Optimizer {
  private thresholds: Required<OptimizerThresholds>;

  constructor(thresholds: OptimizerThresholds = {}) {
    this.thresholds = { ...DEFAULTS, ...thresholds };
  }

  async suggest(session: ProfileSession, _sourceCode: string): Promise<OptimizationSuggestion[]> {
    try {
      const suggestions: OptimizationSuggestion[] = [];
      const { metrics } = session;

      if (metrics.peakRamMb > this.thresholds.ramThresholdMb) {
        suggestions.push({
          id: uuidv4(),
          title: 'Reduce memory usage',
          explanation:
            `Peak RAM usage of ${metrics.peakRamMb.toFixed(1)} MB exceeds the threshold of ` +
            `${this.thresholds.ramThresholdMb} MB. Consider releasing object references earlier, ` +
            `using streaming APIs instead of loading data into memory, or reducing data structure sizes.`,
          estimatedImpact: Math.min(
            1,
            (metrics.peakRamMb - this.thresholds.ramThresholdMb) / this.thresholds.ramThresholdMb
          ),
          affectedMetric: 'ram',
          diff: '',
        });
      }

      if (metrics.avgCpuPercent > this.thresholds.cpuThresholdPercent) {
        suggestions.push({
          id: uuidv4(),
          title: 'Optimize CPU-intensive operations',
          explanation:
            `Average CPU usage of ${metrics.avgCpuPercent.toFixed(1)}% exceeds the threshold of ` +
            `${this.thresholds.cpuThresholdPercent}%. Consider offloading work to worker threads, ` +
            `caching expensive computations, or using more efficient algorithms.`,
          estimatedImpact: Math.min(
            1,
            (metrics.avgCpuPercent - this.thresholds.cpuThresholdPercent) /
              this.thresholds.cpuThresholdPercent
          ),
          affectedMetric: 'cpu',
          diff: '',
        });
      }

      if (metrics.energyMwh > this.thresholds.energyThresholdMwh) {
        suggestions.push({
          id: uuidv4(),
          title: 'Reduce energy consumption',
          explanation:
            `Energy consumption of ${metrics.energyMwh.toFixed(3)} mWh exceeds the threshold of ` +
            `${this.thresholds.energyThresholdMwh} mWh. Reducing CPU usage and execution time will ` +
            `directly lower energy consumption.`,
          estimatedImpact: Math.min(
            1,
            (metrics.energyMwh - this.thresholds.energyThresholdMwh) /
              this.thresholds.energyThresholdMwh
          ),
          affectedMetric: 'energy',
          diff: '',
        });
      }

      if (metrics.executionTimeMs > this.thresholds.executionTimeThresholdMs) {
        suggestions.push({
          id: uuidv4(),
          title: 'Improve execution performance',
          explanation:
            `Execution time of ${metrics.executionTimeMs} ms exceeds the threshold of ` +
            `${this.thresholds.executionTimeThresholdMs} ms. Profile hot paths, reduce I/O blocking, ` +
            `and consider parallelizing independent operations.`,
          estimatedImpact: Math.min(
            1,
            (metrics.executionTimeMs - this.thresholds.executionTimeThresholdMs) /
              this.thresholds.executionTimeThresholdMs
          ),
          affectedMetric: 'cpu',
          diff: '',
        });
      }

      suggestions.sort((a, b) => b.estimatedImpact - a.estimatedImpact);
      return suggestions;
    } catch {
      return [];
    }
  }
}
