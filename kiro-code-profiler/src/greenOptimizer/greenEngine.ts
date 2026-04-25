import * as fs from "fs";
import * as path from "path";
import { GreenAnalyzer } from "./analyzer";
import { DetectedPattern, GreenSuggestion, EnergyProfile, ImpactSummary } from "./types";

const ENERGY_PER_INSTRUCTION = 1e-9;
const CARBON_INTENSITY_GLOBAL = 490;
const SMARTPHONE_CHARGE_KWH = 0.012;
const CAR_EMISSIONS_G_PER_METER = 0.21;

const REDUCTION_RATIOS: Record<string, number> = {
  "algo-nested-loop-lookup": 0.6,
  "alloc-object-in-loop": 0.4,
  "io-repeated-file-read-in-loop": 0.8,
  "io-console-log-in-loop": 0.3,
  "loop-foreach-with-index": 0.15,
  "loop-push-in-loop": 0.2,
};

export class GreenEngine {
  private analyzer = new GreenAnalyzer();
  private suggestions: GreenSuggestion[] = [];
  private patterns: DetectedPattern[] = [];
  private counter = 0;

  async analyzeWorkspace(rootDir: string): Promise<{ suggestions: GreenSuggestion[]; scannedFiles: number; skippedFiles: number }> {
    const files = this.findSourceFiles(rootDir);
    const result = await this.analyzer.analyze(files);
    this.patterns = result.patterns;

    // Filter out false positives and generate context-aware suggestions
    const filtered = this.filterFalsePositives(result.patterns);
    this.suggestions = filtered.map(p => this.toSuggestion(p));
    this.suggestions.sort((a, b) => (b.estimatedEnergySavings ?? -1) - (a.estimatedEnergySavings ?? -1));
    return { suggestions: this.suggestions, scannedFiles: result.scannedFileCount, skippedFiles: result.skippedFiles.length };
  }

  async acceptSuggestion(id: string): Promise<{ success: boolean; error?: string }> {
    const s = this.suggestions.find(x => x.suggestionId === id);
    if (!s) return { success: false, error: "Suggestion not found" };

    let content: string;
    try { content = fs.readFileSync(s.filePath, "utf-8"); } catch {
      return { success: false, error: "Cannot read file" };
    }

    const idx = content.indexOf(s.originalCode);
    if (idx === -1) {
      return { success: false, error: "Code has changed since analysis — original code not found in file" };
    }

    /* TODO: Hoist this allocation before the loop */
// const newContent = content.substring(0, idx) + s.proposedCode + content.substring(idx + s.originalCode.length);
    try { fs.writeFileSync(s.filePath, newContent, "utf-8"); } catch {
      return { success: false, error: "Cannot write file" };
    }

    s.status = "accepted";
    return { success: true };
  }

  rejectSuggestion(id: string): void {
    const s = this.suggestions.find(x => x.suggestionId === id);
    if (s) s.status = "rejected";
  }

  getImpactSummary(): ImpactSummary {
    const active = this.suggestions.filter(s => s.status !== "rejected");
    const profiles = active.map(s => this.estimateEnergy(s));
    const totalJoules = profiles.reduce((sum, p) => sum + p.savingsJoules, 0);
    const totalKwh = totalJoules / 3_600_000;
    const totalCo2 = totalKwh * CARBON_INTENSITY_GLOBAL;
    return {
      totalPatterns: this.suggestions.length,
      totalEnergySavedJoules: totalJoules,
      totalEnergySavedKwh: totalKwh,
      totalCo2ReductionGrams: totalCo2,
      carbonIntensityFactor: CARBON_INTENSITY_GLOBAL,
      region: "global",
      smartphoneCharges: totalKwh / SMARTPHONE_CHARGE_KWH,
      carMeters: totalCo2 / CAR_EMISSIONS_G_PER_METER,
      acceptedCount: this.suggestions.filter(s => s.status === "accepted").length,
      rejectedCount: this.suggestions.filter(s => s.status === "rejected").length,
      pendingCount: this.suggestions.filter(s => s.status === "pending").length,
    };
  }

