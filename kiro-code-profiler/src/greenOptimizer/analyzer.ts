import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { AnalyzerResult, DetectedPattern, SkippedFile } from "./types";

const SUPPORTED_EXTENSIONS = [".ts", ".js", ".tsx", ".jsx"];

export class GreenAnalyzer {
  getSupportedExtensions(): string[] {
    return [...SUPPORTED_EXTENSIONS];
  }

  async analyze(filePaths: string[]): Promise<AnalyzerResult> {
    const patterns: DetectedPattern[] = [];
    const skippedFiles: SkippedFile[] = [];
    let scannedFileCount = 0;

    for (const filePath of filePaths) {
      const ext = path.extname(filePath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        skippedFiles.push({ filePath, reason: "unsupported file type" });
        continue;
      }

      let content: string;
      try { content = const content = fs.readFileSync(filePath, "utf-8"); } catch {
        skippedFiles.push({ filePath, reason: "unable to read file" });
        continue;
      }

      let sourceFile: ts.SourceFile;
      try {
        const kind = ext === ".tsx" ? ts.ScriptKind.TSX : ext === ".jsx" ? ts.ScriptKind.JSX : ext === ".ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS;
        sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, kind);
      } catch {
        skippedFiles.push({ filePath, reason: "parse error" });
        continue;
      }

      scannedFileCount++;
      this.detectPatterns(sourceFile, content, filePath, patterns);
    }

