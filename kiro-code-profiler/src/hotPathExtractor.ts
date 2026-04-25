// Graph-based hot-path extraction: parses functions from source, scores by
// cyclomatic complexity proxy, returns top-N to minimize LLM token usage.

export interface ExtractedFunction {
  name: string;
  body: string;
  startLine: number;
  endLine: number;
  complexityScore: number;
}

export interface HotPathResult {
  functions: ExtractedFunction[];
  totalFunctions: number;
  tokensEstimated: number;
  tokensOriginal: number;
  reductionPercent: number;
  context: string; // ready-to-embed source snippet for the LLM prompt
}

const MAX_HOT_FUNCTIONS = 5;
const CHARS_PER_TOKEN = 4;

export function extractHotPath(
  sourceCode: string,
  language: 'javascript' | 'typescript' | 'python'
): HotPathResult {
  const rawFunctions = language === 'python'
    ? extractPythonFunctions(sourceCode)
    : extractJsFunctions(sourceCode);

  const scored: ExtractedFunction[] = rawFunctions.map(f => ({
    ...f,
    complexityScore: scoreComplexity(f.body, language),
  }));

  scored.sort((a, b) => b.complexityScore - a.complexityScore);
  const selected = scored.slice(0, MAX_HOT_FUNCTIONS);

  const tokensOriginal = Math.ceil(sourceCode.length / CHARS_PER_TOKEN);
  const contextParts = selected.map(f =>
    `# Function: ${f.name} (complexity score: ${f.complexityScore}, lines ${f.startLine + 1}–${f.endLine + 1})\n${f.body}`
  );
  const context = contextParts.join('\n\n');
  const tokensEstimated = Math.ceil(context.length / CHARS_PER_TOKEN);
  const reductionPercent = tokensOriginal > 0
    ? Math.round((1 - tokensEstimated / tokensOriginal) * 100)
    : 0;

  return {
    functions: selected,
    totalFunctions: rawFunctions.length,
    tokensEstimated,
    tokensOriginal,
    reductionPercent,
    context,
  };
}

// Cyclomatic complexity proxy: counts branches + loops + nesting depth.
function scoreComplexity(body: string, language: string): number {
  let score = 0;
  const loops = (body.match(/\bfor\b|\bwhile\b/g) || []).length;
  const branches = (body.match(/\bif\b|\belif\b|\belse\b|\bswitch\b|\bcase\b/g) || []).length;
  score += loops * 3;
  score += branches;

  if (language === 'python') {
    score += (body.match(/\brecursion\b/g) || []).length * 2;
    const lines = body.split('\n');
    const maxIndent = Math.max(0, ...lines.map(l => (l.match(/^( *)/)?.[1].length ?? 0)));
    score += Math.floor(maxIndent / 4) * 2;
  } else {
    score += (body.match(/\.forEach|\.map|\.filter|\.reduce|\.flatMap/g) || []).length * 2;
    // Nesting depth via brace counting
    let depth = 0; let maxDepth = 0;
    for (const ch of body) {
      if (ch === '{') { depth++; maxDepth = Math.max(maxDepth, depth); }
      if (ch === '}') { depth = Math.max(0, depth - 1); }
    }
    score += maxDepth * 2;
  }

  score += Math.floor(body.split('\n').length / 10);
  return score;
}

// ── Python ────────────────────────────────────────────────────────────────────

function extractPythonFunctions(source: string): Omit<ExtractedFunction, 'complexityScore'>[] {
  const functions: Omit<ExtractedFunction, 'complexityScore'>[] = [];
  const lines = source.split('\n');
  let i = 0;

  while (i < lines.length) {
    const defMatch = lines[i].match(/^(\s*)def\s+(\w+)\s*\(/);
    if (!defMatch) { i++; continue; }

    const name = defMatch[2];
    const startLine = i;
    const baseIndent = defMatch[1].length;
    let j = i + 1;

    while (j < lines.length) {
      const line = lines[j];
      if (line.trim() === '') { j++; continue; }
      const indent = (line.match(/^( *)/)?.[1].length ?? 0);
      if (indent <= baseIndent) break;
      j++;
    }

    functions.push({ name, body: lines.slice(startLine, j).join('\n'), startLine, endLine: j - 1 });
    i = j;
  }

  return functions;
}

// ── JavaScript / TypeScript ───────────────────────────────────────────────────

function extractJsFunctions(source: string): Omit<ExtractedFunction, 'complexityScore'>[] {
  const functions: Omit<ExtractedFunction, 'complexityScore'>[] = [];
  const lines = source.split('\n');

  // Patterns that start a named function definition
  const patterns: RegExp[] = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\w+\s*=>/,
    /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\S+\s*)?\{/,
  ];

  for (let i = 0; i < lines.length; i++) {
    let name: string | null = null;
    for (const p of patterns) {
      const m = lines[i].match(p);
      if (m?.[1] && m[1] !== 'if' && m[1] !== 'while' && m[1] !== 'for') {
        name = m[1];
        break;
      }
    }
    if (!name) continue;

    const startLine = i;
    let depth = 0;
    let opened = false;
    let j = i;

    outer: while (j < lines.length) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth++; opened = true; }
        if (ch === '}') {
          depth--;
          if (opened && depth === 0) { break outer; }
        }
      }
      j++;
    }

    const endLine = Math.min(j, lines.length - 1);
    const body = lines.slice(startLine, endLine + 1).join('\n');
    functions.push({ name, body, startLine, endLine });
    i = endLine;
  }

  return functions;
}
