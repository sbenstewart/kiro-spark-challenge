import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";

const execFileAsync = promisify(execFile);

export interface FunctionContext {
  name: string;
  lineno: number;
  end_lineno?: number;
  args: string[];
  decorators: string[];
  docstring?: string;
  source?: string;
  complexity: number;
  calls: string[];
}

export interface ClassContext {
  name: string;
  lineno: number;
  end_lineno?: number;
  bases: string[];
  methods: Array<{
    name: string;
    lineno: number;
    args: string[];
  }>;
  docstring?: string;
  source?: string;
}

export interface EnergyHotspot {
  type: string;
  name: string;
  lineno: number;
  complexity: number;
  loop_depth: number;
  reason: string;
}

export interface FileStructure {
  imports: string[];
  functions: Array<{
    name: string;
    lineno: number;
    args: string[];
  }>;
  classes: Array<{
    name: string;
    lineno: number;
    methods: string[];
  }>;
}

export class EcoSpecContext {
  private pythonPath: string;
  private scriptPath: string;

  constructor() {
    this.pythonPath = "python3";

    // Path to context analysis script
    const extensionRoot = path.join(__dirname, "..");
    const sparkChallengeRoot = path.join(extensionRoot, "..");
    const workspaceRoot = path.join(sparkChallengeRoot, "..");
    this.scriptPath = path.join(workspaceRoot, "ecospec_context_cli.py");
  }

  async findEnergyHotspots(filePath: string): Promise<EnergyHotspot[]> {
    try {
      const result = await this.callTool("find_energy_hotspots", {
        file_path: this.getRelativePath(filePath),
      });

      if (result.error) {
        console.error("Hotspot detection failed:", result.error);
        return [];
      }

      return result.hotspots || [];
    } catch (error) {
      console.error("Failed to find energy hotspots:", error);
      return [];
    }
  }

  async getFunctionContext(
    filePath: string,
    functionName: string,
  ): Promise<FunctionContext | null> {
    try {
      const result = await this.callTool("get_function_context", {
        file_path: this.getRelativePath(filePath),
        function_name: functionName,
      });

      if (result.error) {
        return null;
      }

      return result as FunctionContext;
    } catch (error) {
      console.error("Failed to get function context:", error);
      return null;
    }
  }

  async getClassContext(
    filePath: string,
    className: string,
  ): Promise<ClassContext | null> {
    try {
      const result = await this.callTool("get_class_context", {
        file_path: this.getRelativePath(filePath),
        class_name: className,
      });

      if (result.error) {
        return null;
      }

      return result as ClassContext;
    } catch (error) {
      console.error("Failed to get class context:", error);
      return null;
    }
  }

  async analyzeFileStructure(filePath: string): Promise<FileStructure | null> {
    try {
      const result = await this.callTool("analyze_file_structure", {
        file_path: this.getRelativePath(filePath),
      });

      if (result.error) {
        return null;
      }

      return result as FileStructure;
    } catch (error) {
      console.error("Failed to analyze file structure:", error);
      return null;
    }
  }

  async getCallers(
    filePath: string,
    functionName: string,
  ): Promise<Array<{ name: string; file: string; lineno: number }>> {
    try {
      const result = await this.callTool("get_callers", {
        file_path: this.getRelativePath(filePath),
        function_name: functionName,
      });

      if (result.error) {
        return [];
      }

      return result.callers || [];
    } catch (error) {
      console.error("Failed to get callers:", error);
      return [];
    }
  }

  private async callTool(
    toolName: string,
    args: Record<string, any>,
  ): Promise<any> {
    const { stdout, stderr } = await execFileAsync(
      this.pythonPath,
      [this.scriptPath, toolName, JSON.stringify(args)],
      {
        timeout: 10000, // 10 second timeout
        maxBuffer: 5 * 1024 * 1024, // 5MB buffer
      },
    );

    if (stderr && stderr.trim().length > 0) {
      console.warn("EcoSpec Context stderr:", stderr);
    }

    return JSON.parse(stdout.trim());
  }

  private getRelativePath(absolutePath: string): string {
    // Convert absolute path to relative path from workspace root
    // This is a simplified version - you may need to adjust based on your setup
    const parts = absolutePath.split(path.sep);
    const workspaceIndex = parts.findIndex((p) => p === "kiro_hackathon");
    if (workspaceIndex >= 0) {
      return parts.slice(workspaceIndex + 1).join(path.sep);
    }
    return absolutePath;
  }
}