    return { patterns, skippedFiles, scannedFileCount };
  }

  private detectPatterns(sourceFile: ts.SourceFile, content: string, filePath: string, results: DetectedPattern[]): void {
    const visit = (node: ts.Node): void => {
      this.checkAlgorithmicInefficiency(node, sourceFile, content, filePath, results);
      this.checkRedundantAllocation(node, sourceFile, content, filePath, results);
      this.checkUnnecessaryIO(node, sourceFile, content, filePath, results);
      this.checkInefficientLoop(node, sourceFile, content, filePath, results);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  private getLines(sf: ts.SourceFile, node: ts.Node) {
    return {
      startLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
    };
  }

  private getCode(content: string, sf: ts.SourceFile, node: ts.Node): string {
    return content.substring(node.getStart(sf), node.getEnd());
  }

  private isLoop(node: ts.Node): boolean {
    return ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node);
  }

  private insideLoop(node: ts.Node): boolean {
    let c = node.parent;
    while (c) { if (this.isLoop(c)) return true; c = c.parent; }
    return false;
  }

  private isMethodCall(node: ts.CallExpression, names: string[]): boolean {
    if (ts.isPropertyAccessExpression(node.expression)) return names.includes(node.expression.name.text);
    return false;
  }

  private isDottedCall(node: ts.CallExpression, patterns: string[]): boolean {
    if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
      return patterns.includes(`${node.expression.expression.text}.${node.expression.name.text}`);
    }
    return false;
  }

  private checkAlgorithmicInefficiency(node: ts.Node, sf: ts.SourceFile, content: string, filePath: string, results: DetectedPattern[]): void {
    if (!this.isLoop(node)) return;
    const outerLoop = node;
    const searchMethods = ["includes", "find", "indexOf", "some"];
    const findNested = (inner: ts.Node): void => {
      if (this.isLoop(inner) && inner !== outerLoop) {
        let found = false;
        const check = (n: ts.Node): void => {
          if (ts.isCallExpression(n) && this.isMethodCall(n, searchMethods)) found = true;
          if (!found) ts.forEachChild(n, check);
        };
        check(inner);
        if (found) {
          const { startLine, endLine } = this.getLines(sf, outerLoop);
          results.push({ patternId: "algo-nested-loop-lookup", category: "algorithmic-inefficiency", filePath, startLine, endLine, description: "Nested loop with linear array search — use a Set/Map for O(1) lookup", confidenceLevel: "high", originalCode: this.getCode(content, sf, outerLoop) });
        }
        return;
      }
      ts.forEachChild(inner, findNested);
    };
    const body = this.getLoopBody(outerLoop);
    if (body) ts.forEachChild(body, findNested);
  }

  private checkRedundantAllocation(node: ts.Node, sf: ts.SourceFile, content: string, filePath: string, results: DetectedPattern[]): void {
    if (!ts.isVariableDeclaration(node) || !this.insideLoop(node)) return;
    const init = node.initializer;
    if (!init) return;
    if (ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init) || ts.isNewExpression(init)) {
      const { startLine, endLine } = this.getLines(sf, node);
      results.push({ patternId: "alloc-object-in-loop", category: "redundant-allocation", filePath, startLine, endLine, description: "Object/array allocation inside loop — hoist outside to avoid repeated allocation", confidenceLevel: "medium", originalCode: this.getCode(content, sf, node) });
    }
  }

  private checkUnnecessaryIO(node: ts.Node, sf: ts.SourceFile, content: string, filePath: string, results: DetectedPattern[]): void {
    if (!ts.isCallExpression(node) || !this.insideLoop(node)) return;
    const fsPatterns = ["fs.readFileSync", "fs.readFile", "fs.writeFileSync", "fs.writeFile"];
    const consolePatterns = ["console.log", "console.warn", "console.error", "console.info"];
    if (this.isDottedCall(node, fsPatterns)) {
      const { startLine, endLine } = this.getLines(sf, node);
      results.push({ patternId: "io-repeated-file-read-in-loop", category: "unnecessary-io", filePath, startLine, endLine, description: "File I/O inside loop — read once before the loop and reuse", confidenceLevel: "high", originalCode: this.getCode(content, sf, node) });
    } else if (this.isDottedCall(node, consolePatterns)) {
      const { startLine, endLine } = this.getLines(sf, node);
      results.push({ patternId: "io-console-log-in-loop", category: "unnecessary-io", filePath, startLine, endLine, description: "Console logging inside loop — batch or remove for production", confidenceLevel: "low", originalCode: this.getCode(content, sf, node) });
    }
  }

  private checkInefficientLoop(node: ts.Node, sf: ts.SourceFile, content: string, filePath: string, results: DetectedPattern[]): void {
    if (!ts.isCallExpression(node)) return;
    if (this.isMethodCall(node, ["forEach"])) {
      const { startLine, endLine } = this.getLines(sf, node);
      results.push({ patternId: "loop-foreach-with-index", category: "inefficient-loop", filePath, startLine, endLine, description: "forEach call — consider for-of for better performance and readability", confidenceLevel: "medium", originalCode: this.getCode(content, sf, node) });
      return;
    }
    // Only flag push inside numeric for-loops (for i=0; i<N; i++), not for-of/for-in/while
    // Error-handling pushes (like skippedFiles.push) inside for-of are intentional
    if (this.isMethodCall(node, ["push"]) && this.insideNumericForLoop(node)) {
      const code = this.getCode(content, sf, node);
      // Skip error-handling pushes (contain "error", "skip", "reason", "warning")
      if (/\b(error|skip|reason|warning|fail|invalid)\b/i.test(code)) return;
      const { startLine, endLine } = this.getLines(sf, node);
      results.push({ patternId: "loop-push-in-loop", category: "inefficient-loop", filePath, startLine, endLine, description: "Array.push inside loop — consider Array.map/filter", confidenceLevel: "medium", originalCode: code });
    }
  }

  /** Check if node is inside a numeric for-loop (for i=0; i<N; i++), not for-of/for-in */
  private insideNumericForLoop(node: ts.Node): boolean {
    let c = node.parent;
    while (c) {
      if (ts.isForStatement(c)) return true;
      if (ts.isForOfStatement(c) || ts.isForInStatement(c)) return false; // intentional iteration
      c = c.parent;
    }
    return false;
  }

  private getLoopBody(node: ts.Node): ts.Node | undefined {
    if (ts.isForStatement(node)) return node.statement;
    if (ts.isForOfStatement(node)) return node.statement;
    if (ts.isForInStatement(node)) return node.statement;
    if (ts.isWhileStatement(node)) return node.statement;
    if (ts.isDoStatement(node)) return node.statement;
    return undefined;
  }
}
