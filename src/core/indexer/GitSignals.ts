import { execSync } from 'child_process';
import path from 'path';
import type { GitSignal } from '../../types/index.js';

export class GitSignalsCollector {
  private rootDir: string;
  private isGitRepo: boolean;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.isGitRepo = this.checkGitRepo();
  }

  private checkGitRepo(): boolean {
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

  isAvailable(): boolean {
    return this.isGitRepo;
  }

  async collectSignals(files: string[]): Promise<Map<string, GitSignal>> {
    const signals = new Map<string, GitSignal>();

    if (!this.isGitRepo) {
      return signals;
    }

    // Batch process for efficiency
    const commitCounts = await this.getCommitCounts(files);
    const lastModified = await this.getLastModifiedDates(files);
    const churnScores = await this.getChurnScores(files);

    for (const file of files) {
      signals.set(file, {
        path: file,
        lastModified: lastModified.get(file),
        commitCount: commitCounts.get(file) || 0,
        churnScore: churnScores.get(file) || 0,
      });
    }

    return signals;
  }

  private async getCommitCounts(files: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();

    try {
      // Use git shortlog to get commit counts per file
      // Process in batches to avoid command line length limits
      const batchSize = 100;

      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);

        for (const file of batch) {
          try {
            const result = execSync(
              `git rev-list --count HEAD -- "${file}"`,
              { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8' }
            );
            const count = parseInt(result.trim(), 10);
            if (!isNaN(count)) {
              counts.set(file, count);
            }
          } catch {
            counts.set(file, 0);
          }
        }
      }
    } catch {
      // Git not available or error
    }

    return counts;
  }

  private async getLastModifiedDates(files: string[]): Promise<Map<string, string>> {
    const dates = new Map<string, string>();

    try {
      for (const file of files) {
        try {
          const result = execSync(
            `git log -1 --format=%ci -- "${file}"`,
            { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8' }
          );
          const date = result.trim();
          if (date) {
            dates.set(file, date);
          }
        } catch {
          // File might not be tracked
        }
      }
    } catch {
      // Git not available
    }

    return dates;
  }

  private async getChurnScores(files: string[]): Promise<Map<string, number>> {
    const scores = new Map<string, number>();

    try {
      // Calculate churn based on recent commits (last 3 months)
      // Churn = (additions + deletions) in recent history
      for (const file of files) {
        try {
          const result = execSync(
            `git log --since="3 months ago" --pretty=tformat: --numstat -- "${file}"`,
            { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8' }
          );

          let totalChurn = 0;
          const lines = result.trim().split('\n');

          for (const line of lines) {
            const parts = line.split('\t');
            if (parts.length >= 2) {
              const additions = parseInt(parts[0], 10) || 0;
              const deletions = parseInt(parts[1], 10) || 0;
              totalChurn += additions + deletions;
            }
          }

          // Normalize score (0-1 range, cap at 1000 changes)
          const normalizedScore = Math.min(totalChurn / 1000, 1);
          scores.set(file, normalizedScore);
        } catch {
          scores.set(file, 0);
        }
      }
    } catch {
      // Git not available
    }

    return scores;
  }

  async getRecentlyModifiedFiles(since: string = '1 week ago', limit: number = 50): Promise<string[]> {
    if (!this.isGitRepo) {
      return [];
    }

    try {
      const result = execSync(
        `git log --since="${since}" --name-only --pretty=format: | sort | uniq -c | sort -rn | head -${limit}`,
        { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8' }
      );

      return result.trim().split('\n')
        .map(line => line.trim().replace(/^\d+\s+/, ''))
        .filter(file => file.length > 0);
    } catch {
      return [];
    }
  }

  async getHotspots(limit: number = 20): Promise<Array<{ file: string; score: number }>> {
    if (!this.isGitRepo) {
      return [];
    }

    try {
      // Get files with most commits in last 6 months
      const result = execSync(
        `git log --since="6 months ago" --name-only --pretty=format: | sort | uniq -c | sort -rn | head -${limit}`,
        { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8' }
      );

      const lines = result.trim().split('\n').filter(l => l.trim());
      const maxCount = parseInt(lines[0]?.trim().split(/\s+/)[0] || '1', 10);

      return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        const count = parseInt(parts[0], 10) || 0;
        const file = parts.slice(1).join(' ');
        return {
          file,
          score: count / maxCount, // Normalize to 0-1
        };
      }).filter(h => h.file.length > 0);
    } catch {
      return [];
    }
  }

  getCurrentBranch(): string | null {
    if (!this.isGitRepo) {
      return null;
    }

    try {
      const result = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.rootDir,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      return result.trim();
    } catch {
      return null;
    }
  }

  getCurrentCommit(): string | null {
    if (!this.isGitRepo) {
      return null;
    }

    try {
      const result = execSync('git rev-parse HEAD', {
        cwd: this.rootDir,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      return result.trim();
    } catch {
      return null;
    }
  }
}
