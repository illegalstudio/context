import { ContextDatabase } from '../../storage/Database.js';
import type { Candidate, CandidateSignals, ResolvedTask } from '../../types/index.js';
import { DOMAIN_KEYWORDS } from '../resolver/KeywordExtractor.js';

// Signal weights for scoring
const WEIGHTS = {
  stacktraceHit: 0.30,  // Appears in stacktrace (very strong)
  diffHit: 0.22,        // Modified in diff (strong)
  symbolMatch: 0.12,    // Contains matching symbol
  keywordMatch: 0.08,   // Contains matching keywords
  graphRelated: 0.05,   // Related via import graph
  testFile: 0.05,       // Is a test file for candidates
  gitHotspot: 0.04,     // High git churn
  relatedFile: 0.12,    // Found by discovery rule or two-hop reference
  exampleUsage: 0.04,   // Example of similar pattern usage
};

// Bonus multipliers
const BONUSES = {
  // File is an entry point (controller, handler, etc.)
  entryPoint: 1.3,
  // File is in same directory as a strong hit
  sameDirectory: 1.1,
  // Multiple signals combined
  multipleSignals: 1.15,
  // Recent modifications
  recentActivity: 1.1,
  // File matches detected domain (e.g., PaymentController for "payments" domain)
  domainRelevance: 1.25,
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
      // Calculate base score from weighted signals (graphRelated scaled by domain relevance)
      let score = this.calculateBaseScore(signals, filePath, task);

      // Apply bonuses (including domain relevance)
      score = this.applyBonuses(score, filePath, signals, candidateSignals, task);

      // Generate reasons
      const reasons = this.generateReasons(signals, filePath, task);

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

  private calculateBaseScore(signals: CandidateSignals, filePath: string, task: ResolvedTask): number {
    let score = 0;

    if (signals.stacktraceHit) score += WEIGHTS.stacktraceHit;
    if (signals.diffHit) score += WEIGHTS.diffHit;
    if (signals.symbolMatch) score += WEIGHTS.symbolMatch;
    if (signals.keywordMatch) score += WEIGHTS.keywordMatch;
    if (signals.testFile) score += WEIGHTS.testFile;
    if (signals.gitHotspot) score += WEIGHTS.gitHotspot;
    if (signals.relatedFile) score += WEIGHTS.relatedFile;
    if (signals.exampleUsage) score += WEIGHTS.exampleUsage;

    // graphRelated weight is scaled by domain relevance
    // Files not matching any domain get reduced graphRelated value
    if (signals.graphRelated) {
      const domainWeight = this.getFileDomainWeight(filePath, task);
      score += WEIGHTS.graphRelated * domainWeight;
    }

    return score;
  }

  /**
   * Get how strongly a file matches the task's domains (0.2 to 1.0)
   * Returns the proportion of domain weight this file matches, with a minimum of 0.2
   */
  private getFileDomainWeight(filePath: string, task: ResolvedTask): number {
    const domainWeights = task.domainWeights || {};
    const totalWeight = Object.values(domainWeights).reduce((sum, w) => sum + w, 0);

    if (totalWeight === 0) return 1; // No domains detected, full weight

    const filePathLower = filePath.toLowerCase();
    let matchedWeight = 0;

    for (const domain of task.domains) {
      const domainKeywords = DOMAIN_KEYWORDS[domain];
      if (!domainKeywords) continue;

      for (const keyword of domainKeywords) {
        if (filePathLower.includes(keyword.toLowerCase())) {
          matchedWeight += domainWeights[domain] || 0;
          break;
        }
      }
    }

    // Return proportion with minimum of 0.2 (don't completely ignore graphRelated)
    return Math.max(0.2, matchedWeight / totalWeight);
  }

  private applyBonuses(
    score: number,
    filePath: string,
    signals: CandidateSignals,
    allCandidates: Map<string, CandidateSignals>,
    task: ResolvedTask
  ): number {
    // Entry point bonus
    if (this.isEntryPoint(filePath)) {
      score *= BONUSES.entryPoint;
    }

    // Domain relevance bonus - scaled by how many keywords matched that domain
    const domainBonus = this.calculateDomainBonus(filePath, task);
    if (domainBonus > 1) {
      score *= domainBonus;
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

  /**
   * Calculate domain relevance bonus scaled by keyword match count.
   * Files matching domains with more keyword hits get higher bonuses.
   *
   * Example: If task mentions 4 payment keywords and 1 auth keyword:
   * - PaymentController gets bonus based on 4 matches
   * - UserController gets bonus based on 1 match
   */
  private calculateDomainBonus(filePath: string, task: ResolvedTask): number {
    const filePathLower = filePath.toLowerCase();
    const domainWeights = task.domainWeights || {};

    // Find the total weight across all domains
    const totalWeight = Object.values(domainWeights).reduce((sum, w) => sum + w, 0);
    if (totalWeight === 0) return 1;

    // Find which domains this file matches and sum their weights
    let matchedWeight = 0;

    for (const domain of task.domains) {
      const domainKeywords = DOMAIN_KEYWORDS[domain];
      if (!domainKeywords) continue;

      // Check if file path contains any domain keyword
      for (const keyword of domainKeywords) {
        if (filePathLower.includes(keyword.toLowerCase())) {
          matchedWeight += domainWeights[domain] || 0;
          break; // Only count each domain once per file
        }
      }
    }

    if (matchedWeight === 0) return 1;

    // Scale bonus by the proportion of matched weight
    // Max bonus (1.25) when file matches domain with all weight
    // Proportionally less for domains with fewer keyword matches
    const weightRatio = matchedWeight / totalWeight;
    return 1 + (BONUSES.domainRelevance - 1) * weightRatio;
  }

  /**
   * Check if a file path matches any of the detected domains
   */
  private isDomainRelevant(filePath: string, domains: string[]): boolean {
    const filePathLower = filePath.toLowerCase();

    for (const domain of domains) {
      const domainKeywords = DOMAIN_KEYWORDS[domain];
      if (!domainKeywords) continue;

      for (const keyword of domainKeywords) {
        if (filePathLower.includes(keyword.toLowerCase())) {
          return true;
        }
      }
    }

    return false;
  }

  private generateReasons(signals: CandidateSignals, filePath: string, task: ResolvedTask): string[] {
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
    if (signals.relatedFile) {
      reasons.push('related file (view, component, migration)');
    }
    if (signals.exampleUsage) {
      reasons.push('example of similar pattern');
    }
    if (this.isEntryPoint(filePath)) {
      reasons.push('entry point (controller/handler)');
    }
    if (this.isDomainRelevant(filePath, task.domains)) {
      reasons.push(`domain relevant (${task.domains.join(', ')})`);
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
