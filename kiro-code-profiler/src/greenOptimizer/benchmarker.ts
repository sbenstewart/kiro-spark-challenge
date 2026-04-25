import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEFAULT_TDP_WATTS = 15;
const CARBON_INTENSITY_GLOBAL = 490; // gCO2/kWh

export interface BenchmarkResult {
  executionTimeMs: number;
  energyMwh: number;
  energyJoules: number;
}

export interface ComparisonResult {
  before: BenchmarkResult;
  after: BenchmarkResult;
  savedTimeMs: number;
  savedEnergyMwh: number;
  savedEnergyJoules: number;
  savedCo2Grams: number;
  savingsPercent: number;
}

/**
 * Benchmarks code snippets by actually running them and measuring
 * real execution time. Uses TDP-based energy estimation from measured time.
 *
 * Formula: energy(mWh) = TDP(W) × avgCPU% × time(ms) / 3,600,000 × 1000
 * For short snippets we assume ~50% CPU utilization during execution.
 */
export class Benchmarker {
  private tdpWatts: number;
  private iterations: number;

  constructor(tdpWatts: number = DEFAULT_TDP_WATTS, iterations: number = 5) {
    this.tdpWatts = tdpWatts;
    this.iterations = iterations;
  }

  /**
   * Benchmark a code snippet by wrapping it in a runnable script,
   * executing it multiple times, and measuring wall-clock time.
   */
  async benchmark(code: string, language: "typescript" | "javascript" = "typescript"): Promise<BenchmarkResult> {
    // Wrap code in a timing harness
    const iterations = 1000; // run the snippet 1000 times for measurable duration
    const harness = this.buildHarness(code, iterations, language);

    const times: number[] = [];
    for (let run = 0; run < this.iterations; run++) {
      const timeMs = await this.runAndMeasure(harness, language);
      if (timeMs >= 0) times.push(timeMs);
    }

    if (times.length === 0) {
      return { executionTimeMs: 0, energyMwh: 0, energyJoules: 0 };
    }

    // Use median to avoid outliers
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];

    // Energy: TDP × estimated CPU% × time
    // For compute-bound snippets, assume ~50% CPU utilization
    const avgCpuPercent = 50;
    const energyMwh = (this.tdpWatts * (avgCpuPercent / 100) * median) / 3_600_000 * 1000;
    const energyJoules = energyMwh * 3.6; // 1 mWh = 3.6 J

    return { executionTimeMs: median, energyMwh, energyJoules };
  }

  /**
   * Compare original vs optimized code by benchmarking both.
   */
  async compare(originalCode: string, optimizedCode: string, language: "typescript" | "javascript" = "typescript"): Promise<ComparisonResult> {
    const before = await this.benchmark(originalCode, language);
    const after = await this.benchmark(optimizedCode, language);

    const savedTimeMs = before.executionTimeMs - after.executionTimeMs;
    const savedEnergyMwh = before.energyMwh - after.energyMwh;
    const savedEnergyJoules = before.energyJoules - after.energyJoules;
    const savedKwh = savedEnergyMwh / 1_000_000; // mWh to kWh
    const savedCo2Grams = savedKwh * CARBON_INTENSITY_GLOBAL;
    const savingsPercent = before.executionTimeMs > 0
      ? ((savedTimeMs / before.executionTimeMs) * 100)
      : 0;

    return { before, after, savedTimeMs, savedEnergyMwh, savedEnergyJoules, savedCo2Grams, savingsPercent };
  }

  private buildHarness(code: string, iterations: number, language: string): string {
    if (language === "typescript" || language === "javascript") {
      return `
// Auto-generated benchmark harness
const __benchStart = process.hrtime.bigint();
for (let __i = 0; __i < ${iterations}; __i++) {
${code}
}
const __benchEnd = process.hrtime.bigint();
const __benchMs = Number(__benchEnd - __benchStart) / 1_000_000;
console.log(JSON.stringify({ timeMs: __benchMs }));
`;
    }
    return code;
  }

  private runAndMeasure(harness: string, language: string): Promise<number> {
    return new Promise((resolve) => {
      const ext = language === "typescript" ? ".ts" : ".js";
      const tmpFile = path.join(os.tmpdir(), `green-bench-${Date.now()}${ext}`);
      fs.writeFileSync(tmpFile, harness, "utf-8");

      const cmd = language === "typescript" ? "npx" : "node";
      const args = language === "typescript" ? ["tsx", tmpFile] : [tmpFile];

      let stdout = "";
      let settled = false;

      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: true });

      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });

      const timer = setTimeout(() => {
        if (!settled) { settled = true; child.kill("SIGKILL"); resolve(-1); }
      }, 30000);

      child.on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { fs.unlinkSync(tmpFile); } catch {}
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result.timeMs || -1);
        } catch {
          resolve(-1);
        }
      });

      child.on("error", () => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(-1); }
      });
    });
  }
}
