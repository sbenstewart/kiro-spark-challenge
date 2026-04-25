import { v4 as uuidv4 } from "uuid";
import { OptimizationSuggestion, ProfileSession } from "./types";
import { EcoSpecPrediction } from "./ecospecPredictor";
import { EnergyHotspot } from "./ecospecContext";

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

  async suggest(
    session: ProfileSession,
    _sourceCode: string,
    mlPrediction?: EcoSpecPrediction | null,
    hotspots?: EnergyHotspot[],
  ): Promise<OptimizationSuggestion[]> {
    try {
      const suggestions: OptimizationSuggestion[] = [];
      const { metrics } = session;

      // Add ML-based suggestion if available
      if (
        mlPrediction &&
        !mlPrediction.error &&
        mlPrediction.warning_level !== "low"
      ) {
        suggestions.push({
          id: uuidv4(),
          title: `ML Analysis: ${mlPrediction.complexity_label} complexity detected`,
          explanation:
            `EcoSpec ML model predicts ${mlPrediction.energy_wh.toExponential(2)} Wh energy consumption ` +
            `(${mlPrediction.warning_level} risk, ${(mlPrediction.confidence * 100).toFixed(0)}% confidence). ` +
            `Primary driver: ${mlPrediction.top_driver}. Consider optimizing ${mlPrediction.complexity_label} ` +
            `algorithms to reduce energy consumption.`,
          estimatedImpact: mlPrediction.warning_level === "high" ? 0.8 : 0.5,
          affectedMetric: "energy",
          diff: "",
        });
      }

      // Add hotspot-based suggestions
      if (hotspots && hotspots.length > 0) {
        for (const hotspot of hotspots.slice(0, 3)) {
          // Top 3 hotspots
          suggestions.push({
            id: uuidv4(),
            title: `Code Hotspot: ${hotspot.name} (line ${hotspot.lineno})`,
            explanation:
              `Function has ${hotspot.reason}. ` +
              `This indicates potential for optimization. Consider: ` +
              `${hotspot.loop_depth > 2 ? "reducing loop nesting depth, " : ""}` +
              `${hotspot.complexity > 10 ? "simplifying control flow, " : ""}` +
              `caching repeated calculations, or using more efficient algorithms.`,
            estimatedImpact: Math.min(
              1,
              (hotspot.complexity / 20 + hotspot.loop_depth / 5) / 2,
            ),
            affectedMetric: "energy",
            diff: "",
          });
        }
      }

      if (metrics.peakRamMb > this.thresholds.ramThresholdMb) {
        suggestions.push({
          id: uuidv4(),
          title: "Reduce memory usage",
          explanation:
            `Peak RAM usage of ${metrics.peakRamMb.toFixed(1)} MB exceeds the threshold of ` +
            `${this.thresholds.ramThresholdMb} MB. Consider releasing object references earlier, ` +
            `using streaming APIs instead of loading data into memory, or reducing data structure sizes.`,
          estimatedImpact: Math.min(
            1,
            (metrics.peakRamMb - this.thresholds.ramThresholdMb) /
              this.thresholds.ramThresholdMb,
          ),
          affectedMetric: "ram",
          diff: "",
        });
      }

      if (metrics.avgCpuPercent > this.thresholds.cpuThresholdPercent) {
        suggestions.push({
          id: uuidv4(),
          title: "Optimize CPU-intensive operations",
          explanation:
            `Average CPU usage of ${metrics.avgCpuPercent.toFixed(1)}% exceeds the threshold of ` +
            `${this.thresholds.cpuThresholdPercent}%. Consider offloading work to worker threads, ` +
            `caching expensive computations, or using more efficient algorithms.`,
          estimatedImpact: Math.min(
            1,
            (metrics.avgCpuPercent - this.thresholds.cpuThresholdPercent) /
              this.thresholds.cpuThresholdPercent,
          ),
          affectedMetric: "cpu",
          diff: "",
        });
      }

      if (metrics.energyMwh > this.thresholds.energyThresholdMwh) {
        suggestions.push({
          id: uuidv4(),
          title: "Reduce energy consumption",
          explanation:
            `Energy consumption of ${metrics.energyMwh.toFixed(3)} mWh exceeds the threshold of ` +
            `${this.thresholds.energyThresholdMwh} mWh. Reducing CPU usage and execution time will ` +
            `directly lower energy consumption.`,
          estimatedImpact: Math.min(
            1,
            (metrics.energyMwh - this.thresholds.energyThresholdMwh) /
              this.thresholds.energyThresholdMwh,
          ),
          affectedMetric: "energy",
          diff: "",
        });
      }

      if (metrics.executionTimeMs > this.thresholds.executionTimeThresholdMs) {
        suggestions.push({
          id: uuidv4(),
          title: "Improve execution performance",
          explanation:
            `Execution time of ${metrics.executionTimeMs} ms exceeds the threshold of ` +
            `${this.thresholds.executionTimeThresholdMs} ms. Profile hot paths, reduce I/O blocking, ` +
            `and consider parallelizing independent operations.`,
          estimatedImpact: Math.min(
            1,
            (metrics.executionTimeMs -
              this.thresholds.executionTimeThresholdMs) /
              this.thresholds.executionTimeThresholdMs,
          ),
          affectedMetric: "cpu",
          diff: "",
        });
      }

      suggestions.sort((a, b) => b.estimatedImpact - a.estimatedImpact);
      return suggestions;
    } catch {
      return [];
    }
  }
}
