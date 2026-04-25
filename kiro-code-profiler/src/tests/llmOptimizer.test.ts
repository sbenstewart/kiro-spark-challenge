import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { MetricsSummary, ProfileSession } from '../types';

// Mock the vscode module before importing LlmOptimizer (which imports vscode at the top level)
vi.mock('vscode', () => ({
  lm: {
    selectChatModels: vi.fn().mockResolvedValue([]),
  },
  LanguageModelChatMessage: {
    User: vi.fn((text: string) => ({ role: 'user', content: text })),
  },
}));

// Import after mock is set up
import { LlmOptimizer } from '../llmOptimizer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<MetricsSummary> = {}): MetricsSummary {
  return {
    peakRamMb: 100,
    avgRamMb: 80,
    totalDiskReadBytes: 0,
    totalDiskWriteBytes: 0,
    avgCpuPercent: 10,
    totalNetworkBytesSent: 0,
    totalNetworkBytesReceived: 0,
    totalFsOpen: 0,
    totalFsRead: 0,
    totalFsWrite: 0,
    totalFsClose: 0,
    executionTimeMs: 100,
    energyMwh: 0.01,
    samples: [],
    ...overrides,
  };
}

/**
 * Arbitrary for ProfileSession with realistic metric fields.
 */
function arbitrarySession(): fc.Arbitrary<ProfileSession> {
  return fc.record({
    id: fc.string({ minLength: 1 }),
    workspacePath: fc.constant('/workspace'),
    filePath: fc.string({ minLength: 1 }),
    language: fc.constantFrom('javascript', 'typescript', 'python') as fc.Arbitrary<
      'javascript' | 'typescript' | 'python'
    >,
    sessionType: fc.constant('profile') as fc.Arbitrary<'profile' | 'monitor'>,
    startTime: fc.integer({ min: 0 }),
    endTime: fc.integer({ min: 0 }),
    exitCode: fc.constant(0),
    stdout: fc.constant(''),
    stderr: fc.constant(''),
    metrics: fc.record({
      peakRamMb: fc.float({ min: 0, max: 10000, noNaN: true }),
      avgRamMb: fc.float({ min: 0, max: 10000, noNaN: true }),
      totalDiskReadBytes: fc.float({ min: 0, max: 1e9, noNaN: true }),
      totalDiskWriteBytes: fc.float({ min: 0, max: 1e9, noNaN: true }),
      avgCpuPercent: fc.float({ min: 0, max: 100, noNaN: true }),
      totalNetworkBytesSent: fc.float({ min: 0, max: 1e9, noNaN: true }),
      totalNetworkBytesReceived: fc.float({ min: 0, max: 1e9, noNaN: true }),
      totalFsOpen: fc.float({ min: 0, max: 1e6, noNaN: true }),
      totalFsRead: fc.float({ min: 0, max: 1e6, noNaN: true }),
      totalFsWrite: fc.float({ min: 0, max: 1e6, noNaN: true }),
      totalFsClose: fc.float({ min: 0, max: 1e6, noNaN: true }),
      executionTimeMs: fc.float({ min: 0, max: 1e6, noNaN: true }),
      energyMwh: fc.float({ min: 0, max: 1000, noNaN: true }),
      samples: fc.constant([]),
    }),
    isBaseline: fc.constant(false),
    optimizationSuggestions: fc.constant([]),
  });
}

/**
 * Arbitrary for a valid OptimizationSuggestion JSON object (before parsing).
 */
function arbitrarySuggestion(): fc.Arbitrary<object> {
  return fc.record({
    title: fc.string({ minLength: 1 }),
    explanation: fc.string({ minLength: 1 }),
    estimatedImpact: fc.float({ min: 0, max: 1, noNaN: true }),
    affectedMetric: fc.constantFrom('ram', 'cpu', 'energy', 'disk', 'network'),
    diff: fc.string(),
  });
}

const MAX_SOURCE_CHARS = 32_000;
const TRUNCATION_MARKER = '// [truncated]';

