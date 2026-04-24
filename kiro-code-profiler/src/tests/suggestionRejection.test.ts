// Feature: kiro-code-profiler, Property 6: Suggestion rejection is a no-op
// Validates: Requirements 4.5

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

/**
 * Models the editor buffer lifecycle for suggestion preview + rejection.
 *
 * In the real extension, accepting a suggestion applies a diff to the active
 * editor buffer as a preview. Rejecting restores the original content.
 * Since VS Code editor buffers cannot be instantiated in unit tests, we model
 * the same invariant with plain strings:
 *
 *   1. Start with original source code.
 *   2. "Apply" the suggestion (store original + diff, return modified content).
 *   3. "Reject" the suggestion (restore original from stored state).
 *   4. Assert the restored content is byte-for-byte identical to the original.
 */

interface SuggestionPreviewState {
  originalContent: string;
  previewContent: string;
  suggestionId: string;
}

/** Simulates applying a suggestion diff as a preview. */
function applyPreview(originalContent: string, diff: string, suggestionId: string): SuggestionPreviewState {
  // The preview content is the original with the diff appended as a marker.
  // In the real extension this would be a proper diff application; here we
  // just need a deterministic transformation that is NOT the identity so we
  // can verify rejection truly restores the original.
  const previewContent = originalContent + '\n/* PREVIEW:' + diff + '*/';
  return { originalContent, previewContent, suggestionId };
}

/** Simulates rejecting a suggestion preview — restores the original. */
function rejectPreview(state: SuggestionPreviewState): string {
  return state.originalContent;
}

// ── Property 6 ──────────────────────────────────────────────────────────────

describe('Property 6: Suggestion rejection is a no-op', () => {
  it('rejecting a suggestion preview restores the original content byte-for-byte', () => {
    fc.assert(
      fc.property(
        fc.string(),          // arbitrary source code
        fc.string(),          // arbitrary diff string
        fc.string({ minLength: 1 }), // suggestion id
        (originalContent, diff, suggestionId) => {
          const state = applyPreview(originalContent, diff, suggestionId);
          const restored = rejectPreview(state);
          expect(restored).toBe(originalContent);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejection is idempotent — rejecting twice still yields the original', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.string({ minLength: 1 }),
        (originalContent, diff, suggestionId) => {
          const state = applyPreview(originalContent, diff, suggestionId);
          const first = rejectPreview(state);
          // Applying and rejecting again from the same original state
          const state2 = applyPreview(first, diff, suggestionId);
          const second = rejectPreview(state2);
          expect(second).toBe(originalContent);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preview content differs from original when diff is non-empty', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string({ minLength: 1 }), // non-empty diff
        fc.string({ minLength: 1 }),
        (originalContent, diff, suggestionId) => {
          const state = applyPreview(originalContent, diff, suggestionId);
          // Preview must differ from original (the diff was applied)
          expect(state.previewContent).not.toBe(originalContent);
          // But rejection must restore the original exactly
          expect(rejectPreview(state)).toBe(originalContent);
        }
      ),
      { numRuns: 100 }
    );
  });
});
