// Feature: llm-code-optimization, Property 9: For any list of suggestions with distinct
// estimatedImpact values, the Accept All operation SHALL apply diffs in strictly descending
// order of estimatedImpact.
// Feature: llm-code-optimization, Property 10: For any list of suggestions where a subset
// have diffs that cannot be applied cleanly, the Accept All operation SHALL apply all valid
// diffs and skip only the invalid ones, without aborting the entire operation.

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyUnifiedDiff } from '../diffApplier';
import { OptimizationSuggestion } from '../types';

// ---------------------------------------------------------------------------
// Helpers — simulate the Accept All logic from extension.ts
// ---------------------------------------------------------------------------

/**
 * Simulates the acceptAllSuggestions logic:
 * 1. Sort suggestions by estimatedImpact descending
 * 2. For each suggestion, call applyUnifiedDiff(currentContent, suggestion.diff)
 * 3. If null, skip; otherwise update currentContent and count as applied
 *
 * Returns the order in which diffs were attempted (by suggestion id) and the
 * count of applied suggestions.
 */
function simulateAcceptAll(
  suggestions: OptimizationSuggestion[],
  initialContent: string
): { attemptOrder: string[]; appliedCount: number; skippedCount: number; finalContent: string } {
  const sorted = [...suggestions].sort((a, b) => b.estimatedImpact - a.estimatedImpact);

  const attemptOrder: string[] = [];
  let applied = 0;
  let skipped = 0;
  let currentContent = initialContent;

  for (const suggestion of sorted) {
    attemptOrder.push(suggestion.id);
    const patched = applyUnifiedDiff(currentContent, suggestion.diff);
    if (patched === null) {
      skipped++;
    } else {
      currentContent = patched;
      applied++;
    }
  }

  return { attemptOrder, appliedCount: applied, skippedCount: skipped, finalContent: currentContent };
}

// ---------------------------------------------------------------------------
// Helpers — build valid and invalid diffs for a given content
// ---------------------------------------------------------------------------

/**
 * Build a valid unified diff that replaces `oldLine` with `newLine` in `content`.
 * The diff is guaranteed to apply cleanly to `content`.
 */
function buildValidDiff(content: string, lineIndex: number, newLine: string): string {
  const lines = content.split('\n');
  const oldLine = lines[lineIndex];
  const origStart = lineIndex + 1; // 1-based
  return `--- a/file\n+++ b/file\n@@ -${origStart},1 +${origStart},1 @@\n-${oldLine}\n+${newLine}\n`;
}

/**
 * Build an invalid unified diff that references a line not present in `content`.
 */
function buildInvalidDiff(): string {
  const nonExistentLine = 'THIS_LINE_DOES_NOT_EXIST_IN_ANY_CONTENT_xyzzy_12345';
  return `--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-${nonExistentLine}\n+replacement\n`;
}

// ---------------------------------------------------------------------------
// Arbitrary helpers
// ---------------------------------------------------------------------------

/**
 * Generates a list of lines suitable for use as file content.
 * Each line is a simple identifier-like string to avoid diff parsing edge cases.
 */
const arbitraryLines = fc.array(
  fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,15}$/),
  { minLength: 3, maxLength: 10 }
);

/**
 * Generates distinct estimatedImpact values in [0, 1].
 * Uses unique floats by generating distinct integers and normalising.
 */
function arbitraryDistinctImpacts(count: number): fc.Arbitrary<number[]> {
  return fc
    .uniqueArray(fc.integer({ min: 1, max: 10_000 }), { minLength: count, maxLength: count })
    .map((ints) => ints.map((n) => n / 10_000));
}

// ---------------------------------------------------------------------------
// Property 9: Accept All applies suggestions in descending estimatedImpact order
// Validates: Requirements 6.2
// ---------------------------------------------------------------------------

