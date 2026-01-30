import { ContextDatabase } from '../../storage/Database.js';
import type { Candidate, CandidateSignals, ResolvedTask } from '../../types/index.js';
import { DOMAIN_KEYWORDS } from '../resolver/KeywordExtractor.js';

// Signal weights for scoring
const WEIGHTS = {
  fileHintExact: 2.0,   // Exact file mention - MUCH HIGHER to guarantee first position when explicitly mentioned
  fileHintHit: 0.40,    // File mentioned in task (partial match, e.g., "User.php" matches ChatUser.php)
  stacktraceHit: 0.30,  // Appears in stacktrace (very strong)
  diffHit: 0.22,        // Modified in diff (strong)
  rawPathMatch: 0.25,   // RAW task word in path (very strong - user explicitly typed this word)
  symbolMatch: 0.20,    // Contains matching symbol (increased - exact method/class mention is strong signal)
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
  // File is a model/entity (often core domain logic)
  modelFile: 1.2,
  // File contains an explicitly mentioned symbol (method/class name from task)
  symbolMention: 1.25,
  // File is in same directory as a strong hit
  sameDirectory: 1.1,
  // Multiple signals combined
  multipleSignals: 1.15,
  // Recent modifications
  recentActivity: 1.1,
  // File matches detected domain (e.g., PaymentController for "payments" domain)
  domainRelevance: 1.25,
  // File path matches multiple task keywords (e.g., "filament" + "user" + "list")
  // This is cumulative: 1.2^(matchCount-1), so 2 matches = 1.2x, 3 matches = 1.44x, 4 matches = 1.73x
  multiKeywordPath: 1.2,
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

    // Separate files by type, keeping track of reserved files
    const reservedFiles: Candidate[] = [];  // Files with exact symbol mention (always included)
    const mainFiles: Candidate[] = [];
    const testFiles: Candidate[] = [];
    const configFiles: Candidate[] = [];

    for (const candidate of candidates) {
      // Files with exact file hint or exactSymbolMention are ALWAYS included (reserved slots)
      // These are files where the user explicitly mentioned a filename or method/class name
      if ((candidate.signals.fileHintExact || candidate.signals.exactSymbolMention) && !this.isTestFile(candidate.path)) {
        reservedFiles.push(candidate);
      } else if (this.isTestFile(candidate.path)) {
        testFiles.push(candidate);
      } else if (this.isConfigFile(candidate.path)) {
        configFiles.push(candidate);
      } else {
        mainFiles.push(candidate);
      }
    }

    // Build final list with balanced representation
    const result: Candidate[] = [];

    // 1. First add reserved files (exact symbol mentions) - these are ALWAYS included
    const reservedPaths = new Set<string>();
    for (const reserved of reservedFiles) {
      if (!reservedPaths.has(reserved.path)) {
        result.push(reserved);
        reservedPaths.add(reserved.path);
      }
    }

    // 2. Add main files (majority of remaining slots)
    const remainingSlots = maxFiles - result.length;
    const mainLimit = Math.floor(remainingSlots * 0.7);
    const mainToAdd = mainFiles.filter(f => !reservedPaths.has(f.path)).slice(0, mainLimit);
    result.push(...mainToAdd);

    // 3. Add test files (if enabled)
    if (options.includeTests !== false) {
      const testLimit = Math.floor(remainingSlots * 0.2);
      // Filter to only tests that test our included files
      const includedPaths = new Set(result.map(c => c.path));
      const relevantTests = testFiles.filter(t =>
        this.testIsRelevant(t.path, includedPaths)
      );
      result.push(...relevantTests.slice(0, testLimit));
    }

    // 4. Add config files (if enabled and relevant)
    if (options.includeConfig !== false) {
      const configLimit = Math.floor(remainingSlots * 0.1);
      // Filter to relevant config files
      const relevantConfig = configFiles.filter(c =>
        this.configIsRelevant(c.path, task)
      );
      result.push(...relevantConfig.slice(0, configLimit));
    }

    // Normalize scores relative to the highest score for display
    // This shows how files compare to the top match (top = 1.0 = 100%)
    const finalResult = result.slice(0, maxFiles);
    const maxScore = finalResult.length > 0 ? Math.max(...finalResult.map(c => c.score)) : 1;

    return finalResult.map(c => ({
      ...c,
      score: maxScore > 0 ? c.score / maxScore : 0,
    }));
  }

  private calculateBaseScore(signals: CandidateSignals, filePath: string, task: ResolvedTask): number {
    let score = 0;

    // File hint is the strongest signal - user explicitly mentioned this file
    // Exact match (e.g., "User.php" matches User.php) gets highest score
    // Partial match (e.g., "User.php" matches ChatUser.php) gets lower but still high score
    if (signals.fileHintExact) {
      score += WEIGHTS.fileHintExact;
    } else if (signals.fileHintHit) {
      score += WEIGHTS.fileHintHit;
    }

    if (signals.stacktraceHit) score += WEIGHTS.stacktraceHit;
    if (signals.diffHit) score += WEIGHTS.diffHit;

    // Raw path matches are VERY strong signals - these are exact words from the user's task
    // Each raw word match adds 0.25 to score (capped at 3 matches = 0.75)
    if (signals.rawPathMatchCount && signals.rawPathMatchCount > 0) {
      score += WEIGHTS.rawPathMatch * Math.min(signals.rawPathMatchCount, 3);
    }

    if (signals.symbolMatch) score += WEIGHTS.symbolMatch;
    if (signals.keywordMatch) score += WEIGHTS.keywordMatch;
    if (signals.testFile) score += WEIGHTS.testFile;
    if (signals.gitHotspot) score += WEIGHTS.gitHotspot;
    if (signals.relatedFile) score += WEIGHTS.relatedFile;
    if (signals.exampleUsage) score += WEIGHTS.exampleUsage;

    // graphRelated weight is scaled by:
    // 1. Domain relevance (files not matching any domain get reduced value)
    // 2. Graph depth decay (files found at greater distances get reduced value)
    if (signals.graphRelated) {
      const domainWeight = this.getFileDomainWeight(filePath, task);
      // Use graphDecay if available (from multi-hop BFS), otherwise use 1.0
      const graphDecay = signals.graphDecay ?? 1.0;
      score += WEIGHTS.graphRelated * domainWeight * graphDecay;
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
    // Entry point bonus - only apply full bonus if file has strong signals
    // This prevents irrelevant controllers from getting boosted just because they're controllers
    if (this.isEntryPoint(filePath)) {
      const hasStrongSignal = signals.fileHintHit ||
                              signals.stacktraceHit ||
                              signals.diffHit ||
                              (signals.rawPathMatchCount && signals.rawPathMatchCount >= 1) ||
                              signals.exactSymbolMention;
      if (hasStrongSignal) {
        score *= BONUSES.entryPoint;  // 1.3x for relevant entry points
      } else {
        score *= 1.1;  // Reduced bonus for entry points without strong task relevance
      }
    }

    // Model file bonus
    if (this.isModelFile(filePath)) {
      score *= BONUSES.modelFile;
    }

    // Symbol mention bonus (explicit method/class mentioned in task)
    if (signals.symbolMatch) {
      score *= BONUSES.symbolMention;
    }

    // Domain relevance bonus - scaled by how many keywords matched that domain
    const domainBonus = this.calculateDomainBonus(filePath, task);
    if (domainBonus > 1) {
      score *= domainBonus;
    }

    // Raw path match bonus - files matching multiple RAW task words get significant boost
    // These are exact words the user typed, so 2+ matches is a very strong signal
    if (signals.rawPathMatchCount && signals.rawPathMatchCount >= 2) {
      // 2 raw matches = 1.4x, 3 raw matches = 1.96x
      const rawBonus = Math.pow(1.4, signals.rawPathMatchCount - 1);
      score *= rawBonus;
    }

    // Multi-keyword path bonus - files matching multiple task keywords in path (expanded keywords)
    // e.g., "app/Filament/Resources/UserResource/Pages/ListUsers.php" matching
    // "filament", "user", "list" gets a significant boost
    if (signals.filenameMatchCount && signals.filenameMatchCount >= 2) {
      // Cumulative bonus: 1.2^(matchCount-1)
      // 2 matches = 1.2x, 3 matches = 1.44x, 4 matches = 1.73x, 5 matches = 2.07x
      const multiMatchBonus = Math.pow(BONUSES.multiKeywordPath, signals.filenameMatchCount - 1);
      score *= multiMatchBonus;

      // Extra boost for 4+ keyword path matches - these files are highly targeted
      if (signals.filenameMatchCount >= 4) {
        score *= 1.3; // Additional 30% boost for very targeted files
      }
    }

    // Basename match bonus - when the FILENAME itself matches multiple keywords
    // e.g., "ListUsers" matching "list" + "user" is a very strong signal
    // This prioritizes files whose names directly describe the task entities
    // ONLY apply this bonus when file also has raw path matches (avoids boosting migrations)
    if (signals.basenameMatchCount && signals.basenameMatchCount >= 2 &&
        signals.rawPathMatchCount && signals.rawPathMatchCount >= 1) {
      // 2 basename matches = 1.5x, 3 = 2.25x, 4 = 3.375x
      const basenameBonus = Math.pow(1.5, signals.basenameMatchCount - 1);
      score *= basenameBonus;
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

    // Don't cap here - keep raw score for ranking
    // Cap to 1.0 only for display purposes later
    return score;
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

    // File hint is the strongest signal
    if (signals.fileHintExact) {
      reasons.push('exact file match (explicitly mentioned)');
    } else if (signals.fileHintHit) {
      reasons.push('file mentioned in task (partial match)');
    }

    if (signals.stacktraceHit) {
      reasons.push('appears in stacktrace');
    }
    if (signals.diffHit) {
      reasons.push('modified in current changes');
    }
    if (signals.exactSymbolMention) {
      reasons.push('contains explicitly mentioned symbol (reserved)');
    } else if (signals.symbolMatch) {
      reasons.push('contains matching symbol');
    }
    if (signals.keywordMatch) {
      reasons.push('contains matching keywords');
    }
    if (signals.rawPathMatchCount && signals.rawPathMatchCount >= 1) {
      reasons.push(`path contains ${signals.rawPathMatchCount} exact task word(s)`);
    }
    if (signals.filenameMatchCount && signals.filenameMatchCount >= 2) {
      reasons.push(`path matches ${signals.filenameMatchCount} expanded keywords`);
    }
    if (signals.basenameMatchCount && signals.basenameMatchCount >= 2) {
      reasons.push(`filename matches ${signals.basenameMatchCount} keywords`);
    }
    if (signals.graphRelated) {
      const depth = signals.graphDepth ?? 1;
      if (depth === 1) {
        reasons.push('related via imports (direct)');
      } else {
        reasons.push(`related via imports (${depth} hops)`);
      }
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
    if (this.isModelFile(filePath)) {
      reasons.push('model/entity file');
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

  private isModelFile(filePath: string): boolean {
    const patterns = [
      /Models?\//i,           // app/Models/ or Model/
      /Entities?\//i,         // app/Entities/ or Entity/
      /\.model\./i,           // *.model.ts, *.model.js
      /Model\.[a-z]+$/i,      // *Model.php, *Model.ts
      /Entity\.[a-z]+$/i,     // *Entity.php, *Entity.ts
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
