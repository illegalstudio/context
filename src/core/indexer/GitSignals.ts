import { execSync } from 'child_process';
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

  // Fast batch collection using single git commands
  async collectSignals(files: string[]): Promise<Map<string, GitSignal>> {
    const signals = new Map<string, GitSignal>();

    if (!this.isGitRepo || files.length === 0) {
      return signals;
    }

    // Initialize all files with default values
    for (const file of files) {
      signals.set(file, {
        path: file,
        lastModified: undefined,
        commitCount: 0,
        churnScore: 0,
      });
    }

    // Get hotspots in a single command (most efficient)
    const hotspots = await this.getHotspots(500);
    const hotspotMap = new Map(hotspots.map(h => [h.file, h.score]));

    // Update signals with hotspot scores
    for (const file of files) {
      const signal = signals.get(file);
      if (signal && hotspotMap.has(file)) {
        signal.churnScore = hotspotMap.get(file) || 0;
        signal.commitCount = Math.round(signal.churnScore * 100); // Approximate
      }
    }

    return signals;
  }

  // Collect detailed signals for specific files only (used during pack)
  async collectDetailedSignals(files: string[]): Promise<Map<string, GitSignal>> {
    const signals = new Map<string, GitSignal>();

    if (!this.isGitRepo || files.length === 0) {
      return signals;
    }

    // For small number of files, we can afford individual commands
    for (const file of files) {
      try {
        // Get commit count
        let commitCount = 0;
        try {
          const countResult = execSync(
            `git rev-list --count HEAD -- "${file}"`,
            { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8', timeout: 5000 }
          );
          commitCount = parseInt(countResult.trim(), 10) || 0;
        } catch {
          // Ignore
        }

        // Get last modified
        let lastModified: string | undefined;
        try {
          const dateResult = execSync(
            `git log -1 --format=%ci -- "${file}"`,
            { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8', timeout: 5000 }
          );
          lastModified = dateResult.trim() || undefined;
        } catch {
          // Ignore
        }

        // Calculate churn score based on commit count
        const churnScore = Math.min(commitCount / 100, 1);

        signals.set(file, {
          path: file,
          lastModified,
          commitCount,
          churnScore,
        });
      } catch {
        signals.set(file, {
          path: file,
          commitCount: 0,
          churnScore: 0,
        });
      }
    }

    return signals;
  }

  async getRecentlyModifiedFiles(since: string = '1 week ago', limit: number = 50): Promise<string[]> {
    if (!this.isGitRepo) {
      return [];
    }

    try {
      const result = execSync(
        `git log --since="${since}" --name-only --pretty=format: | sort | uniq -c | sort -rn | head -${limit}`,
        { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8', timeout: 30000 }
      );

      return result.trim().split('\n')
        .map(line => line.trim().replace(/^\d+\s+/, ''))
        .filter(file => file.length > 0);
    } catch {
      return [];
    }
  }

  async getHotspots(limit: number = 100): Promise<Array<{ file: string; score: number }>> {
    if (!this.isGitRepo) {
      return [];
    }

    try {
      // Get files with most commits in last 6 months - single command
      const result = execSync(
        `git log --since="6 months ago" --name-only --pretty=format: | sort | uniq -c | sort -rn | head -${limit}`,
        { cwd: this.rootDir, stdio: 'pipe', encoding: 'utf-8', timeout: 60000 }
      );

      const lines = result.trim().split('\n').filter(l => l.trim());
      if (lines.length === 0) return [];

      const maxCount = parseInt(lines[0]?.trim().split(/\s+/)[0] || '1', 10);

      return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        const count = parseInt(parts[0], 10) || 0;
        const file = parts.slice(1).join(' ');
        return {
          file,
          score: count / maxCount,
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
        timeout: 5000,
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
        timeout: 5000,
      });
      return result.trim();
    } catch {
      return null;
    }
  }
}