  getSuggestions(): GreenSuggestion[] { return this.suggestions; }

  /**
   * Filter out false positives:
   * - fs.readFileSync/readFile with a loop-variable-dependent path is intentional
   * - console.log in for-of loops iterating data is usually intentional
   */
  private filterFalsePositives(patterns: DetectedPattern[]): DetectedPattern[] {
    return patterns.filter(p => {
      if (p.patternId === "io-repeated-file-read-in-loop") {
        // If the read call uses any variable (not a string literal), it's likely reading different files
        const argsMatch = p.originalCode.match(/readFile(?:Sync)?\(([^)]+)\)/);
        if (argsMatch) {
          const args = argsMatch[1];
          // If args contain a variable reference (not just a string literal), skip
          const isConstantPath = /^['"`][^'"`]+['"`]/.test(args.trim());
          if (!isConstantPath) return false; // reading different files — intentional
        }
      }
      if (p.patternId === "io-console-log-in-loop") {
        // Skip console.log that logs iteration data (contains template literals or variables)
        // Only keep if it's a static string in a tight loop
        if (p.originalCode.includes('${') || p.originalCode.includes(' + ')) {
          return false; // logging iteration data — intentional
        }
      }
      return true;
    });
  }

  private toSuggestion(p: DetectedPattern): GreenSuggestion {
    this.counter++;
    const ratio = REDUCTION_RATIOS[p.patternId] ?? null;

    // Read surrounding context for smarter transformations
    const context = this.getFileContext(p.filePath, p.startLine, p.endLine);

    return {
      suggestionId: `green-${this.counter}`,
      patternId: p.patternId,
      filePath: p.filePath,
      startLine: p.startLine,
      endLine: p.endLine,
      originalCode: p.originalCode,
      proposedCode: this.generateProposedCode(p, context),
      estimatedEnergySavings: ratio,
      confidenceLevel: p.confidenceLevel,
      category: p.category,
      description: p.description,
      status: "pending",
    };
  }

  /** Read lines around the pattern for context-aware transformations */
  private getFileContext(filePath: string, startLine: number, endLine: number): string {
    try {
      const lines = fs.readFileSync(filePath, "utf-8").split("\n");
      const from = Math.max(0, startLine - 5);
      const to = Math.min(lines.length, endLine + 5);
      return lines.slice(from, to).join("\n");
    } catch { return ""; }
  }

  private generateProposedCode(p: DetectedPattern, context: string): string {
    switch (p.patternId) {
      case "io-repeated-file-read-in-loop":
        return this.transformFileReadInLoop(p, context);
      case "io-console-log-in-loop":
        return this.transformConsoleInLoop(p, context);
      case "alloc-object-in-loop":
        return this.transformAllocInLoop(p, context);
      case "loop-foreach-with-index":
        return this.transformForEach(p);
      case "loop-push-in-loop":
        return this.transformPushInLoop(p);
      case "algo-nested-loop-lookup":
        return this.transformNestedLoop(p);
      default:
        return p.originalCode;
    }
  }

  /**
   * For fs.readFileSync with a CONSTANT path inside a loop:
   * Replace the call with a variable reference. The user should hoist the read before the loop.
   * We show the full line replacement so it's valid code.
   */
  private transformFileReadInLoop(p: DetectedPattern, _context: string): string {
    // Extract the full call including assignment if present
    const code = p.originalCode;
    // Match: fs.readFileSync(args) or fs.readFile(args)
    const syncMatch = code.match(/(fs\.readFileSync)\(([^)]+)\)/);
    if (syncMatch) {
      const args = syncMatch[2].trim();
      // Return a comment explaining what to do + keep original as commented out
      return `/* TODO: Hoist before loop → const _cached = fs.readFileSync(${args}); */\n// ${code.trim()}  // ⚡ was: redundant read in loop`;
    }
    return `/* TODO: Hoist this I/O operation before the loop */\n// ${code.trim()}`;
  }

  /** Comment out console.log with explanation */
  private transformConsoleInLoop(p: DetectedPattern, _context: string): string {
    return `// ${p.originalCode.trim()}  // ⚡ removed: logging in loop`;
  }

  /** For allocation in loop: comment out with hoisting instruction */
  private transformAllocInLoop(p: DetectedPattern, _context: string): string {
    const match = p.originalCode.match(/(const|let|var)\s+(\w+)\s*=\s*(.*)/s);
    if (match) {
      const keyword = match[1];
      const varName = match[2];
      const value = match[3].trim();
      return `/* TODO: Hoist before loop → ${keyword} ${varName} = ${value} */\n${varName}  // ⚡ reuse hoisted ${varName}`;
    }
    return `/* TODO: Hoist this allocation before the loop */\n// ${p.originalCode.trim()}`;
  }

  /** arr.forEach((item) => { body }) → for (const item of arr) { body } */
  private transformForEach(p: DetectedPattern): string {
    const code = p.originalCode;
    const arrowMatch = code.match(/(\w+)\.forEach\(\(([^)]*)\)\s*=>\s*\{([\s\S]*)\}\s*\)/);
    if (arrowMatch) {
      const [, arr, param, body] = arrowMatch;
      return `for (const ${param.trim()} of ${arr}) {${body}}`;
    }
    const funcMatch = code.match(/(\w+)\.forEach\(function\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*\)/);
    if (funcMatch) {
      const [, arr, param, body] = funcMatch;
      return `for (const ${param.trim()} of ${arr}) {${body}}`;
    }
    // Simple single-line forEach: arr.forEach(fn)
    const simpleMatch = code.match(/(\w+)\.forEach\((\w+)\)/);
    if (simpleMatch) {
      return `for (const _item of ${simpleMatch[1]}) { ${simpleMatch[2]}(_item); }`;
    }
    return `/* ⚡ Replace forEach with for-of */\n${code}`;
  }

  /** results.push(expr) → comment with map suggestion */
  private transformPushInLoop(p: DetectedPattern): string {
    const match = p.originalCode.match(/(\w+)\.push\(([^)]+)\)/);
    if (match) {
      return `// ${p.originalCode.trim()}  // ⚡ consider: const ${match[1]} = items.map(item => ${match[2]})`;
    }
    return `/* ⚡ Replace push-in-loop with Array.map/filter */\n${p.originalCode}`;
  }

  /** Nested loop → add Set pre-computation above */
  private transformNestedLoop(p: DetectedPattern): string {
    return `// ⚡ Pre-compute: const lookupSet = new Set(searchArray);\n// ⚡ Then use lookupSet.has(item) instead of array.includes(item)\n${p.originalCode}`;
  }

  private estimateEnergy(s: GreenSuggestion): EnergyProfile {
    const instrCount = Math.max(1, (s.originalCode.match(/[;{}()=+\-*/<>]/g) || []).length);
    const ratio = REDUCTION_RATIOS[s.patternId] ?? 0;
    const before = instrCount * ENERGY_PER_INSTRUCTION;
    const after = Math.round(instrCount * (1 - ratio)) * ENERGY_PER_INSTRUCTION;
    return { patternId: s.patternId, beforeEstimateJoules: before, afterEstimateJoules: after, savingsJoules: before - after, savingsPercent: before > 0 ? ((before - after) / before) * 100 : 0 };
  }

  private findSourceFiles(dir: string, files: string[] = []): string[] {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", "dist", "out", ".git", ".kiro", ".vscode"].includes(entry.name)) continue;
          this.findSourceFiles(full, files);
        } else if (/\.(ts|js|tsx|jsx)$/.test(entry.name) && !entry.name.includes(".test.") && !entry.name.includes(".spec.")) {
          files.push(full);
        }
      }
    } catch { /* skip */ }
    return files;
  }
}
