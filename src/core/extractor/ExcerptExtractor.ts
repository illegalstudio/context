import fs from 'fs';
import path from 'path';
import { ContextDatabase } from '../../storage/Database.js';
import type { Excerpt, Candidate, Symbol } from '../../types/index.js';

export interface ExtractionOptions {
  maxLinesPerFile?: number;
  windowSize?: number; // Lines around match to include
  includeFullIfSmall?: boolean;
  smallFileThreshold?: number;
}

export class ExcerptExtractor {
  private rootDir: string;
  private db: ContextDatabase;
  private options: ExtractionOptions;

  constructor(rootDir: string, db: ContextDatabase, options: ExtractionOptions = {}) {
    this.rootDir = rootDir;
    this.db = db;
    this.options = {
      maxLinesPerFile: options.maxLinesPerFile || 300,
      windowSize: options.windowSize || 20,
      includeFullIfSmall: options.includeFullIfSmall !== false,
      smallFileThreshold: options.smallFileThreshold || 200,
    };
  }

  async extractExcerpts(
    candidates: Candidate[],
    highlightLines?: Map<string, number[]>
  ): Promise<Excerpt[]> {
    const excerpts: Excerpt[] = [];

    for (const candidate of candidates) {
      const excerpt = await this.extractFromFile(candidate, highlightLines?.get(candidate.path));
      if (excerpt) {
        excerpts.push(excerpt);
      }
    }

    return excerpts;
  }

  private async extractFromFile(
    candidate: Candidate,
    highlightLines?: number[]
  ): Promise<Excerpt | null> {
    const fullPath = path.join(this.rootDir, candidate.path);

    try {
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      // If file is small enough, include everything
      if (this.options.includeFullIfSmall && totalLines <= this.options.smallFileThreshold!) {
        return {
          path: candidate.path,
          content: content,
          startLine: 1,
          endLine: totalLines,
          totalLines,
          truncated: false,
        };
      }

      // Get symbols for this file to help with extraction
      const symbols = this.db.getSymbolsByFile(candidate.path);

      // Determine which lines to include
      const linesToInclude = this.determineLinesToInclude(
        lines,
        symbols,
        highlightLines,
        candidate.signals
      );

      // Extract content
      const extractedContent = this.extractLines(lines, linesToInclude);
      const startLine = Math.min(...linesToInclude) || 1;
      const endLine = Math.max(...linesToInclude) || totalLines;

      return {
        path: candidate.path,
        content: extractedContent,
        startLine,
        endLine,
        totalLines,
        truncated: linesToInclude.size < totalLines,
      };
    } catch (error) {
      return null;
    }
  }

  private determineLinesToInclude(
    lines: string[],
    symbols: Symbol[],
    highlightLines?: number[],
    signals?: Candidate['signals']
  ): Set<number> {
    const toInclude = new Set<number>();
    const maxLines = this.options.maxLinesPerFile!;
    const windowSize = this.options.windowSize!;

    // Always include file header (imports, package declaration)
    const headerEnd = this.findHeaderEnd(lines);
    for (let i = 1; i <= headerEnd; i++) {
      toInclude.add(i);
    }

    // If we have highlight lines, include windows around them
    if (highlightLines && highlightLines.length > 0) {
      for (const line of highlightLines) {
        this.addWindow(toInclude, line, windowSize, lines.length);
      }
    }

    // If this is a stacktrace or diff hit, prioritize symbol extraction
    if (signals?.stacktraceHit || signals?.diffHit) {
      // Include relevant symbols
      for (const symbol of symbols) {
        if (toInclude.size >= maxLines) break;

        // Include the symbol definition
        for (let i = symbol.startLine; i <= symbol.endLine && toInclude.size < maxLines; i++) {
          toInclude.add(i);
        }
      }
    }

    // If we have symbol matches, include those symbols
    if (signals?.symbolMatch && symbols.length > 0) {
      // Sort symbols by relevance (classes first, then functions)
      const sortedSymbols = [...symbols].sort((a, b) => {
        const order = { class: 0, interface: 1, function: 2, method: 3, constant: 4, variable: 5 };
        return (order[a.kind] || 5) - (order[b.kind] || 5);
      });

      for (const symbol of sortedSymbols) {
        if (toInclude.size >= maxLines) break;

        for (let i = symbol.startLine; i <= symbol.endLine && toInclude.size < maxLines; i++) {
          toInclude.add(i);
        }
      }
    }

    // If still under limit, add more content
    if (toInclude.size < maxLines) {
      // Add remaining lines starting from top
      for (let i = 1; i <= lines.length && toInclude.size < maxLines; i++) {
        toInclude.add(i);
      }
    }

    return toInclude;
  }

  private findHeaderEnd(lines: string[]): number {
    let headerEnd = 0;
    let inMultilineComment = false;

    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      const line = lines[i].trim();

      // Track multiline comments
      if (line.includes('/*')) inMultilineComment = true;
      if (line.includes('*/')) inMultilineComment = false;

      // Common header patterns
      if (
        line.startsWith('import ') ||
        line.startsWith('from ') ||
        line.startsWith('require') ||
        line.startsWith('use ') ||
        line.startsWith('namespace ') ||
        line.startsWith('package ') ||
        line.startsWith('<?php') ||
        line.startsWith('//') ||
        line.startsWith('#') ||
        line.startsWith('*') ||
        inMultilineComment ||
        line === ''
      ) {
        headerEnd = i + 1;
      } else if (
        line.startsWith('class ') ||
        line.startsWith('interface ') ||
        line.startsWith('function ') ||
        line.startsWith('const ') ||
        line.startsWith('export ')
      ) {
        // Found first non-header content
        break;
      }
    }

    return Math.max(headerEnd, 10); // At least first 10 lines
  }

  private addWindow(toInclude: Set<number>, centerLine: number, windowSize: number, maxLine: number): void {
    const start = Math.max(1, centerLine - windowSize);
    const end = Math.min(maxLine, centerLine + windowSize);

    for (let i = start; i <= end; i++) {
      toInclude.add(i);
    }
  }

  private extractLines(lines: string[], toInclude: Set<number>): string {
    const sortedLines = [...toInclude].sort((a, b) => a - b);
    const result: string[] = [];
    let lastLine = 0;

    for (const lineNum of sortedLines) {
      // Add ellipsis if there's a gap
      if (lastLine > 0 && lineNum > lastLine + 1) {
        result.push('// ... (lines omitted)');
      }

      const line = lines[lineNum - 1];
      if (line !== undefined) {
        result.push(`${lineNum}: ${line}`);
      }

      lastLine = lineNum;
    }

    return result.join('\n');
  }

  // Extract specific symbol from file
  async extractSymbol(filePath: string, symbolName: string): Promise<string | null> {
    const symbols = this.db.getSymbolsByFile(filePath);
    const symbol = symbols.find(s => s.name === symbolName);

    if (!symbol) {
      return null;
    }

    const fullPath = path.join(this.rootDir, filePath);
    const content = await fs.promises.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');

    const extractedLines: string[] = [];
    for (let i = symbol.startLine; i <= symbol.endLine; i++) {
      const line = lines[i - 1];
      if (line !== undefined) {
        extractedLines.push(`${i}: ${line}`);
      }
    }

    return extractedLines.join('\n');
  }
}
