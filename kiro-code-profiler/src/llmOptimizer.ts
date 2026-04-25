import { v4 as uuidv4 } from 'uuid';
import { OptimizationSuggestion, ProfileSession } from './types';
import { ConfigurationManager } from './configurationManager';
import OpenAI from 'openai';

const MAX_SOURCE_CHARS = 32_000;
const TRUNCATION_MARKER = '// [truncated]';
const VALID_METRICS = new Set<string>(['ram', 'cpu', 'energy', 'disk', 'network']);
const OPENAI_MODEL = 'gpt-4o-mini';

/**
 * Resolves the OpenAI API key using the following priority:
 *   1. VS Code extension settings (kiro-profiler.openaiApiKey)
 *   2. OPENAI_API_KEY environment variable
 *   3. VS Code secret storage (set via the dashboard settings UI)
 */
export async function resolveApiKey(secretStorage?: { get(key: string): Thenable<string | undefined> }): Promise<string> {
  // 1. VS Code extension settings
  const configManager = new ConfigurationManager();
  const config = configManager.getConfig();
  if (config.openaiApiKey) {
    return config.openaiApiKey;
  }

  // 2. Environment variable
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  // 3. VS Code secret storage (dashboard UI input)
  if (secretStorage) {
    const stored = await secretStorage.get('kiro-profiler.openaiApiKey');
    if (stored) {
      return stored;
    }
  }

  throw new Error(
    'No OpenAI API key found. Add it under Extensions → Kiro Code Profiler → OpenAI API Key in VS Code settings.'
  );
}

export class LlmOptimizer {
  constructor(private secretStorage?: { get(key: string): Thenable<string | undefined> }) {}

  /**
   * Builds the LLM prompt embedding source code (truncated to 32,000 chars),
   * MetricsSummary fields, and a JSON-array instruction.
   */
  buildPrompt(session: ProfileSession, sourceCode: string): string {
    let embeddedSource = sourceCode;
    if (sourceCode.length > MAX_SOURCE_CHARS) {
      embeddedSource = sourceCode.slice(0, MAX_SOURCE_CHARS) + '\n' + TRUNCATION_MARKER;
    }

    const { metrics } = session;

    return `You are a code performance optimization expert. Analyze the following source code and profiling metrics, then return optimization suggestions as a JSON array.

## Source Code
\`\`\`
${embeddedSource}
\`\`\`

## Profiling Metrics
- Peak RAM: ${metrics.peakRamMb.toFixed(2)} MB
- Average RAM: ${metrics.avgRamMb.toFixed(2)} MB
- Average CPU: ${metrics.avgCpuPercent.toFixed(2)}%
- Execution Time: ${metrics.executionTimeMs} ms
- Energy: ${metrics.energyMwh.toFixed(4)} mWh
- Total Disk Read: ${metrics.totalDiskReadBytes} bytes
- Total Disk Write: ${metrics.totalDiskWriteBytes} bytes
- Total Network Sent: ${metrics.totalNetworkBytesSent} bytes
- Total Network Received: ${metrics.totalNetworkBytesReceived} bytes

## Instructions
Return ONLY a JSON array of optimization suggestions. Each suggestion must have this exact shape:
{
  "id": "<uuid string, optional>",
  "title": "<short title>",
  "explanation": "<detailed explanation>",
  "estimatedImpact": <number between 0 and 1>,
  "affectedMetric": "<one of: ram, cpu, energy, disk, network>",
  "diff": "<unified diff string>"
}

Return only the JSON array, no other text.`;
  }

  /**
   * Extracts the first JSON array from the LLM response, validates each element
   * against the OptimizationSuggestion shape, assigns a UUID id if missing,
   * and silently drops malformed entries.
   */
  parseResponse(raw: string): OptimizationSuggestion[] {
    const startIdx = raw.indexOf('[');
    if (startIdx === -1) {
      return [];
    }

    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < raw.length; i++) {
      if (raw[i] === '[') {
        depth++;
      } else if (raw[i] === ']') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }

    if (endIdx === -1) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.slice(startIdx, endIdx + 1));
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    const results: OptimizationSuggestion[] = [];
    for (const item of parsed) {
      if (!isValidSuggestionShape(item)) {
        continue;
      }
      results.push({
        id: item.id && typeof item.id === 'string' && item.id.trim() !== '' ? item.id : uuidv4(),
        title: item.title,
        explanation: item.explanation,
        estimatedImpact: item.estimatedImpact,
        affectedMetric: item.affectedMetric,
        diff: item.diff,
      });
    }

    return results;
  }

  /**
   * Calls the OpenAI Chat Completions API with gpt-4o-mini and returns parsed suggestions.
   * API key is resolved from .env → VS Code secret storage.
   */
  async suggest(session: ProfileSession, sourceCode: string): Promise<OptimizationSuggestion[]> {
    const apiKey = await resolveApiKey(this.secretStorage);
    const prompt = this.buildPrompt(session, sourceCode);

    const client = new OpenAI({ apiKey });

    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    });

    const raw = response.choices?.[0]?.message?.content ?? '';
    return this.parseResponse(raw);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isValidSuggestionShape(item: any): item is OptimizationSuggestion {
  if (typeof item !== 'object' || item === null) { return false; }
  if (typeof item.title !== 'string' || item.title.trim() === '') { return false; }
  if (typeof item.explanation !== 'string' || item.explanation.trim() === '') { return false; }
  if (typeof item.estimatedImpact !== 'number' || item.estimatedImpact < 0 || item.estimatedImpact > 1) { return false; }
  if (typeof item.affectedMetric !== 'string' || !VALID_METRICS.has(item.affectedMetric)) { return false; }
  if (typeof item.diff !== 'string') { return false; }
  return true;
}
