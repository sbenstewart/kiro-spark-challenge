/**
 * DiffApplier — lightweight unified-diff parser and applier.
 *
 * Supports the standard unified-diff format produced by `diff -u` / `git diff`:
 *   --- a/file
 *   +++ b/file
 *   @@ -startLine,count +startLine,count @@
 *   <context / + added / - removed lines>
 */

interface Hunk {
  /** 1-based line number in the original file where this hunk starts */
  origStart: number;
  /** Number of lines from the original file covered by this hunk */
  origCount: number;
  /** Lines to remove (without the leading '-') */
  removeLines: string[];
  /** Lines to add (without the leading '+') */
  addLines: string[];
  /** All hunk body lines in order ('+', '-', or ' ' prefix preserved) */
  bodyLines: string[];
}

/**
 * Apply a unified diff to `originalContent`.
 *
 * @returns The patched content string, or `null` if any hunk cannot be
 *          located in the original content (i.e. the diff does not match).
 */
export function applyUnifiedDiff(originalContent: string, diff: string): string | null {
  const hunks = parseHunks(diff);

  // An empty diff is a no-op — return original unchanged.
  if (hunks.length === 0) {
    return originalContent;
  }

  // Split into lines, preserving trailing newline awareness.
  const originalLines = originalContent.split('\n');

  // We'll build the result by processing hunks in order.
  // `cursor` tracks the next 0-based index in originalLines we haven't consumed yet.
  let cursor = 0;
  const resultLines: string[] = [];

  for (const hunk of hunks) {
    // Locate the hunk in the original content.
    const matchIndex = findHunkInOriginal(originalLines, hunk, cursor);
    if (matchIndex === -1) {
      return null;
    }

    // Copy unchanged lines before this hunk.
    for (let i = cursor; i < matchIndex; i++) {
      resultLines.push(originalLines[i]);
    }

    // Apply the hunk: skip '-' lines, emit '+' lines, keep ' ' (context) lines.
    for (const line of hunk.bodyLines) {
      const prefix = line[0];
      const content = line.slice(1);
      if (prefix === '+') {
        resultLines.push(content);
      } else if (prefix === ' ') {
        resultLines.push(content);
      }
      // '-' lines are consumed (skipped) from the original.
    }

    cursor = matchIndex + hunk.origCount;
  }

  // Copy any remaining lines after the last hunk.
  for (let i = cursor; i < originalLines.length; i++) {
    resultLines.push(originalLines[i]);
  }

  return resultLines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse all hunks from a unified diff string.
 */
function parseHunks(diff: string): Hunk[] {
  const lines = diff.split('\n');
  const hunks: Hunk[] = [];
  let i = 0;

  // Skip file header lines (--- / +++)
  while (i < lines.length && !lines[i].startsWith('@@')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith('@@')) {
      i++;
      continue;
    }

    // Parse @@ -origStart[,origCount] +newStart[,newCount] @@
    const match = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!match) {
      i++;
      continue;
    }

    const origStart = parseInt(match[1], 10);
    const origCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;

    i++; // move past the @@ line

    const bodyLines: string[] = [];
    const removeLines: string[] = [];
    const addLines: string[] = [];

    while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff ')) {
      const bodyLine = lines[i];
      // Allow context (' '), added ('+'), removed ('-') lines.
      // Lines starting with '\' (e.g. "\ No newline at end of file") are skipped.
      if (bodyLine.startsWith(' ') || bodyLine.startsWith('+') || bodyLine.startsWith('-')) {
        bodyLines.push(bodyLine);
        if (bodyLine.startsWith('-')) {
          removeLines.push(bodyLine.slice(1));
        } else if (bodyLine.startsWith('+')) {
          addLines.push(bodyLine.slice(1));
        }
      }
      i++;
    }

    hunks.push({ origStart, origCount, removeLines, addLines, bodyLines });
  }

  return hunks;
}

/**
 * Find the 0-based index in `originalLines` where `hunk` matches,
 * starting the search from `searchFrom`.
 *
 * Strategy: extract the context+remove lines from the hunk (the lines that
 * must exist in the original), then search for that sequence starting near
 * the hint provided by `origStart`.
 *
 * Returns -1 if no match is found.
 */
function findHunkInOriginal(originalLines: string[], hunk: Hunk, searchFrom: number): number {
  // Build the sequence of lines that must appear in the original.
  const expectedLines: string[] = [];
  for (const line of hunk.bodyLines) {
    if (line.startsWith(' ') || line.startsWith('-')) {
      expectedLines.push(line.slice(1));
    }
  }

  if (expectedLines.length === 0) {
    // Pure-insertion hunk with no context — use the origStart hint.
    // origStart is 1-based; clamp to valid range.
    const hint = Math.max(0, Math.min(hunk.origStart - 1, originalLines.length));
    return Math.max(hint, searchFrom);
  }

  // Try the hinted position first (origStart is 1-based → 0-based index).
  const hint = Math.max(searchFrom, hunk.origStart - 1);

  // Search outward from the hint within the remaining lines.
  const maxStart = originalLines.length - expectedLines.length;

  // Try hint first, then expand search window.
  for (let offset = 0; offset <= maxStart - searchFrom; offset++) {
    for (const direction of [0, 1, -1]) {
      const candidate = hint + direction * offset;
      if (candidate < searchFrom || candidate > maxStart) {
        continue;
      }
      if (linesMatch(originalLines, candidate, expectedLines)) {
        return candidate;
      }
    }
    if (offset === 0) {
      continue; // already tried hint
    }
  }

  return -1;
}

/**
 * Check whether `originalLines` starting at `startIndex` matches `expected`.
 *
 * Uses a two-pass strategy:
 *   1. Try an exact (strict) match first.
 *   2. Fall back to a trimmed comparison so that minor trailing-whitespace
 *      differences introduced by the LLM don't cause a spurious mismatch.
 */
function linesMatch(originalLines: string[], startIndex: number, expected: string[]): boolean {
  if (startIndex + expected.length > originalLines.length) {
    return false;
  }

  // Pass 1 — exact match
  let exact = true;
  for (let i = 0; i < expected.length; i++) {
    if (originalLines[startIndex + i] !== expected[i]) {
      exact = false;
      break;
    }
  }
  if (exact) {
    return true;
  }

  // Pass 2 — trimmed (whitespace-tolerant) match
  for (let i = 0; i < expected.length; i++) {
    if (originalLines[startIndex + i].trimEnd() !== expected[i].trimEnd()) {
      return false;
    }
  }
  return true;
}
