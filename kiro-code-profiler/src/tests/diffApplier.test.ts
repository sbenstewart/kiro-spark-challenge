import { describe, expect, it } from 'vitest';
import { applyUnifiedDiff } from '../diffApplier';

// ---------------------------------------------------------------------------
// Unit tests for DiffApplier
// ---------------------------------------------------------------------------

describe('applyUnifiedDiff — basic patch application', () => {
  it('applies a simple single-line replacement', () => {
    const original = 'line1\nline2\nline3\n';
    const diff = `--- a/file
+++ b/file
@@ -2,1 +2,1 @@
-line2
+LINE2
`;
    const result = applyUnifiedDiff(original, diff);
    expect(result).toBe('line1\nLINE2\nline3\n');
  });

  it('applies a hunk with context lines', () => {
    const original = 'a\nb\nc\nd\ne\n';
    const diff = `--- a/file
+++ b/file
@@ -2,3 +2,3 @@
 b
-c
+C
 d
`;
    const result = applyUnifiedDiff(original, diff);
    expect(result).toBe('a\nb\nC\nd\ne\n');
  });

  it('applies a pure insertion hunk', () => {
    const original = 'first\nlast\n';
    const diff = `--- a/file
+++ b/file
@@ -1,1 +1,2 @@
 first
+middle
`;
    const result = applyUnifiedDiff(original, diff);
    expect(result).toBe('first\nmiddle\nlast\n');
  });

  it('applies a pure deletion hunk', () => {
    const original = 'keep\ndelete_me\nkeep2\n';
    const diff = `--- a/file
+++ b/file
@@ -1,3 +1,2 @@
 keep
-delete_me
 keep2
`;
    const result = applyUnifiedDiff(original, diff);
    expect(result).toBe('keep\nkeep2\n');
  });

  it('applies multiple hunks in sequence', () => {
    const original = 'a\nb\nc\nd\ne\nf\ng\n';
    const diff = `--- a/file
+++ b/file
@@ -1,1 +1,1 @@
-a
+A
@@ -7,1 +7,1 @@
-g
+G
`;
    const result = applyUnifiedDiff(original, diff);
    expect(result).toBe('A\nb\nc\nd\ne\nf\nG\n');
  });

  it('returns original unchanged for an empty diff', () => {
    const original = 'hello\nworld\n';
    const result = applyUnifiedDiff(original, '');
    expect(result).toBe('hello\nworld\n');
  });

  it('returns original unchanged for a diff with only headers and no hunks', () => {
    const original = 'hello\nworld\n';
    const diff = '--- a/file\n+++ b/file\n';
    const result = applyUnifiedDiff(original, diff);
    expect(result).toBe('hello\nworld\n');
  });
});

describe('applyUnifiedDiff — null on non-matching diff', () => {
  it('returns null when context lines do not match', () => {
    const original = 'line1\nline2\nline3\n';
    const diff = `--- a/file
+++ b/file
@@ -1,1 +1,1 @@
-doesNotExist
+replacement
`;
    expect(applyUnifiedDiff(original, diff)).toBeNull();
  });

  it('returns null when removed line is not present', () => {
    const original = 'foo\nbar\n';
    const diff = `--- a/file
+++ b/file
@@ -1,1 +1,1 @@
-baz
+qux
`;
    expect(applyUnifiedDiff(original, diff)).toBeNull();
  });

  it('returns null when diff references lines beyond file length', () => {
    const original = 'only one line\n';
    const diff = `--- a/file
+++ b/file
@@ -10,1 +10,1 @@
-nonexistent
+replacement
`;
    expect(applyUnifiedDiff(original, diff)).toBeNull();
  });
});

describe('applyUnifiedDiff — edge cases', () => {
  it('handles files without trailing newline', () => {
    const original = 'line1\nline2';
    const diff = `--- a/file
+++ b/file
@@ -2,1 +2,1 @@
-line2
+LINE2
`;
    const result = applyUnifiedDiff(original, diff);
    expect(result).toBe('line1\nLINE2');
  });

  it('handles single-line file replacement', () => {
    const original = 'hello';
    const diff = `--- a/file
+++ b/file
@@ -1,1 +1,1 @@
-hello
+world
`;
    const result = applyUnifiedDiff(original, diff);
    expect(result).toBe('world');
  });

  it('applies diff that adds lines at the end of file', () => {
    const original = 'line1\nline2\n';
    const diff = `--- a/file
+++ b/file
@@ -2,1 +2,2 @@
 line2
+line3
`;
    const result = applyUnifiedDiff(original, diff);
    expect(result).toBe('line1\nline2\nline3\n');
  });
});
