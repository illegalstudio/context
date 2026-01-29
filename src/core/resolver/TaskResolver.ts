import type { ResolvedTask, TaskConfidence, PackOptions, StacktraceEntry, DiffEntry } from '../../types/index.js';
import { KeywordExtractor, setDomainKeywords } from './KeywordExtractor.js';
import { StacktraceParser } from './StacktraceParser.js';
import { DiffAnalyzer } from './DiffAnalyzer.js';
import { DomainManager } from './domains/index.js';

export interface ResolveResult {
  task: ResolvedTask;
  stacktraceEntries: StacktraceEntry[];
  diffEntries: DiffEntry[];
}

export class TaskResolver {
  private keywordExtractor: KeywordExtractor;
  private stacktraceParser: StacktraceParser;
  private diffAnalyzer: DiffAnalyzer;
  private domainManager: DomainManager;

  constructor(rootDir: string) {
    this.keywordExtractor = new KeywordExtractor();
    this.stacktraceParser = new StacktraceParser();
    this.diffAnalyzer = new DiffAnalyzer(rootDir);
    this.domainManager = new DomainManager(rootDir);
  }

  /**
   * Initialize domain detection (call before resolve)
   */
  async init(): Promise<void> {
    // Detect frameworks and load appropriate domains
    await this.domainManager.detectFrameworks();

    // Update the global domain keywords for use by KeywordExtractor
    setDomainKeywords(this.domainManager.getAllDomainKeywords());
  }

  /**
   * Get the DomainManager instance for external access (e.g., CLI commands)
   */
  getDomainManager(): DomainManager {
    return this.domainManager;
  }

  async resolve(options: PackOptions): Promise<ResolveResult> {
    let rawTask = '';
    let stacktraceEntries: StacktraceEntry[] = [];
    let diffEntries: DiffEntry[] = [];

    // Collect raw input from all sources
    if (options.task) {
      rawTask = options.task;
    }

    if (options.error) {
      const entries = await this.stacktraceParser.parseFromFile(options.error);
      stacktraceEntries = entries;

      // Add error info to raw task
      const messages = this.stacktraceParser.extractErrorMessages(
        await this.readFileContent(options.error)
      );
      if (messages.length > 0) {
        rawTask += ` Error: ${messages[0]}`;
      }

      // Add file hints from stacktrace
      for (const entry of entries) {
        rawTask += ` ${entry.file}`;
        if (entry.function) {
          rawTask += ` ${entry.function}`;
        }
      }
    }

    if (options.diff) {
      const diffResult = await this.diffAnalyzer.analyze(options.diff);
      diffEntries = diffResult.entries;

      // Add changed files to context
      for (const entry of diffEntries) {
        rawTask += ` ${entry.file}`;
      }
    }

    if (options.file) {
      rawTask += ` File: ${options.file}`;
    }

    if (options.symbol) {
      rawTask += ` Symbol: ${options.symbol}`;
    }

    // Extract keywords and entities
    const extracted = this.keywordExtractor.extract(rawTask);

    // Build file hints from various sources
    const filesHint: string[] = [
      ...extracted.entities.fileNames,
      ...stacktraceEntries.map(e => e.file),
      ...diffEntries.filter(e => e.status !== 'deleted').map(e => e.file),
    ];

    if (options.file) {
      filesHint.push(options.file);
    }

    // Build symbol hints
    const symbols: string[] = [
      ...extracted.entities.classNames,
      ...extracted.entities.methodNames,
    ];

    if (options.symbol) {
      symbols.push(options.symbol);
    }

    // Calculate confidence
    const confidence = this.calculateConfidence(extracted, stacktraceEntries, diffEntries, options);

    // Build resolved task
    const task: ResolvedTask = {
      raw: rawTask.trim(),
      keywords: extracted.keywords,
      filesHint: [...new Set(filesHint)],
      symbols: [...new Set(symbols)],
      domains: extracted.domains,
      domainWeights: extracted.domainWeights,
      changeType: extracted.changeType,
      confidence,
    };

    return {
      task,
      stacktraceEntries,
      diffEntries,
    };
  }

  private calculateConfidence(
    extracted: ReturnType<KeywordExtractor['extract']>,
    stacktraceEntries: StacktraceEntry[],
    diffEntries: DiffEntry[],
    options: PackOptions
  ): TaskConfidence {
    const signals = {
      hasExactFileName: extracted.entities.fileNames.length > 0 || !!options.file,
      hasClassName: extracted.entities.classNames.length > 0,
      hasMethodName: extracted.entities.methodNames.length > 0 || !!options.symbol,
      hasRoutePattern: extracted.entities.routePatterns.length > 0,
      hasErrorCode: extracted.entities.errorCodes.length > 0,
      keywordMatchCount: extracted.keywords.length,
    };

    // Calculate overall confidence score
    let score = 0;

    // Strong signals
    if (signals.hasExactFileName) score += 0.3;
    if (stacktraceEntries.length > 0) score += 0.3;
    if (diffEntries.length > 0) score += 0.3;

    // Medium signals
    if (signals.hasClassName) score += 0.25;
    if (signals.hasMethodName) score += 0.2;
    if (signals.hasRoutePattern) score += 0.2;

    // Weak signals
    if (signals.hasErrorCode) score += 0.15;
    score += Math.min(signals.keywordMatchCount * 0.05, 0.2);

    // Cap at 1.0
    const overall = Math.min(score, 1.0);

    return {
      overall,
      signals,
    };
  }

  private async readFileContent(filePath: string): Promise<string> {
    const fs = await import('fs');
    return fs.promises.readFile(filePath, 'utf-8');
  }

  // Helper to determine if task is too vague
  isTaskVague(task: ResolvedTask): boolean {
    return task.confidence.overall < 0.3;
  }

  // Helper to determine if task needs clarification
  needsClarification(task: ResolvedTask): boolean {
    return task.confidence.overall >= 0.3 && task.confidence.overall < 0.5;
  }

  // Generate suggestions for vague tasks
  generateSuggestions(task: ResolvedTask): string[] {
    const suggestions: string[] = [];

    if (!task.confidence.signals.hasExactFileName) {
      suggestions.push('Specify a file path (e.g., app/Services/PaymentService.php)');
    }

    if (!task.confidence.signals.hasClassName && !task.confidence.signals.hasMethodName) {
      suggestions.push('Mention a specific class or method name');
    }

    if (!task.confidence.signals.hasRoutePattern) {
      suggestions.push('Include an API route if applicable (e.g., /api/checkout)');
    }

    suggestions.push('Use --error flag with a log file path');
    suggestions.push('Use --diff flag to analyze changes from a branch');

    return suggestions;
  }
}
