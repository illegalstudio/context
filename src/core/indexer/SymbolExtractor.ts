import fs from 'fs';
import path from 'path';
import type { Symbol } from '../../types/index.js';

// Regex patterns for common symbol extraction (language-agnostic fallback)
// These are simplified patterns - Tree-sitter would be more accurate

const PATTERNS: Record<string, RegExp[]> = {
  // TypeScript/JavaScript patterns
  typescript: [
    // Class declarations
    /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm,
    // Interface declarations
    /^\s*(?:export\s+)?interface\s+(\w+)/gm,
    // Type declarations
    /^\s*(?:export\s+)?type\s+(\w+)/gm,
    // Function declarations
    /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
    // Arrow function assignments (const foo = () => {})
    /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/gm,
    // Method definitions in class
    /^\s*(?:public|private|protected|static|async)*\s*(\w+)\s*\([^)]*\)\s*(?::\s*\S+)?\s*\{/gm,
  ],
  javascript: [
    /^\s*(?:export\s+)?class\s+(\w+)/gm,
    /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
    /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/gm,
    /^\s*(\w+)\s*\([^)]*\)\s*\{/gm,
  ],
  // PHP patterns
  php: [
    // Class declarations
    /^\s*(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/gm,
    // Interface declarations
    /^\s*interface\s+(\w+)/gm,
    // Trait declarations
    /^\s*trait\s+(\w+)/gm,
    // Function declarations
    /^\s*(?:public|private|protected|static)*\s*function\s+(\w+)/gm,
  ],
  // Python patterns
  python: [
    // Class declarations
    /^\s*class\s+(\w+)/gm,
    // Function/method declarations
    /^\s*(?:async\s+)?def\s+(\w+)/gm,
  ],
  // Go patterns
  go: [
    // Struct declarations
    /^\s*type\s+(\w+)\s+struct/gm,
    // Interface declarations
    /^\s*type\s+(\w+)\s+interface/gm,
    // Function declarations
    /^\s*func\s+(?:\([^)]+\)\s+)?(\w+)/gm,
  ],
  // Rust patterns
  rust: [
    // Struct declarations
    /^\s*(?:pub\s+)?struct\s+(\w+)/gm,
    // Enum declarations
    /^\s*(?:pub\s+)?enum\s+(\w+)/gm,
    // Trait declarations
    /^\s*(?:pub\s+)?trait\s+(\w+)/gm,
    // Impl blocks
    /^\s*impl(?:<[^>]+>)?\s+(\w+)/gm,
    // Function declarations
    /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm,
  ],
  // Ruby patterns
  ruby: [
    // Class declarations
    /^\s*class\s+(\w+)/gm,
    // Module declarations
    /^\s*module\s+(\w+)/gm,
    // Method declarations
    /^\s*def\s+(?:self\.)?(\w+)/gm,
  ],
  // Java patterns
  java: [
    // Class declarations
    /^\s*(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+(\w+)/gm,
    // Interface declarations
    /^\s*(?:public|private|protected)?\s*interface\s+(\w+)/gm,
    // Enum declarations
    /^\s*(?:public|private|protected)?\s*enum\s+(\w+)/gm,
    // Method declarations
    /^\s*(?:public|private|protected)?\s*(?:static)?\s*(?:\w+)\s+(\w+)\s*\([^)]*\)/gm,
  ],
};

// Map similar languages
const LANGUAGE_ALIAS: Record<string, string> = {
  tsx: 'typescript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  kotlin: 'java',
  swift: 'java',
  csharp: 'java',
};

export class SymbolExtractor {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async extractSymbols(filePath: string, language: string): Promise<Symbol[]> {
    const fullPath = path.join(this.rootDir, filePath);

    try {
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      const normalizedLang = LANGUAGE_ALIAS[language] || language;
      const patterns = PATTERNS[normalizedLang];

      if (!patterns) {
        // Fallback: try to detect common patterns
        return this.extractGenericSymbols(filePath, content, lines);
      }

      return this.extractWithPatterns(filePath, content, lines, patterns);
    } catch (error) {
      return [];
    }
  }

