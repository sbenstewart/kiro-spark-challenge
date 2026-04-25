import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";

const execFileAsync = promisify(execFile);

export interface EcoSpecPrediction {
  energy_wh: number;
  confidence: number;
  complexity_label: string;
  top_driver: string;
  warning_level: "low" | "medium" | "high";
  error?: string;
}

export class EcoSpecPredictor {
  private pythonPath: string;
  private scriptPath: string;

  constructor() {
    // Path to Python executable
    this.pythonPath = "python3";

    // Path to the prediction script
    // __dirname when compiled will be kiro-code-profiler/out/
    // Go up to kiro-code-profiler/, then kiro-spark-challenge/, then workspace root
    const extensionRoot = path.join(__dirname, "..");
    const sparkChallengeRoot = path.join(extensionRoot, "..");
    const workspaceRoot = path.join(sparkChallengeRoot, "..");
    this.scriptPath = path.join(workspaceRoot, "ecospec_cli.py");
  }

  async predict(code: string): Promise<EcoSpecPrediction> {
    let tempFile: string | null = null;
    try {
      // Write code to temp file (execFile doesn't support stdin)
      tempFile = path.join(tmpdir(), `ecospec-${Date.now()}.py`);
      await writeFile(tempFile, code, "utf-8");

      // Call Python script with temp file as argument
      const { stdout, stderr } = await execFileAsync(
        this.pythonPath,
        [this.scriptPath, tempFile],
        {
          timeout: 5000, // 5 second timeout
          maxBuffer: 1024 * 1024, // 1MB buffer
        },
      );

      if (stderr && stderr.trim().length > 0) {
        console.warn("EcoSpec stderr:", stderr);
      }

      // Parse JSON output
      const result = JSON.parse(stdout.trim());

      // Validate result structure
      if (result.error) {
        return {
          energy_wh: 0,
          confidence: 0,
          complexity_label: "unknown",
          top_driver: "unknown",
          warning_level: "low",
          error: result.error,
        };
      }

      return result as EcoSpecPrediction;
    } catch (error: any) {
      console.error("EcoSpec prediction failed:", error);
      return {
        energy_wh: 0,
        confidence: 0,
        complexity_label: "unknown",
        top_driver: "unknown",
        warning_level: "low",
        error: error.message || "Prediction failed",
      };
    } finally {
      // Clean up temp file
      if (tempFile) {
        try {
          await unlink(tempFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}