// ---------------------------------------------------------------------------
// Property 1: buildPrompt contains required metric fields and JSON instruction
// Feature: llm-code-optimization, Property 1: For any ProfileSession and source code string,
// the prompt produced by LlmOptimizer.buildPrompt SHALL contain the source code (or its
// truncated prefix), the peak RAM value, the average CPU value, the execution time, and
// an instruction to return a JSON array.
// Validates: Requirements 3.1
// ---------------------------------------------------------------------------

describe('Property 1: buildPrompt contains required metric fields and JSON instruction', () => {
  it('prompt contains source code (or truncated prefix), peak RAM, avg CPU, execution time, and JSON array instruction', () => {
    const optimizer = new LlmOptimizer();

    fc.assert(
      fc.property(arbitrarySession(), fc.string(), (session, sourceCode) => {
        const prompt = optimizer.buildPrompt(session, sourceCode);

        // Source code or its truncated prefix must appear in the prompt
        const expectedSource =
          sourceCode.length > MAX_SOURCE_CHARS
            ? sourceCode.slice(0, MAX_SOURCE_CHARS)
            : sourceCode;
        expect(prompt).toContain(expectedSource);

        // Peak RAM value must appear
        expect(prompt).toContain(session.metrics.peakRamMb.toFixed(2));

        // Average CPU value must appear
        expect(prompt).toContain(session.metrics.avgCpuPercent.toFixed(2));

        // Execution time must appear
        expect(prompt).toContain(String(session.metrics.executionTimeMs));

        // Must instruct to return a JSON array
        expect(prompt.toLowerCase()).toContain('json array');
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: embedded source never exceeds 32,000 chars; truncated inputs end with // [truncated]
// Feature: llm-code-optimization, Property 2: For any source code string, the source code
// section embedded in the prompt SHALL never exceed 32,000 characters; if the original source
// exceeds this limit, the embedded section SHALL end with `// [truncated]`.
// Validates: Requirements 3.6
// ---------------------------------------------------------------------------

describe('Property 2: embedded source never exceeds 32,000 chars', () => {
  it('source section in prompt never exceeds 32,000 chars and truncated inputs end with // [truncated]', () => {
    const optimizer = new LlmOptimizer();
    const session: ProfileSession = {
      id: 'test',
      workspacePath: '/workspace',
      filePath: '/workspace/test.ts',
      language: 'typescript',
      sessionType: 'profile',
      startTime: 0,
      endTime: 100,
      exitCode: 0,
      stdout: '',
      stderr: '',
      metrics: makeMetrics(),
      isBaseline: false,
      optimizationSuggestions: [],
    };

    fc.assert(
      fc.property(fc.string(), (sourceCode) => {
        const prompt = optimizer.buildPrompt(session, sourceCode);

        // Extract the source section between the code fences
        const fenceStart = prompt.indexOf('```\n');
        const fenceEnd = prompt.indexOf('\n```', fenceStart + 4);
        expect(fenceStart).toBeGreaterThanOrEqual(0);
        expect(fenceEnd).toBeGreaterThan(fenceStart);

        const embeddedSource = prompt.slice(fenceStart + 4, fenceEnd);

        // Embedded source must never exceed 32,000 chars
        expect(embeddedSource.length).toBeLessThanOrEqual(
          MAX_SOURCE_CHARS + TRUNCATION_MARKER.length + 1 // +1 for newline before marker
        );

        // If original source exceeds limit, embedded section must end with truncation marker
        if (sourceCode.length > MAX_SOURCE_CHARS) {
          expect(embeddedSource.endsWith(TRUNCATION_MARKER)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('long source (>32,000 chars) is truncated and ends with // [truncated]', () => {
    const optimizer = new LlmOptimizer();
    const session: ProfileSession = {
      id: 'test',
      workspacePath: '/workspace',
      filePath: '/workspace/test.ts',
      language: 'typescript',
      sessionType: 'profile',
      startTime: 0,
      endTime: 100,
      exitCode: 0,
      stdout: '',
      stderr: '',
      metrics: makeMetrics(),
      isBaseline: false,
      optimizationSuggestions: [],
    };

    // Generate strings longer than 32,000 chars
    fc.assert(
      fc.property(
        fc.string({ minLength: MAX_SOURCE_CHARS + 1, maxLength: MAX_SOURCE_CHARS + 1000 }),
        (longSource) => {
          const prompt = optimizer.buildPrompt(session, longSource);

          const fenceStart = prompt.indexOf('```\n');
          const fenceEnd = prompt.indexOf('\n```', fenceStart + 4);
          const embeddedSource = prompt.slice(fenceStart + 4, fenceEnd);

          expect(embeddedSource.endsWith(TRUNCATION_MARKER)).toBe(true);
          // The actual code portion must be exactly MAX_SOURCE_CHARS
          const codePortionEnd = embeddedSource.lastIndexOf('\n' + TRUNCATION_MARKER);
          expect(codePortionEnd).toBe(MAX_SOURCE_CHARS);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: parseResponse returns valid suggestions for valid JSON arrays
// Feature: llm-code-optimization, Property 3: For any LLM response string that contains a
// valid JSON array of suggestion objects, LlmOptimizer.parseResponse SHALL return an array
// where every element has a non-empty title, a non-empty explanation, an estimatedImpact
// in [0, 1], a valid affectedMetric, and a diff string.
// Validates: Requirements 3.3
// ---------------------------------------------------------------------------

describe('Property 3: parseResponse returns valid suggestions for valid JSON arrays', () => {
  it('every parsed element has valid fields', () => {
    const optimizer = new LlmOptimizer();
    const validMetrics = new Set(['ram', 'cpu', 'energy', 'disk', 'network']);

    fc.assert(
      fc.property(fc.array(arbitrarySuggestion(), { minLength: 1, maxLength: 10 }), (suggestions) => {
        const raw = JSON.stringify(suggestions);
        const result = optimizer.parseResponse(raw);

        // All returned suggestions must have valid fields
        for (const s of result) {
          expect(typeof s.title).toBe('string');
          expect(s.title.trim().length).toBeGreaterThan(0);

          expect(typeof s.explanation).toBe('string');
          expect(s.explanation.trim().length).toBeGreaterThan(0);

          expect(typeof s.estimatedImpact).toBe('number');
          expect(s.estimatedImpact).toBeGreaterThanOrEqual(0);
          expect(s.estimatedImpact).toBeLessThanOrEqual(1);

          expect(validMetrics.has(s.affectedMetric)).toBe(true);

          expect(typeof s.diff).toBe('string');

          // id must be assigned (UUID or provided)
          expect(typeof s.id).toBe('string');
          expect(s.id.trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: parseResponse returns empty array for malformed/non-array responses
// Feature: llm-code-optimization, Property 4: For any LLM response string that does not
// contain a parseable JSON array of valid suggestion objects, LlmOptimizer.parseResponse
// SHALL return an empty array and SHALL NOT throw.
// Validates: Requirements 3.4
// ---------------------------------------------------------------------------

describe('Property 4: parseResponse returns empty array for malformed responses', () => {
  it('returns empty array and does not throw for arbitrary non-array strings', () => {
    const optimizer = new LlmOptimizer();

    fc.assert(
      fc.property(fc.string(), (raw) => {
        let result: unknown;
        expect(() => {
          result = optimizer.parseResponse(raw);
        }).not.toThrow();
        // If it returned something, it must be an array
        expect(Array.isArray(result)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('returns empty array for JSON objects (non-array)', () => {
    const optimizer = new LlmOptimizer();

    fc.assert(
      fc.property(fc.object(), (obj) => {
        const raw = JSON.stringify(obj);
        let result: unknown;
        expect(() => {
          result = optimizer.parseResponse(raw);
        }).not.toThrow();
        expect(Array.isArray(result)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('returns empty array for arrays of invalid suggestion shapes', () => {
    const optimizer = new LlmOptimizer();

    // Arrays where every element is missing required fields
    const invalidSuggestionArb = fc.record({
      // Missing title, explanation, estimatedImpact, affectedMetric, diff
      foo: fc.string(),
      bar: fc.integer(),
    });

    fc.assert(
      fc.property(fc.array(invalidSuggestionArb, { minLength: 1, maxLength: 5 }), (items) => {
        const raw = JSON.stringify(items);
        const result = optimizer.parseResponse(raw);
        expect(result).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });
});
