import { execSync } from 'child_process';
import type { DiffEntry } from '../../types/index.js';

export interface DiffResult {
  entries: DiffEntry[];
  baseBranch: string;
  currentBranch: string;
  commitRange: string;
}

export class DiffAnalyzer {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async analyze(base: string = 'origin/main'): Promise<DiffResult> {
    // Get current branch
    const currentBranch = this.getCurrentBranch();

    // Determine commit range
    const commitRange = `${base}...HEAD`;

    // Get diff stats
    const entries = this.getDiffEntries(base);

    return {
      entries,
      baseBranch: base,
      currentBranch,
      commitRange,
    };
  }

  private getCurrentBranch(): string {
    try {
      const result = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.rootDir,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      return result.trim();
    } catch {
      return 'HEAD';
    }
  }

  private getDiffEntries(base: string): DiffEntry[] {
    const entries: DiffEntry[] = [];

    try {
      // Get list of changed files with stats
      const result = execSync(
        `git diff --name-status ${base}`,
        { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8' }
      );

      const lines = result.trim().split('\n').filter(l => l.trim());

      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length < 2) continue;

        const statusCode = parts[0].charAt(0);
        const file = parts[parts.length - 1]; // Last part is the file (handles renames)

        let status: DiffEntry['status'];
        switch (statusCode) {
          case 'A':
            status = 'added';
            break;
          case 'D':
            status = 'deleted';
            break;
          case 'R':
            status = 'renamed';
            break;
          case 'M':
          default:
            status = 'modified';
            break;
        }

        // Get line counts
        const stats = this.getFileStats(base, file);

        entries.push({
          file,
          status,
          additions: stats.additions,
          deletions: stats.deletions,
        });
      }
    } catch (error) {
      // Git diff failed, return empty
    }

    return entries;
  }

  private getFileStats(base: string, file: string): { additions: number; deletions: number } {
    try {
      const result = execSync(
        `git diff --numstat ${base} -- "${file}"`,
        { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8' }
      );

      const parts = result.trim().split('\t');
      if (parts.length >= 2) {
        return {
          additions: parseInt(parts[0], 10) || 0,
          deletions: parseInt(parts[1], 10) || 0,
        };
      }
    } catch {
      // Ignore errors
    }

    return { additions: 0, deletions: 0 };
  }

  async getModifiedFiles(base: string = 'origin/main'): Promise<string[]> {
    const result = await this.analyze(base);
    return result.entries
      .filter(e => e.status !== 'deleted')
      .map(e => e.file);
  }

  async getDeletedFiles(base: string = 'origin/main'): Promise<string[]> {
    const result = await this.analyze(base);
    return result.entries
      .filter(e => e.status === 'deleted')
      .map(e => e.file);
  }

  getDiffContent(base: string = 'origin/main'): string {
    try {
      return execSync(
        `git diff ${base}`,
        { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8' }
      );
    } catch {
      return '';
    }
  }

  getFileDiff(file: string, base: string = 'origin/main'): string {
    try {
      return execSync(
        `git diff ${base} -- "${file}"`,
        { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8' }
      );
    } catch {
      return '';
    }
  }

  // Extract changed line numbers from a file
  getChangedLines(file: string, base: string = 'origin/main'): number[] {
    const lines: number[] = [];

    try {
      const diff = execSync(
        `git diff -U0 ${base} -- "${file}"`,
        { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8' }
      );

      // Parse unified diff to get changed line numbers
      // Format: @@ -start,count +start,count @@
      const hunkPattern = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g;

      let match;
      while ((match = hunkPattern.exec(diff)) !== null) {
        const start = parseInt(match[1], 10);
        const count = parseInt(match[2] || '1', 10);

        for (let i = 0; i < count; i++) {
          lines.push(start + i);
        }
      }
    } catch {
      // Ignore errors
    }

    return lines;
  }

  // Check if git is available and this is a repo
  isGitAvailable(): boolean {
    try {
      execSync('git rev-parse --git-dir', {
        cwd: this.rootDir,
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  // Check if a ref exists
  refExists(ref: string): boolean {
    try {
      execSync(`git rev-parse --verify ${ref}`, {
        cwd: this.rootDir,
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }
}
