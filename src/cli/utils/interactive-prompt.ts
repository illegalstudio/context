/**
 * Interactive prompt with live @ autocomplete for files and symbols
 * Shows suggestions in real-time as user types (like Claude Code)
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

// ANSI escape codes
const ANSI = {
  clearLine: '\x1b[2K',
  clearDown: '\x1b[J',
  cursorUp: (n: number) => `\x1b[${n}A`,
  cursorDown: (n: number) => `\x1b[${n}B`,
  cursorToColumn: (n: number) => `\x1b[${n}G`,
  saveCursor: '\x1b[s',
  restoreCursor: '\x1b[u',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
};

export class InteractivePrompt {
  private db: ContextDatabase;
  private input: string = '';
  private cursorPos: number = 0;
  private suggestions: CompletionItem[] = [];
  private selectedIndex: number = 0;
  private showingSuggestions: boolean = false;
  private suggestionsDisplayed: number = 0;

  constructor(db: ContextDatabase) {
    this.db = db;
  }

  /**
   * Search files by partial name (dynamic query)
   */
  private searchFiles(query: string, limit: number = 10): CompletionItem[] {
    const queryLower = query.toLowerCase();

    try {
      const stmt = this.db.getDb().prepare(`
        SELECT path FROM files
        WHERE LOWER(path) LIKE '%' || ? || '%'
          AND path NOT LIKE '%/vendor/%'
          AND path NOT LIKE '%/node_modules/%'
        ORDER BY
          CASE WHEN LOWER(path) LIKE '%/' || ? || '%' THEN 0 ELSE 1 END,
          LENGTH(path)
        LIMIT ?
      `);

      const rows = stmt.all(queryLower, queryLower, limit) as { path: string }[];

      return rows.map(row => ({
        value: row.path.split('/').pop() || row.path,
        type: 'file' as const,
        display: this.formatPath(row.path),
        fullPath: row.path,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Search symbols by partial name (dynamic query)
   */
  private searchSymbols(query: string, limit: number = 8): CompletionItem[] {
    if (query.length < 2) return [];

    const queryLower = query.toLowerCase();

    try {
      const stmt = this.db.getDb().prepare(`
        SELECT DISTINCT name, file_path FROM symbols
        WHERE LOWER(name) LIKE '%' || ? || '%'
          AND kind IN ('class', 'function', 'method', 'trait', 'interface')
        ORDER BY
          CASE WHEN LOWER(name) LIKE ? || '%' THEN 0 ELSE 1 END,
          LENGTH(name)
        LIMIT ?
      `);

      const rows = stmt.all(queryLower, queryLower, limit) as { name: string; file_path: string }[];

      return rows.map(row => ({
        value: row.name,
        type: 'symbol' as const,
        display: `${row.name} (${row.file_path.split('/').pop()})`,
        fullPath: row.file_path,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Format path for display (show last parts)
   */
  private formatPath(filePath: string): string {
    const parts = filePath.split('/');
    if (parts.length <= 3) return filePath;
    return parts.slice(-3).join('/');
  }

  /**
   * Get the current @ query from input
   */
  private getAtQuery(): string | null {
    // Find the last @ before cursor
    const beforeCursor = this.input.slice(0, this.cursorPos);
    const lastAtIndex = beforeCursor.lastIndexOf('@');

    if (lastAtIndex === -1) return null;

    // Check if there's a space between @ and cursor
    const afterAt = beforeCursor.slice(lastAtIndex + 1);
    if (afterAt.includes(' ')) return null;

    return afterAt;
  }

  /**
   * Update suggestions based on current input
   */
  private updateSuggestions(): void {
    const query = this.getAtQuery();

    if (query === null) {
      this.suggestions = [];
      this.showingSuggestions = false;
      return;
    }

    // Search both files and symbols
    const files = this.searchFiles(query, 8);
    const symbols = this.searchSymbols(query, 6);

    this.suggestions = [...files, ...symbols].slice(0, 10);
    this.showingSuggestions = this.suggestions.length > 0;
    this.selectedIndex = 0;
  }

  /**
   * Clear the suggestions display
   */
  private clearSuggestions(): void {
    if (this.suggestionsDisplayed > 0) {
      // Move to start of suggestions and clear
      process.stdout.write(ANSI.saveCursor);
      process.stdout.write('\n'); // Move past current line
      for (let i = 0; i < this.suggestionsDisplayed; i++) {
        process.stdout.write(ANSI.clearLine + '\n');
      }
      // Move back up
      process.stdout.write(ANSI.cursorUp(this.suggestionsDisplayed + 1));
      process.stdout.write(ANSI.restoreCursor);
      this.suggestionsDisplayed = 0;
    }
  }

  /**
   * Render the suggestions below the input
   */
  private renderSuggestions(): void {
    this.clearSuggestions();

    if (!this.showingSuggestions || this.suggestions.length === 0) {
      return;
    }

    // Save cursor, move down, render suggestions
    process.stdout.write(ANSI.saveCursor);
    process.stdout.write('\n');

    for (let i = 0; i < this.suggestions.length; i++) {
      const item = this.suggestions[i];
      const prefix = i === this.selectedIndex ? `${ANSI.cyan}+ ` : `${ANSI.dim}+ `;
      const icon = item.type === 'file' ? '' : '';
      process.stdout.write(`${ANSI.clearLine}${prefix}${item.display}${ANSI.reset}\n`);
    }

    this.suggestionsDisplayed = this.suggestions.length;

    // Restore cursor position
    process.stdout.write(ANSI.cursorUp(this.suggestionsDisplayed + 1));
    process.stdout.write(ANSI.restoreCursor);
  }

  /**
   * Render the input line
   */
  private renderInput(): void {
    process.stdout.write(`\r${ANSI.clearLine}> ${this.input}`);
    // Position cursor correctly
    const cursorOffset = this.input.length - this.cursorPos;
    if (cursorOffset > 0) {
      process.stdout.write(`\x1b[${cursorOffset}D`);
    }
  }

  /**
   * Delete the word before the cursor
   */
  private deleteWordBackward(): void {
    if (this.cursorPos === 0) return;

    // Find the start of the word to delete
    let pos = this.cursorPos - 1;

    // Skip trailing spaces
    while (pos > 0 && this.input[pos] === ' ') {
      pos--;
    }

    // Skip non-space characters (the word)
    while (pos > 0 && this.input[pos - 1] !== ' ') {
      pos--;
    }

    // Delete from pos to cursorPos
    this.input = this.input.slice(0, pos) + this.input.slice(this.cursorPos);
    this.cursorPos = pos;

    this.clearSuggestions();
    this.renderInput();
    this.updateSuggestions();
    this.renderSuggestions();
  }

  /**
   * Apply the selected suggestion
   */
  private applySuggestion(): void {
    if (!this.showingSuggestions || this.suggestions.length === 0) return;

    const selected = this.suggestions[this.selectedIndex];
    const query = this.getAtQuery();

    if (query === null) return;

    // Find where the @ query starts
    const beforeCursor = this.input.slice(0, this.cursorPos);
    const lastAtIndex = beforeCursor.lastIndexOf('@');

    // Replace @query with @value
    const before = this.input.slice(0, lastAtIndex + 1);
    const after = this.input.slice(this.cursorPos);
    this.input = before + selected.value + after;
    this.cursorPos = lastAtIndex + 1 + selected.value.length;

    this.showingSuggestions = false;
    this.suggestions = [];
  }

  /**
   * Prompt for task input with live autocomplete
   */
  async promptTask(): Promise<string> {
    return new Promise((resolve) => {
      // Show instructions
      logger.blank();
      logger.bold('Enter your task:');
      logger.dim('  Use @ to reference files/symbols (autocomplete appears as you type)');
      logger.dim('  Arrow keys to select, Tab/Enter to complete, Enter to submit');
      logger.blank();

      process.stdout.write('> ');

      // Enable raw mode
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const handleKey = (key: Buffer) => {
        const char = key.toString();
        const code = key[0];

        // Ctrl+C - exit
        if (code === 3) {
          this.clearSuggestions();
          process.stdout.write('\n');
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdin.removeListener('data', handleKey);
          resolve('');
          return;
        }

        // Enter
        if (code === 13) {
          if (this.showingSuggestions && this.suggestions.length > 0) {
            // Apply suggestion
            this.applySuggestion();
            this.clearSuggestions();
            this.renderInput();
            this.updateSuggestions();
            this.renderSuggestions();
          } else {
            // Submit
            this.clearSuggestions();
            process.stdout.write('\n');
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            process.stdin.removeListener('data', handleKey);
            resolve(this.input.trim());
          }
          return;
        }

        // Tab - apply suggestion
        if (code === 9) {
          if (this.showingSuggestions && this.suggestions.length > 0) {
            this.applySuggestion();
            this.clearSuggestions();
            this.renderInput();
            this.updateSuggestions();
            this.renderSuggestions();
          }
          return;
        }

        // Backspace
        if (code === 127) {
          if (this.cursorPos > 0) {
            this.input = this.input.slice(0, this.cursorPos - 1) + this.input.slice(this.cursorPos);
            this.cursorPos--;
            this.clearSuggestions();
            this.renderInput();
            this.updateSuggestions();
            this.renderSuggestions();
          }
          return;
        }

        // Ctrl+W - delete word backward
        if (code === 23) {
          this.deleteWordBackward();
          return;
        }

        // Escape sequences (arrows, etc.)
        if (code === 27) {
          // Alt+Backspace (ESC + DEL = \x1b\x7f)
          if (key[1] === 127) {
            this.deleteWordBackward();
            return;
          }

          // Arrow keys: \x1b[A (up), \x1b[B (down), \x1b[C (right), \x1b[D (left)
          if (key[1] === 91) {
            if (key[2] === 65) {
              // Up arrow
              if (this.showingSuggestions && this.selectedIndex > 0) {
                this.selectedIndex--;
                this.renderSuggestions();
              }
              return;
            }
            if (key[2] === 66) {
              // Down arrow
              if (this.showingSuggestions && this.selectedIndex < this.suggestions.length - 1) {
                this.selectedIndex++;
                this.renderSuggestions();
              }
              return;
            }
            if (key[2] === 67) {
              // Right arrow
              if (this.cursorPos < this.input.length) {
                this.cursorPos++;
                this.renderInput();
              }
              return;
            }
            if (key[2] === 68) {
              // Left arrow
              if (this.cursorPos > 0) {
                this.cursorPos--;
                this.renderInput();
              }
              return;
            }
          }
          // Escape - close suggestions
          this.showingSuggestions = false;
          this.clearSuggestions();
          return;
        }

        // Regular character
        if (code >= 32 && code < 127) {
          this.input = this.input.slice(0, this.cursorPos) + char + this.input.slice(this.cursorPos);
          this.cursorPos++;
          this.clearSuggestions();
          this.renderInput();
          this.updateSuggestions();
          this.renderSuggestions();
        }
      };

      process.stdin.on('data', handleKey);
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

    const refPattern = /@([\w\-.]+(?:\.[\w]+)?)/g;
    let match;

    while ((match = refPattern.exec(task)) !== null) {
      const ref = match[1];

      if (/\.\w+$/.test(ref)) {
        const fileResults = this.searchFiles(ref, 1);
        if (fileResults.length > 0 && fileResults[0].fullPath) {
          files.push(fileResults[0].fullPath);
        }
      } else {
        const symbolResults = this.searchSymbols(ref, 1);
        if (symbolResults.length > 0) {
          symbols.push(symbolResults[0].value);
        } else {
          const fileResults = this.searchFiles(ref, 1);
          if (fileResults.length > 0 && fileResults[0].fullPath) {
            files.push(fileResults[0].fullPath);
          }
        }
      }
    }

    return { task, files, symbols };
  }

  close(): void {
    // Nothing to close
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