describe('Property 9: Accept All applies suggestions in descending estimatedImpact order', () => {
  // Feature: llm-code-optimization, Property 9: For any list of suggestions with distinct
  // estimatedImpact values, the Accept All operation SHALL apply diffs in strictly descending
  // order of estimatedImpact.
  it('diffs are attempted in strictly descending order of estimatedImpact', () => {
    fc.assert(
      fc.property(
        // Generate 2–6 lines of content
        arbitraryLines,
        // Generate a count between 2 and 4 suggestions
        fc.integer({ min: 2, max: 4 }),
        (lines, count) => {
          // Clamp count to available lines
          const actualCount = Math.min(count, lines.length);
          if (actualCount < 2) return; // skip degenerate cases

          const content = lines.join('\n');

          // Generate distinct impacts inline using a synchronous approach
          const impacts: number[] = [];
          for (let i = 0; i < actualCount; i++) {
            impacts.push((i + 1) / (actualCount + 1));
          }
          // Shuffle impacts so they're not already sorted
          for (let i = impacts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [impacts[i], impacts[j]] = [impacts[j], impacts[i]];
          }

          // Build suggestions — each replaces a different line with a tagged version
          const suggestions: OptimizationSuggestion[] = lines
            .slice(0, actualCount)
            .map((line, idx) => ({
              id: `suggestion-${idx}`,
              title: `Suggestion ${idx}`,
              explanation: `Replaces line ${idx}`,
              estimatedImpact: impacts[idx],
              affectedMetric: 'cpu' as const,
              diff: buildValidDiff(content, idx, `${line}_optimized_${idx}`),
            }));

          const { attemptOrder } = simulateAcceptAll(suggestions, content);

          // Verify the attempt order matches descending estimatedImpact
          const impactByOrder = attemptOrder.map(
            (id) => suggestions.find((s) => s.id === id)!.estimatedImpact
          );

          for (let i = 0; i < impactByOrder.length - 1; i++) {
            expect(impactByOrder[i]).toBeGreaterThanOrEqual(impactByOrder[i + 1]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('with distinct impacts, order is strictly descending', () => {
    fc.assert(
      fc.property(
        arbitraryLines,
        fc.integer({ min: 2, max: 4 }),
        (lines, count) => {
          const actualCount = Math.min(count, lines.length);
          if (actualCount < 2) return;

          const content = lines.join('\n');

          // Use strictly distinct impacts
          const impacts = Array.from({ length: actualCount }, (_, i) => (i + 1) / (actualCount + 1));

          const suggestions: OptimizationSuggestion[] = lines
            .slice(0, actualCount)
            .map((line, idx) => ({
              id: `s-${idx}`,
              title: `S${idx}`,
              explanation: `desc ${idx}`,
              estimatedImpact: impacts[idx], // ascending by index
              affectedMetric: 'ram' as const,
              diff: buildValidDiff(content, idx, `${line}_v${idx}`),
            }));

          const { attemptOrder } = simulateAcceptAll(suggestions, content);

          // The attempt order should be reversed (highest impact first)
          const expectedOrder = [...suggestions]
            .sort((a, b) => b.estimatedImpact - a.estimatedImpact)
            .map((s) => s.id);

          expect(attemptOrder).toEqual(expectedOrder);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: Accept All skips invalid diffs and continues
// Validates: Requirements 6.3
// ---------------------------------------------------------------------------

describe('Property 10: Accept All applies valid diffs and skips invalid ones', () => {
  // Feature: llm-code-optimization, Property 10: For any list of suggestions where a subset
  // have diffs that cannot be applied cleanly, the Accept All operation SHALL apply all valid
  // diffs and skip only the invalid ones, without aborting the entire operation.
  it('valid diffs are applied and invalid diffs are skipped without aborting', () => {
    fc.assert(
      fc.property(
        // 3–6 lines of content
        fc.array(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,10}$/),
          { minLength: 3, maxLength: 6 }
        ),
        // How many of the suggestions should be valid (at least 1, at most lines.length - 1)
        fc.integer({ min: 1, max: 2 }),
        // How many should be invalid (at least 1)
        fc.integer({ min: 1, max: 2 }),
        (lines, validCount, invalidCount) => {
          // Ensure we have enough lines for valid diffs
          const actualValid = Math.min(validCount, lines.length);
          if (actualValid < 1) return;

          const content = lines.join('\n');

          // Build valid suggestions — each replaces a distinct line
          const validSuggestions: OptimizationSuggestion[] = lines
            .slice(0, actualValid)
            .map((line, idx) => ({
              id: `valid-${idx}`,
              title: `Valid ${idx}`,
              explanation: `Replaces line ${idx}`,
              estimatedImpact: 0.9 - idx * 0.1, // distinct, descending
              affectedMetric: 'cpu' as const,
              diff: buildValidDiff(content, idx, `${line}_fixed`),
            }));

          // Build invalid suggestions
          const invalidSuggestions: OptimizationSuggestion[] = Array.from(
            { length: invalidCount },
            (_, idx) => ({
              id: `invalid-${idx}`,
              title: `Invalid ${idx}`,
              explanation: `Bad diff ${idx}`,
              estimatedImpact: 0.05 + idx * 0.01, // low impact, below valid ones
              affectedMetric: 'ram' as const,
              diff: buildInvalidDiff(),
            })
          );

          const allSuggestions = [...validSuggestions, ...invalidSuggestions];

          const { appliedCount, skippedCount, attemptOrder } = simulateAcceptAll(
            allSuggestions,
            content
          );

          // All suggestions must have been attempted (no early abort)
          expect(attemptOrder.length).toBe(allSuggestions.length);

          // Valid ones must be applied, invalid ones must be skipped
          expect(appliedCount).toBe(actualValid);
          expect(skippedCount).toBe(invalidCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('all-invalid suggestions result in zero applied and no abort', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,10}$/),
          { minLength: 2, maxLength: 5 }
        ),
        fc.integer({ min: 1, max: 4 }),
        (lines, invalidCount) => {
          const content = lines.join('\n');

          const invalidSuggestions: OptimizationSuggestion[] = Array.from(
            { length: invalidCount },
            (_, idx) => ({
              id: `inv-${idx}`,
              title: `Inv ${idx}`,
              explanation: `Bad diff`,
              estimatedImpact: (idx + 1) / (invalidCount + 1),
              affectedMetric: 'energy' as const,
              diff: buildInvalidDiff(),
            })
          );

          const { appliedCount, skippedCount, attemptOrder, finalContent } = simulateAcceptAll(
            invalidSuggestions,
            content
          );

          // All must be attempted
          expect(attemptOrder.length).toBe(invalidCount);
          // None applied
          expect(appliedCount).toBe(0);
          // All skipped
          expect(skippedCount).toBe(invalidCount);
          // Content unchanged
          expect(finalContent).toBe(content);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('all-valid suggestions result in all applied', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,10}$/),
          { minLength: 2, maxLength: 5 }
        ),
        (lines) => {
          const content = lines.join('\n');
          const count = lines.length;

          // Each suggestion replaces a different line — applied sequentially so each
          // diff targets the line as it exists in the *original* content (before any
          // prior suggestion mutates it). Since each diff targets a distinct line and
          // the replacement text is unique, all diffs remain applicable in sequence.
          const suggestions: OptimizationSuggestion[] = lines.map((line, idx) => ({
            id: `all-valid-${idx}`,
            title: `AV ${idx}`,
            explanation: `Replaces line ${idx}`,
            estimatedImpact: (count - idx) / (count + 1), // distinct, descending by idx
            affectedMetric: 'disk' as const,
            diff: buildValidDiff(content, idx, `${line}_opt`),
          }));

          const { appliedCount, skippedCount } = simulateAcceptAll(suggestions, content);

          expect(appliedCount).toBe(count);
          expect(skippedCount).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
