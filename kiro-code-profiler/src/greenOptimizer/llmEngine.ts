import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import { GreenSuggestion, ImpactSummary } from "./types";
import { Benchmarker, ComparisonResult } from "./benchmarker";

const ENERGY_PER_INSTRUCTION = 1e-9;
const CARBON_INTENSITY_GLOBAL = 490;
const SMARTPHONE_CHARGE_KWH = 0.012;
const CAR_EMISSIONS_G_PER_METER = 0.21;

interface LLMSuggestionRaw {
  startLine: number;
  endLine: number;
  category: string;
  confidence: string;
  description: string;
  originalCode: string;
  optimizedCode: string;
  savingsPercent: number;
}

export class LLMEngine {
  private suggestions: GreenSuggestion[] = [];
  private counter = 0;
  private apiKey: string = "";
  private debugLog: string[] = [];

  async analyzeWorkspace(
    rootDir: string,
    progress?: (msg: string) => void
  ): Promise<{ suggestions: GreenSuggestion[]; scannedFiles: number; skippedFiles: number }> {
    this.debugLog = [];
    // Always prompt fresh for API key
    const key = await vscode.window.showInputBox({
      prompt: "Enter your OpenAI API key",
      placeHolder: "sk-proj-...",
      password: true,
      ignoreFocusOut: true,
    });
    if (!key) throw new Error("API key required.");
    this.apiKey = key;

    // Test API key with a simple call first
    progress?.("🔑 Testing API key...");
    try {
      const testResponse = await this.callOpenAI(JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Reply with just: OK" }],
        max_tokens: 10,
      }));
      this.log("API test response: " + testResponse.substring(0, 100));
      progress?.("✅ API key valid. Starting analysis...");
    } catch (err: any) {
      this.log("API test FAILED: " + err.message);
      throw new Error("API key test failed: " + err.message);
    }

    const files = this.findSourceFiles(rootDir);
    this.suggestions = [];
    this.counter = 0;
    let skipped = 0;
    let errors = 0;

    progress?.(`Found ${files.length} source files to analyze...`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = path.basename(file);
      progress?.(`🤖 Analyzing ${fileName} (${i + 1}/${files.length})...`);

      let content: string;
      try { content = fs.readFileSync(file, "utf-8"); } catch { skipped++; continue; }

      const lineCount = content.split("\n").length;
      if (lineCount > 500) { skipped++; continue; }
      if (lineCount < 5) { skipped++; continue; }

      try {
        const fileSuggestions = await this.analyzeFileWithClaude(file, content);
        if (fileSuggestions.length > 0) {
          progress?.(`✅ Found ${fileSuggestions.length} issues in ${fileName}`);
        } else {
          progress?.(`✔️ ${fileName} — clean`);
        }
        this.suggestions.push(...fileSuggestions);
      } catch (err: any) {
        errors++;
        this.log(`ERROR ${fileName}: ${err.message}`);
        progress?.(`⚠️ ${fileName}: ${err.message}`);
      }
    }

    if (errors > 0) {
      progress?.(`Done. ${this.suggestions.length} issues found, ${errors} files had errors. Check debug log.`);
    }

    this.suggestions.sort((a, b) => (b.estimatedEnergySavings ?? 0) - (a.estimatedEnergySavings ?? 0));
    return { suggestions: this.suggestions, scannedFiles: files.length - skipped, skippedFiles: skipped };
  }

  private log(msg: string) {
    this.debugLog.push(`[${new Date().toISOString()}] ${msg}`);
    console.log(`[GreenOptimizer] ${msg}`);
  }

  getDebugLog(): string[] { return this.debugLog; }

  private async analyzeFileWithClaude(filePath: string, content: string): Promise<GreenSuggestion[]> {
    const fileName = path.basename(filePath);
    const prompt = `Analyze this code for energy inefficiencies. Return ONLY a JSON array.

FILE: ${fileName}
\`\`\`
${content}
\`\`\`

Each object: {"startLine":N,"endLine":N,"category":"algorithmic-inefficiency"|"redundant-allocation"|"unnecessary-io"|"inefficient-loop","confidence":"high"|"medium"|"low","description":"...","originalCode":"EXACT code from file","optimizedCode":"replacement","savingsPercent":N}

Rules: originalCode must be EXACT substring from the file. Only real issues. Return [] if none.`;

    const body = JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
      temperature: 0,
    });

    this.log(`Calling OpenAI for ${fileName} (${content.length} chars)...`);
    const responseText = await this.callOpenAI(body);
    this.log(`Response for ${fileName}: ${responseText.substring(0, 200)}`);
    return this.parseLLMResponse(responseText, filePath);
  }

  private callOpenAI(body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
      }, (res) => {
        let data = "";
        res.on("data", (chunk: string) => data += chunk);
        res.on("end", () => {
          this.log(`API status: ${res.statusCode}`);
          if (res.statusCode !== 200) {
            reject(new Error(`API ${res.statusCode}: ${data.substring(0, 300)}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const text = parsed.choices?.[0]?.message?.content || "";
            resolve(text);
          } catch {
            reject(new Error("Failed to parse API response"));
          }
        });
      });
      req.on("error", (err) => reject(new Error(`Network: ${err.message}`)));
      req.setTimeout(60000, () => { req.destroy(); reject(new Error("Request timeout (60s)")); });
      req.write(body);
      req.end();
    });
  }

  private parseLLMResponse(responseText: string, filePath: string): GreenSuggestion[] {
    let jsonStr = responseText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!arrayMatch) { this.log(`No JSON array in response for ${path.basename(filePath)}`); return []; }

    let parsed: LLMSuggestionRaw[];
    try { parsed = JSON.parse(arrayMatch[0]); } catch (e) { this.log(`JSON parse error: ${e}`); return []; }
    if (!Array.isArray(parsed)) return [];
    this.log(`Parsed ${parsed.length} raw suggestions for ${path.basename(filePath)}`);

    let fileContent: string;
    try { fileContent = fs.readFileSync(filePath, "utf-8"); } catch { return []; }

    const validated = parsed
      .filter(s => s.originalCode && s.optimizedCode && s.description)
      .filter(s => {
        const found = fileContent.includes(s.originalCode.trim());
        if (!found) this.log(`originalCode NOT in file: "${s.originalCode.trim().substring(0, 60)}..."`);
        return found;
      });

    this.log(`${validated.length}/${parsed.length} passed validation for ${path.basename(filePath)}`);

    return validated.map(s => {
      this.counter++;
      return {
        suggestionId: `llm-${this.counter}`,
        patternId: `llm-${s.category || "general"}`,
        filePath,
        startLine: s.startLine || 0,
        endLine: s.endLine || 0,
        originalCode: s.originalCode.trim(),
        proposedCode: s.optimizedCode.trim(),
        estimatedEnergySavings: (s.savingsPercent || 10) / 100,
        confidenceLevel: (s.confidence as any) || "medium",
        category: (s.category as any) || "algorithmic-inefficiency",
        description: s.description,
        status: "pending" as const,
      };
    });
  }

  async acceptSuggestion(id: string): Promise<{ success: boolean; error?: string }> {
    const s = this.suggestions.find(x => x.suggestionId === id);
    if (!s) return { success: false, error: "Suggestion not found" };
    let content: string;
    try { content = fs.readFileSync(s.filePath, "utf-8"); } catch { return { success: false, error: "Cannot read file" }; }
    const idx = content.indexOf(s.originalCode);
    if (idx === -1) return { success: false, error: "Original code not found — file may have changed" };
    const newContent = content.substring(0, idx) + s.proposedCode + content.substring(idx + s.originalCode.length);
    try { fs.writeFileSync(s.filePath, newContent, "utf-8"); } catch { return { success: false, error: "Cannot write file" }; }
    s.status = "accepted";
    return { success: true };
  }

  rejectSuggestion(id: string): void {
    const s = this.suggestions.find(x => x.suggestionId === id);
    if (s) s.status = "rejected";
  }

  /**
   * Benchmark a suggestion by actually running original vs optimized code.
   * Returns real measured comparison with actual energy savings.
   */
  async benchmarkSuggestion(id: string, progress?: (msg: string) => void): Promise<ComparisonResult | null> {
    const s = this.suggestions.find(x => x.suggestionId === id);
    if (!s) return null;

    const benchmarker = new Benchmarker();
    progress?.(`⏱️ Benchmarking original code...`);
    try {
      const result = await benchmarker.compare(s.originalCode, s.proposedCode);
      this.log(`Benchmark for ${s.suggestionId}: before=${result.before.executionTimeMs.toFixed(2)}ms, after=${result.after.executionTimeMs.toFixed(2)}ms, saved=${result.savingsPercent.toFixed(1)}%`);
      // Update the suggestion's savings with real measured data
      s.estimatedEnergySavings = result.savingsPercent / 100;
      return result;
    } catch (err: any) {
      this.log(`Benchmark failed for ${s.suggestionId}: ${err.message}`);
      return null;
    }
  }

  getImpactSummary(): ImpactSummary {
    const active = this.suggestions.filter(s => s.status !== "rejected");
    const instrCount = active.reduce((sum, s) => sum + Math.max(1, (s.originalCode.match(/[;{}()=+\-*/<>]/g) || []).length), 0);
    const avgRatio = active.length > 0 ? active.reduce((sum, s) => sum + (s.estimatedEnergySavings ?? 0), 0) / active.length : 0;
    const totalJoules = instrCount * ENERGY_PER_INSTRUCTION * avgRatio;
    const totalKwh = totalJoules / 3_600_000;
    const totalCo2 = totalKwh * CARBON_INTENSITY_GLOBAL;
    return {
      totalPatterns: this.suggestions.length,
      totalEnergySavedJoules: totalJoules, totalEnergySavedKwh: totalKwh, totalCo2ReductionGrams: totalCo2,
      carbonIntensityFactor: CARBON_INTENSITY_GLOBAL, region: "global",
      smartphoneCharges: totalKwh / SMARTPHONE_CHARGE_KWH, carMeters: totalCo2 / CAR_EMISSIONS_G_PER_METER,
      acceptedCount: this.suggestions.filter(s => s.status === "accepted").length,
      rejectedCount: this.suggestions.filter(s => s.status === "rejected").length,
      pendingCount: this.suggestions.filter(s => s.status === "pending").length,
    };
  }

  getSuggestions(): GreenSuggestion[] { return this.suggestions; }

  private findSourceFiles(dir: string, files: string[] = []): string[] {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", "dist", "out", ".git", ".kiro", ".vscode", "test", "tests", "__tests__"].includes(entry.name)) continue;
          this.findSourceFiles(full, files);
        } else if (/\.(ts|js|tsx|jsx)$/.test(entry.name) && !entry.name.includes(".test.") && !entry.name.includes(".spec.") && entry.name !== "esbuild.js") {
          files.push(full);
        }
      }
    } catch { /* skip */ }
    return files;
  }
}
