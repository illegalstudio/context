/**
 * Interactive prompt with @ autocomplete for files and symbols
 * Uses dynamic SQL queries instead of caching for efficiency
 */

import * as readline from 'readline';
import { ContextDatabase } from '../../storage/Database.js';
import { logger } from './logger.js';

interface CompletionItem {
  value: string;
  type: 'file' | 'symbol';
  display: string;
  fullPath?: string;
}

export class InteractivePrompt {
  private db: ContextDatabase;
  private rl: readline.Interface | null = null;

  constructor(db: ContextDatabase) {
    this.db = db;
  }

  /**
   * Search files by partial name (dynamic query)
   */
  private searchFiles(query: string, limit: number = 15): CompletionItem[] {
    if (!query || query.length < 1) {
      // Show recent/common files when no query
      const stmt = this.db.getDb().prepare(`
        SELECT path FROM files
        WHERE path NOT LIKE '%/vendor/%'
          AND path NOT LIKE '%/node_modules/%'
        ORDER BY mtime DESC
        LIMIT ?
      `);
      const rows = stmt.all(limit) as { path: string }[];
      return rows.map(row => ({
        value: row.path.split('/').pop() || row.path,
        type: 'file' as const,
        display: this.formatFileDisplay(row.path),
        fullPath: row.path,
      }));
    }

    const queryLower = query.toLowerCase();

    // Search by basename first (exact start), then contains
    const stmt = this.db.getDb().prepare(`
      SELECT path,
        CASE
          WHEN LOWER(SUBSTR(path, -LENGTH(path) + INSTR(path || '/', '/') - 1)) LIKE ? || '%' THEN 1
          WHEN LOWER(path) LIKE '%' || ? || '%' THEN 2
          ELSE 3
        END as match_rank
      FROM files
      WHERE LOWER(path) LIKE '%' || ? || '%'
        AND path NOT LIKE '%/vendor/%'
        AND path NOT LIKE '%/node_modules/%'
      ORDER BY match_rank, LENGTH(path)
      LIMIT ?
    `);

    const rows = stmt.all(queryLower, queryLower, queryLower, limit) as { path: string }[];

    return rows.map(row => ({
      value: row.path.split('/').pop() || row.path,
      type: 'file' as const,
      display: this.formatFileDisplay(row.path),
      fullPath: row.path,
    }));
  }

  /**
   * Search symbols by partial name (dynamic query)
   */
  private searchSymbols(query: string, limit: number = 10): CompletionItem[] {
    if (!query || query.length < 2) {
      return []; // Require at least 2 chars for symbol search
    }

    const queryLower = query.toLowerCase();

    try {
      const stmt = this.db.getDb().prepare(`
        SELECT DISTINCT name, file_path,
          CASE
            WHEN LOWER(name) LIKE ? || '%' THEN 1
            WHEN LOWER(name) LIKE '%' || ? || '%' THEN 2
            ELSE 3
          END as match_rank
        FROM symbols
        WHERE LOWER(name) LIKE '%' || ? || '%'
          AND kind IN ('class', 'function', 'method', 'trait', 'interface')
        ORDER BY match_rank, LENGTH(name)
        LIMIT ?
      `);

      const rows = stmt.all(queryLower, queryLower, queryLower, limit) as { name: string; file_path: string }[];

      return rows.map(row => ({
        value: row.name,
        type: 'symbol' as const,
        display: `${row.name} (${row.file_path.split('/').pop()})`,
        fullPath: row.file_path,
      }));
    } catch {
      // Symbol table might not exist
      return [];
    }
  }

  /**
   * Format file path for display
   */
  private formatFileDisplay(filePath: string): string {
    const parts = filePath.split('/');
    const basename = parts.pop() || '';

    if (parts.length <= 2) {
      return filePath;
    }

    // Show last 2 directories + filename
    return `.../${parts.slice(-2).join('/')}/${basename}`;
  }

  /**
   * Get completions for the current input
   */
  private getCompletions(line: string): CompletionItem[] {
    // Find the last @ in the line
    const lastAtIndex = line.lastIndexOf('@');
    if (lastAtIndex === -1) return [];

    const afterAt = line.slice(lastAtIndex + 1);

    // Search both files and symbols
    const fileResults = this.searchFiles(afterAt, 12);
    const symbolResults = this.searchSymbols(afterAt, 8);

    // Merge and sort: prefer exact prefix matches
    const all = [...fileResults, ...symbolResults];

    all.sort((a, b) => {
      const query = afterAt.toLowerCase();
      const aStarts = a.value.toLowerCase().startsWith(query);
      const bStarts = b.value.toLowerCase().startsWith(query);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      // Files before symbols for same match quality
      if (a.type !== b.type) return a.type === 'file' ? -1 : 1;
      return a.value.length - b.value.length;
    });

    return all.slice(0, 15);
  }