  private extractWithPatterns(
    filePath: string,
    content: string,
    lines: string[],
    patterns: RegExp[]
  ): Symbol[] {
    const symbols: Symbol[] = [];
    const seenNames = new Set<string>();

    for (const pattern of patterns) {
      // Reset regex state
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1];

        // Skip if we've seen this name (avoid duplicates)
        if (seenNames.has(name)) continue;

        // Skip common false positives
        if (this.isCommonKeyword(name)) continue;

        seenNames.add(name);

        const startLine = this.getLineNumber(content, match.index);
        const endLine = this.findSymbolEnd(lines, startLine);
        const kind = this.inferKind(match[0], name);
        const signature = this.extractSignature(lines, startLine);

        symbols.push({
          filePath,
          name,
          kind,
          startLine,
          endLine,
          signature,
        });
      }
    }

    return symbols;
  }

  private extractGenericSymbols(
    filePath: string,
    content: string,
    lines: string[]
  ): Symbol[] {
    // Generic pattern for function-like declarations
    const genericPatterns = [
      /^\s*(?:export\s+)?(?:public|private|protected|static|async|def|func|function|fn)?\s*(?:function\s+)?(\w+)\s*\(/gm,
      /^\s*(?:class|struct|interface|trait|enum|type)\s+(\w+)/gm,
    ];

    return this.extractWithPatterns(filePath, content, lines, genericPatterns);
  }

  private getLineNumber(content: string, index: number): number {
    const beforeMatch = content.slice(0, index);
    return beforeMatch.split('\n').length;
  }

  private findSymbolEnd(lines: string[], startLine: number): number {
    // Simple brace/indentation matching to find end of symbol
    let braceCount = 0;
    let foundFirstBrace = false;
    let endLine = startLine;

    for (let i = startLine - 1; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === '{' || char === '(') {
          braceCount++;
          foundFirstBrace = true;
        } else if (char === '}' || char === ')') {
          braceCount--;
        }
      }

      endLine = i + 1;

      if (foundFirstBrace && braceCount === 0) {
        break;
      }

      // Limit search to prevent runaway
      if (i - startLine > 500) {
        break;
      }
    }

    return endLine;
  }

  private inferKind(matchText: string, name: string): Symbol['kind'] {
    const lower = matchText.toLowerCase();

    if (lower.includes('class')) return 'class';
    if (lower.includes('interface')) return 'interface';
    if (lower.includes('struct')) return 'class';
    if (lower.includes('trait')) return 'interface';
    if (lower.includes('enum')) return 'class';
    if (lower.includes('type ')) return 'interface';
    if (lower.includes('const ') || lower.includes('let ') || lower.includes('var ')) {
      if (lower.includes('=>')) return 'function';
      return 'constant';
    }
    if (lower.includes('function') || lower.includes('def ') || lower.includes('func ') || lower.includes(' fn ')) {
      return 'function';
    }

    // Check if it looks like a method (has parentheses)
    if (matchText.includes('(')) {
      return 'method';
    }

    return 'function';
  }

  private extractSignature(lines: string[], startLine: number): string {
    // Get the first line of the symbol as signature
    const line = lines[startLine - 1];
    if (!line) return '';

    // Trim and limit length
    const signature = line.trim();
    if (signature.length > 200) {
      return signature.slice(0, 200) + '...';
    }
    return signature;
  }

  private isCommonKeyword(name: string): boolean {
    const keywords = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
      'return', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'super',
      'import', 'export', 'from', 'as', 'default', 'const', 'let', 'var',
      'true', 'false', 'null', 'undefined', 'void', 'typeof', 'instanceof',
      'in', 'of', 'with', 'yield', 'await', 'async', 'static', 'get', 'set',
      'constructor', 'extends', 'implements', 'private', 'public', 'protected',
    ]);
    return keywords.has(name);
  }
}
