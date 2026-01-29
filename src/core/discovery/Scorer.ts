import { ContextDatabase } from '../../storage/Database.js';
import type { Candidate, CandidateSignals, ResolvedTask } from '../../types/index.js';

// Signal weights for scoring
const WEIGHTS = {
  stacktraceHit: 0.35,  // Appears in stacktrace (very strong)
  diffHit: 0.25,        // Modified in diff (strong)
  symbolMatch: 0.15,    // Contains matching symbol
  keywordMatch: 0.10,   // Contains matching keywords
  graphRelated: 0.05,   // Related via import graph
  testFile: 0.05,       // Is a test file for candidates
  gitHotspot: 0.05,     // High git churn
};

// Bonus multipliers
const BONUSES = {
  // File is an entry point (controller, handler, etc.)
  entryPoint: 1.2,
  // File is in same directory as a strong hit
  sameDirectory: 1.1,
  // Multiple signals combined
  multipleSignals: 1.15,
  // Recent modifications
  recentActivity: 1.1,
};

export interface ScorerOptions {
  maxFiles?: number;
  includeTests?: boolean;
  includeConfig?: boolean;
}

export class Scorer {
  private db: ContextDatabase;

  constructor(db: ContextDatabase) {
    this.db = db;
  }

  score(
    candidateSignals: Map<string, CandidateSignals>,
    task: ResolvedTask,
    options: ScorerOptions = {}
  ): Candidate[] {
    const maxFiles = options.maxFiles || 25;
    const candidates: Candidate[] = [];

    for (const [filePath, signals] of candidateSignals) {
      // Calculate base score from weighted signals
      let score = this.calculateBaseScore(signals);

      // Apply bonuses
      score = this.applyBonuses(score, filePath, signals, candidateSignals);

      // Generate reasons
      const reasons = this.generateReasons(signals, filePath);

      candidates.push({
        path: filePath,
        score,
        reasons,
        signals,
      });
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    // Separate main files and test files
    const mainFiles: Candidate[] = [];
    const testFiles: Candidate[] = [];
    const configFiles: Candidate[] = [];

    for (const candidate of candidates) {
      if (this.isTestFile(candidate.path)) {
        testFiles.push(candidate);
      } else if (this.isConfigFile(candidate.path)) {
        configFiles.push(candidate);
      } else {
        mainFiles.push(candidate);
      }
    }

    // Build final list with balanced representation
    const result: Candidate[] = [];

    // Add main files (majority)
    const mainLimit = Math.floor(maxFiles * 0.7);
    result.push(...mainFiles.slice(0, mainLimit));

    // Add test files (if enabled)
    if (options.includeTests !== false) {
      const testLimit = Math.floor(maxFiles * 0.2);
      // Filter to only tests that test our included files
      const includedPaths = new Set(result.map(c => c.path));
      const relevantTests = testFiles.filter(t =>
        this.testIsRelevant(t.path, includedPaths)
      );
      result.push(...relevantTests.slice(0, testLimit));
    }

    // Add config files (if enabled and relevant)
    if (options.includeConfig !== false) {
      const configLimit = Math.floor(maxFiles * 0.1);
      // Filter to relevant config files
      const relevantConfig = configFiles.filter(c =>
        this.configIsRelevant(c.path, task)
      );
      result.push(...relevantConfig.slice(0, configLimit));
    }

    return result.slice(0, maxFiles);
  }

  private calculateBaseScore(signals: CandidateSignals): number {
    let score = 0;

    if (signals.stacktraceHit) score += WEIGHTS.stacktraceHit;
    if (signals.diffHit) score += WEIGHTS.diffHit;
    if (signals.symbolMatch) score += WEIGHTS.symbolMatch;
    if (signals.keywordMatch) score += WEIGHTS.keywordMatch;
    if (signals.graphRelated) score += WEIGHTS.graphRelated;
    if (signals.testFile) score += WEIGHTS.testFile;
    if (signals.gitHotspot) score += WEIGHTS.gitHotspot;

    return score;
  }

  private applyBonuses(
    score: number,
    filePath: string,
    signals: CandidateSignals,
    allCandidates: Map<string, CandidateSignals>
  ): number {
    // Entry point bonus
    if (this.isEntryPoint(filePath)) {
      score *= BONUSES.entryPoint;
    }

    // Multiple signals bonus
    const signalCount = Object.values(signals).filter(v => v === true).length;
    if (signalCount >= 3) {
      score *= BONUSES.multipleSignals;
    }

    // Same directory bonus
    const directory = filePath.split('/').slice(0, -1).join('/');
    for (const [otherPath, otherSignals] of allCandidates) {
      if (otherPath === filePath) continue;
      const otherDir = otherPath.split('/').slice(0, -1).join('/');
      // If another high-scoring file is in same directory
      if (otherDir === directory && (otherSignals.stacktraceHit || otherSignals.diffHit)) {
        score *= BONUSES.sameDirectory;
        break;
      }
    }

    // Git hotspot bonus
    const gitSignal = this.db.getGitSignal(filePath);
    if (gitSignal && gitSignal.churnScore > 0.5) {
      score *= BONUSES.recentActivity;
    }

    return Math.min(score, 1.0); // Cap at 1.0
  }

  private generateReasons(signals: CandidateSignals, filePath: string): string[] {
    const reasons: string[] = [];

    if (signals.stacktraceHit) {
      reasons.push('appears in stacktrace');
    }
    if (signals.diffHit) {
      reasons.push('modified in current changes');
    }
    if (signals.symbolMatch) {
      reasons.push('contains matching symbol');
    }
    if (signals.keywordMatch) {
      reasons.push('contains matching keywords');
    }
    if (signals.graphRelated) {
      reasons.push('related via imports');
    }
    if (signals.testFile) {
      reasons.push('test file for candidate');
    }
    if (signals.gitHotspot) {
      reasons.push('high git activity (hotspot)');
    }
    if (this.isEntryPoint(filePath)) {
      reasons.push('entry point (controller/handler)');
    }

    return reasons;
  }

  private isTestFile(filePath: string): boolean {
    const patterns = [
      /test[s]?\//i,
      /spec[s]?\//i,
      /__tests__\//i,
      /\.test\./,
      /\.spec\./,
      /Test\.[a-z]+$/,
      /_test\.[a-z]+$/,
    ];
    return patterns.some(p => p.test(filePath));
  }

  private isConfigFile(filePath: string): boolean {
    const patterns = [
      /^config\//,
      /\.config\./,
      /^\.env/,
      /^\..*rc$/,
      /package\.json$/,
      /composer\.json$/,
      /tsconfig\.json$/,
      /webpack\.config/,
      /vite\.config/,
      /tailwind\.config/,
    ];
    return patterns.some(p => p.test(filePath));
  }

  private isEntryPoint(filePath: string): boolean {
    const patterns = [
      /Controller\.[a-z]+$/i,
      /Handler\.[a-z]+$/i,
      /Middleware\.[a-z]+$/i,
      /routes?\//i,
      /api\.[a-z]+$/i,
      /index\.[a-z]+$/,
      /main\.[a-z]+$/,
      /app\.[a-z]+$/,
    ];
    return patterns.some(p => p.test(filePath));
  }

  private testIsRelevant(testPath: string, includedPaths: Set<string>): boolean {
    // Check if test file name relates to any included file
    const testBasename = testPath.split('/').pop() || '';

    for (const includedPath of includedPaths) {
      const includedBasename = includedPath.split('/').pop() || '';

      // Remove test/spec suffixes and compare
      const normalizedTest = testBasename
        .replace(/\.(test|spec)\.[a-z]+$/, '')
        .replace(/Test\.[a-z]+$/, '')
        .replace(/_test\.[a-z]+$/, '')
        .toLowerCase();

      const normalizedIncluded = includedBasename
        .replace(/\.[a-z]+$/, '')
        .toLowerCase();

      if (normalizedTest.includes(normalizedIncluded) || normalizedIncluded.includes(normalizedTest)) {
        return true;
      }
    }

    return false;
  }

  private configIsRelevant(configPath: string, task: ResolvedTask): boolean {
    // Check if config file is related to task domains
    const configName = configPath.toLowerCase();

    for (const domain of task.domains) {
      if (configName.includes(domain)) {
        return true;
      }
    }

    // Check specific patterns
    if (task.domains.includes('auth') && configName.includes('auth')) return true;
    if (task.domains.includes('database') && configName.includes('database')) return true;
    if (task.domains.includes('cache') && configName.includes('cache')) return true;
    if (task.domains.includes('queue') && configName.includes('queue')) return true;

    return false;
  }
}