  /**
   * Completer function for readline
   */
  private completer(line: string): [string[], string] {
    const lastAtIndex = line.lastIndexOf('@');

    if (lastAtIndex === -1) {
      return [[], line];
    }

    const afterAt = line.slice(lastAtIndex + 1);
    const completions = this.getCompletions(line);

    if (completions.length === 0) {
      return [[], line];
    }

    // Return values that can complete the current input
    const hits = completions.map(c => c.value);
    return [hits, afterAt];
  }

  /**
   * Display completion suggestions to the user
   */
  private displayCompletions(completions: CompletionItem[]): void {
    if (completions.length === 0) {
      logger.dim('  No matches found');
      return;
    }

    console.log(); // New line
    for (const item of completions.slice(0, 12)) {
      const typeIcon = item.type === 'file' ? '📄' : '⚡';
      logger.dim(`  ${typeIcon} ${item.display}`);
    }
    if (completions.length > 12) {
      logger.dim(`  ... and ${completions.length - 12} more`);
    }
  }

  /**
   * Prompt for task input with autocomplete
   */
  async promptTask(): Promise<string> {
    return new Promise((resolve, reject) => {
      // Enable keypress events
      if (process.stdin.isTTY) {
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
      }

      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: (line: string) => this.completer(line),
        terminal: true,
      });

      logger.blank();
      logger.bold('Enter your task:');
      logger.dim('  Use @ to reference files/symbols (e.g., @User.php @handlePayment)');
      logger.dim('  Press Tab for suggestions, Enter to submit');
      logger.blank();

      let currentLine = '';

      // Handle keypress for @ detection and Tab completions
      const keypressHandler = (_char: string | undefined, key: readline.Key | undefined) => {
        if (!key) return;

        // Tab key - show completions
        if (key.name === 'tab') {
          // Get current line from readline
          const line = (this.rl as any).line || '';
          const completions = this.getCompletions(line);
          this.displayCompletions(completions);
          // Redraw the prompt
          (this.rl as any)._refreshLine();
        }
      };

      process.stdin.on('keypress', keypressHandler);

      this.rl.on('line', (line: string) => {
        currentLine = line;
        process.stdin.removeListener('keypress', keypressHandler);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }

        if (line.trim()) {
          this.rl?.close();
          resolve(line.trim());
        } else {
          logger.warning('Task cannot be empty.');
          this.rl?.prompt();
        }
      });

      this.rl.on('close', () => {
        process.stdin.removeListener('keypress', keypressHandler);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        resolve(currentLine.trim());
      });

      this.rl.on('error', (err) => {
        process.stdin.removeListener('keypress', keypressHandler);
        reject(err);
      });

      this.rl.setPrompt('> ');
      this.rl.prompt();
    });
  }

  /**
   * Parse @ references from the task string
   */
  parseReferences(task: string): {
    task: string;
    files: string[];
    symbols: string[];
  } {
    const files: string[] = [];
    const symbols: string[] = [];

    // Find all @references
    const refPattern = /@([\w\-.]+(?:\.[\w]+)?)/g;
    let match;

    while ((match = refPattern.exec(task)) !== null) {
      const ref = match[1];

      // Check if it looks like a file (has extension)
      if (/\.\w+$/.test(ref)) {
        // Search for the file
        const fileResults = this.searchFiles(ref, 1);
        if (fileResults.length > 0 && fileResults[0].fullPath) {
          files.push(fileResults[0].fullPath);
        }
      } else {
        // Search for symbol
        const symbolResults = this.searchSymbols(ref, 1);
        if (symbolResults.length > 0) {
          symbols.push(symbolResults[0].value);
        } else {
          // Maybe it's a file without extension, try file search
          const fileResults = this.searchFiles(ref, 1);
          if (fileResults.length > 0 && fileResults[0].fullPath) {
            files.push(fileResults[0].fullPath);
          }
        }
      }
    }

    return { task, files, symbols };
  }

  /**
   * Close the prompt
   */
  close(): void {
    this.rl?.close();
  }
}

/**
 * Simple prompt without autocomplete (fallback for non-TTY)
 */
export async function simplePrompt(message: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
