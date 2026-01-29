import fs from 'fs';
import type { StacktraceEntry } from '../../types/index.js';

// Stacktrace patterns for different languages/frameworks
const PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  extract: (match: RegExpMatchArray) => StacktraceEntry | null;
}> = [
  // PHP / Laravel
  {
    name: 'php-laravel',
    pattern: /#\d+\s+(.+?)\((\d+)\):\s*(.+)?/g,
    extract: (match) => ({
      file: match[1].replace(/^.*?(?=app\/|vendor\/|tests\/)/, ''),
      line: parseInt(match[2], 10),
      function: match[3],
    }),
  },
  // PHP exception
  {
    name: 'php-exception',
    pattern: /(?:in\s+)?(\S+\.php)(?:\s+)?(?:on\s+)?line\s+(\d+)/gi,
    extract: (match) => ({
      file: match[1],
      line: parseInt(match[2], 10),
    }),
  },
  // JavaScript/Node.js
  {
    name: 'javascript',
    pattern: /at\s+(?:(.+?)\s+\()?((?:\/[^:)]+|[A-Z]:\\[^:)]+|file:\/\/[^:)]+)):(\d+)(?::(\d+))?\)?/gi,
    extract: (match) => ({
      file: match[2].replace(/^.*?(?=src\/|dist\/|node_modules\/|tests?\/)/, '').replace('file://', ''),
      line: parseInt(match[3], 10),
      column: match[4] ? parseInt(match[4], 10) : undefined,
      function: match[1],
    }),
  },
  // Python
  {
    name: 'python',
    pattern: /File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?/gi,
    extract: (match) => ({
      file: match[1].replace(/^.*?(?=app\/|src\/|tests?\/)/, ''),
      line: parseInt(match[2], 10),
      function: match[3],
    }),
  },
  // Ruby
  {
    name: 'ruby',
    pattern: /(\S+\.rb):(\d+)(?::in\s+`(.+)')?/gi,
    extract: (match) => ({
      file: match[1],
      line: parseInt(match[2], 10),
      function: match[3],
    }),
  },
  // Go
  {
    name: 'go',
    pattern: /(\S+\.go):(\d+)(?:\s+\+0x[0-9a-f]+)?(?:\s+(.+))?/gi,
    extract: (match) => ({
      file: match[1],
      line: parseInt(match[2], 10),
      function: match[3],
    }),
  },
  // Java
  {
    name: 'java',
    pattern: /at\s+([\w.$]+)\(([\w]+\.java):(\d+)\)/gi,
    extract: (match) => ({
      file: match[1].replace(/\./g, '/') + '.java',
      line: parseInt(match[3], 10),
      function: match[1].split('.').pop(),
    }),
  },
  // Rust
  {
    name: 'rust',
    pattern: /(\S+\.rs):(\d+)(?::(\d+))?/gi,
    extract: (match) => ({
      file: match[1],
      line: parseInt(match[2], 10),
      column: match[3] ? parseInt(match[3], 10) : undefined,
    }),
  },
  // Generic file:line pattern
  {
    name: 'generic',
    pattern: /([\/\w.-]+\.\w+):(\d+)(?::(\d+))?/g,
    extract: (match) => {
      const ext = match[1].split('.').pop()?.toLowerCase();
      const validExts = ['php', 'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'vue', 'svelte'];
      if (!ext || !validExts.includes(ext)) {
        return null;
      }
      return {
        file: match[1],
        line: parseInt(match[2], 10),
        column: match[3] ? parseInt(match[3], 10) : undefined,
      };
    },
  },
];

// Error message patterns
const ERROR_PATTERNS = [
  // PHP
  /(?:Fatal|Parse|Syntax)\s+error:\s*(.+?)(?:\s+in\s+|$)/gi,
  /(?:Exception|Error):\s*(.+?)(?:\s+in\s+|$)/gi,
  // JavaScript
  /(?:TypeError|ReferenceError|SyntaxError|RangeError|Error):\s*(.+?)(?:\s+at\s+|$)/gi,
  /Uncaught\s+(?:\w+:\s*)?(.+?)(?:\s+at\s+|$)/gi,
  // Python
  /(?:\w+Error|\w+Exception):\s*(.+?)$/gim,
  // Generic
  /(?:error|exception|fatal|failed)[\s:]+(.+?)$/gim,
];

export class StacktraceParser {
  async parseFromFile(filePath: string, since?: string): Promise<StacktraceEntry[]> {
    try {
      let content = await fs.promises.readFile(filePath, 'utf-8');

      // If 'since' is provided, try to filter by timestamp
      if (since) {
        content = this.filterBySince(content, since);
      }

      return this.parse(content);
    } catch (error) {
      throw new Error(`Failed to read log file: ${error}`);
    }
  }

  parse(content: string): StacktraceEntry[] {
    const entries: StacktraceEntry[] = [];
    const seenFiles = new Set<string>();

    // Try each pattern
    for (const { pattern, extract } of PATTERNS) {
      // Reset regex state
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        const entry = extract(match);
        if (entry && entry.file && entry.line) {
          // Normalize file path
          entry.file = this.normalizePath(entry.file);

          // Skip duplicates and vendor/node_modules
          const key = `${entry.file}:${entry.line}`;
          if (!seenFiles.has(key) && !this.isExternalFile(entry.file)) {
            seenFiles.add(key);
            entries.push(entry);
          }
        }
      }
    }

    // Extract error messages
    const messages = this.extractErrorMessages(content);
    if (messages.length > 0 && entries.length > 0) {
      // Attach first message to first entry
      entries[0].message = messages[0];
    }

    return entries;
  }

  extractErrorMessages(content: string): string[] {
    const messages: string[] = [];
    const seen = new Set<string>();

    for (const pattern of ERROR_PATTERNS) {
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        const message = match[1].trim();
        if (message.length > 5 && message.length < 500 && !seen.has(message)) {
          seen.add(message);
          messages.push(message);
        }
      }
    }

    return messages;
  }

  private normalizePath(filePath: string): string {
    // Remove common prefixes
    return filePath
      .replace(/^.*?(?=[a-z]+\/)/i, '') // Remove up to first lowercase dir
      .replace(/^\/+/, '') // Remove leading slashes
      .replace(/\\/g, '/'); // Normalize to forward slashes
  }

  private isExternalFile(filePath: string): boolean {
    const external = [
      'node_modules/',
      'vendor/',
      '.phar',
      '/usr/',
      '/opt/',
      'site-packages/',
      '.gem/',
    ];
    return external.some(e => filePath.includes(e));
  }

  private filterBySince(content: string, since: string): string {
    // Parse 'since' (e.g., "1h", "2h", "30m", "1d")
    const match = since.match(/^(\d+)([hmd])$/);
    if (!match) {
      return content;
    }

    const amount = parseInt(match[1], 10);
    const unit = match[2];

    let milliseconds: number;
    switch (unit) {
      case 'm':
        milliseconds = amount * 60 * 1000;
        break;
      case 'h':
        milliseconds = amount * 60 * 60 * 1000;
        break;
      case 'd':
        milliseconds = amount * 24 * 60 * 60 * 1000;
        break;
      default:
        return content;
    }

    const cutoffTime = new Date(Date.now() - milliseconds);

    // Try to filter by common log timestamp patterns
    const lines = content.split('\n');
    const filteredLines: string[] = [];
    let includeRest = false;

    for (const line of lines) {
      // Look for timestamp patterns
      const timestampPatterns = [
        // ISO 8601
        /(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/,
        // Common log format
        /\[(\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2})/,
        // Laravel style
        /\[(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})\]/,
      ];

      let lineTime: Date | null = null;
      for (const pattern of timestampPatterns) {
        const match = line.match(pattern);
        if (match) {
          lineTime = new Date(match[1].replace(/\//g, '-').replace('T', ' '));
          break;
        }
      }

      if (lineTime && !isNaN(lineTime.getTime())) {
        includeRest = lineTime >= cutoffTime;
      }

      if (includeRest || !lineTime) {
        filteredLines.push(line);
      }
    }

    return filteredLines.join('\n');
  }
}
