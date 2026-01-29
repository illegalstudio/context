import fs from 'fs';
import path from 'path';
import { ContextDatabase } from '../../storage/Database.js';
import type { ResolvedTask, Candidate, CandidateSignals, StacktraceEntry, DiffEntry } from '../../types/index.js';
import { DiscoveryLoader } from './DiscoveryLoader.js';
import type { DiscoveryContext as RuleDiscoveryContext } from './DiscoveryRule.js';
import { CtxIgnore } from '../indexer/CtxIgnore.js';
import { ReferenceExtractor } from './ReferenceExtractor.js';

export interface DiscoveryContext {
  task: ResolvedTask;
  stacktraceEntries: StacktraceEntry[];
  diffEntries: DiffEntry[];
}

export class CandidateDiscovery {
  private db: ContextDatabase;
  private rootDir: string;
  private discoveryLoader: DiscoveryLoader;
  private ctxIgnore: CtxIgnore;

  constructor(db: ContextDatabase, rootDir: string) {
    this.db = db;
    this.rootDir = rootDir;
    this.discoveryLoader = new DiscoveryLoader(rootDir);
    this.ctxIgnore = new CtxIgnore(rootDir);
  }

  /**
   * Initialize the discovery system (load rules)
   */
  async init(): Promise<void> {
    await this.discoveryLoader.init();
  }

  /**
   * Get the names of loaded discovery rules
   */
  getLoadedRuleNames(): string[] {
    return this.discoveryLoader.getAppliedRuleNames();
  }

  async discover(context: DiscoveryContext): Promise<Map<string, CandidateSignals>> {
    const candidates = new Map<string, CandidateSignals>();

    // Run all discovery strategies in parallel
    await Promise.all([
      this.discoverFromStacktrace(context.stacktraceEntries, candidates),
      this.discoverFromDiff(context.diffEntries, candidates),
      this.discoverFromSymbols(context.task, candidates),
      this.discoverFromKeywords(context.task, candidates),
      this.discoverFromFileHints(context.task, candidates),
      this.discoverFromFilenames(context.task, candidates), // NEW: search by filename
    ]);

    // Expand graph to find related files
    await this.expandGraph(candidates);

    // Two-hop discovery: extract references from discovered files and find those files
    await this.expandWithReferences(candidates);

    // Add test files for discovered candidates
    await this.discoverTestFiles(candidates);

    // Run modular discovery rules (Laravel, Statamic, etc.)
    await this.runDiscoveryRules(context.task, candidates);

    // Filter out ignored files (from .ctxignore)
    this.filterIgnoredCandidates(candidates);

    return candidates;
  }

  /**
   * Run modular discovery rules and merge their results
   */
  private async runDiscoveryRules(
    task: ResolvedTask,
    candidates: Map<string, CandidateSignals>
  ): Promise<void> {
    const ruleContext: RuleDiscoveryContext = {
      task,
      candidates,
      db: this.db,
      rootDir: this.rootDir,
    };

    const discovered = await this.discoveryLoader.runAll(ruleContext);

    // Merge discovered candidates
    for (const [filePath, signals] of discovered) {
      this.addCandidate(candidates, filePath, signals);
    }
  }

  /**
   * Filter out candidates that match .ctxignore patterns
   */
  private filterIgnoredCandidates(candidates: Map<string, CandidateSignals>): void {
    const toRemove: string[] = [];

    for (const filePath of candidates.keys()) {
      if (this.ctxIgnore.isIgnored(filePath)) {
        toRemove.push(filePath);
      }
    }

    for (const filePath of toRemove) {
      candidates.delete(filePath);
    }
  }

  private async discoverFromStacktrace(
    entries: StacktraceEntry[],
    candidates: Map<string, CandidateSignals>
  ): Promise<void> {
    for (const entry of entries) {
      // Normalize file path
      const normalizedPath = this.normalizePath(entry.file);

      // Check if file exists in index
      const file = this.db.getFile(normalizedPath);
      if (file) {
        this.addCandidate(candidates, normalizedPath, { stacktraceHit: true });
      } else {
        // Try partial match
        const matchingFiles = this.findMatchingFiles(normalizedPath);
        for (const matchedPath of matchingFiles) {
          this.addCandidate(candidates, matchedPath, { stacktraceHit: true });
        }
      }
    }
  }

  private async discoverFromDiff(
    entries: DiffEntry[],
    candidates: Map<string, CandidateSignals>
  ): Promise<void> {
    for (const entry of entries) {
      if (entry.status !== 'deleted') {
        const file = this.db.getFile(entry.file);
        if (file) {
          this.addCandidate(candidates, entry.file, { diffHit: true });
        }
      }
    }
  }

  private async discoverFromSymbols(
    task: ResolvedTask,
    candidates: Map<string, CandidateSignals>
  ): Promise<void> {
    // Search for symbols mentioned in the task
    for (const symbolName of task.symbols) {
      const symbols = this.db.findSymbolsByName(symbolName);
      for (const symbol of symbols) {
        this.addCandidate(candidates, symbol.filePath, { symbolMatch: true });
      }
    }
  }

  private async discoverFromKeywords(
    task: ResolvedTask,
    candidates: Map<string, CandidateSignals>
  ): Promise<void> {
    // Search for keywords in file content using FTS
    // Use more keywords to catch synonym expansions (e.g., "pagare" → "payment")
    for (const keyword of task.keywords.slice(0, 30)) { // Use top 30 keywords including synonyms
      const results = this.db.searchContent(keyword, 20);
      for (const result of results) {
        this.addCandidate(candidates, result.path, { keywordMatch: true });
      }
    }
  }

  private async discoverFromFileHints(
    task: ResolvedTask,
    candidates: Map<string, CandidateSignals>
  ): Promise<void> {
    for (const fileHint of task.filesHint) {
      // Try exact match first
      const file = this.db.getFile(fileHint);
      if (file) {
        this.addCandidate(candidates, fileHint, { keywordMatch: true });
      } else {
        // Try partial match
        const matchingFiles = this.findMatchingFiles(fileHint);
        for (const matchedPath of matchingFiles) {
          this.addCandidate(candidates, matchedPath, { keywordMatch: true });
        }
      }
    }
  }

  /**
   * Search for files whose path contains any of the extracted symbols, keywords, or domain terms
   * This catches Model files, Resource files, Service files, etc. based on naming
   */
  private async discoverFromFilenames(
    task: ResolvedTask,
    candidates: Map<string, CandidateSignals>
  ): Promise<void> {
    const allFiles = this.db.getAllFiles();

    // Combine all meaningful terms to search in filenames
    const searchTerms = new Set<string>();

    // Add all symbols (these include case variants)
    for (const symbol of task.symbols) {
      if (symbol.length > 3) {
        searchTerms.add(symbol.toLowerCase());
      }
    }

    // Add ALL keywords (not just identifier-like ones)
    for (const keyword of task.keywords) {
      if (keyword.length > 3) {
        searchTerms.add(keyword.toLowerCase());
      }
    }

    // Add domain names as search terms (e.g., "payments" domain -> search for payment-related files)
    for (const domain of task.domains) {
      if (domain.length > 3) {
        searchTerms.add(domain.toLowerCase());
      }
    }

    if (searchTerms.size === 0) return;

    // Search through all files
    for (const file of allFiles) {
      const filePathLower = file.path.toLowerCase();
      const fileNameLower = path.basename(file.path).toLowerCase();

      for (const term of searchTerms) {
        // Check if the filename or path contains the term
        if (fileNameLower.includes(term) || filePathLower.includes(term)) {
          this.addCandidate(candidates, file.path, { symbolMatch: true });
          break; // Only add once per file
        }
      }
    }
  }

  private async expandGraph(candidates: Map<string, CandidateSignals>): Promise<void> {
    const initialCandidates = [...candidates.keys()];

    for (const filePath of initialCandidates) {
      // Get files that this file imports
      const imports = this.db.getImportsFrom(filePath);
      for (const imp of imports) {
        this.addCandidate(candidates, imp.targetPath, { graphRelated: true });
      }

      // Get files that import this file
      const importers = this.db.getImportersOf(filePath);
      for (const imp of importers) {
        this.addCandidate(candidates, imp.sourcePath, { graphRelated: true });
      }
    }
  }

  /**
   * Two-hop discovery: read discovered files, extract references (class names,
   * method names, file paths), and find matching files in the index.
   * This is especially useful for documentation files that mention code entities.
   */
  private async expandWithReferences(candidates: Map<string, CandidateSignals>): Promise<void> {
    const extractor = new ReferenceExtractor();
    const initialCandidates = [...candidates.keys()];
    const allFiles = this.db.getAllFiles();

    // Build lookup maps for faster matching
    const filesByBasename = new Map<string, string[]>();
    for (const file of allFiles) {
      const basename = path.basename(file.path).toLowerCase();
      const existing = filesByBasename.get(basename) || [];
      existing.push(file.path);
      filesByBasename.set(basename, existing);
    }

    for (const filePath of initialCandidates) {
      // Read file content
      const content = this.readFileContent(filePath);
      if (!content) continue;

      const refs = extractor.extract(content);

      // Find files matching class names
      for (const className of refs.classNames) {
        const matchingFiles = this.findFilesByClassName(className, allFiles, filesByBasename);

        for (const file of matchingFiles) {
          // Always add relatedFile signal, even if already a candidate
          this.addCandidate(candidates, file, { relatedFile: true });
        }
      }

      // Find files matching method names (via symbol search)
      for (const methodName of refs.methodNames) {
        const symbols = this.db.findSymbolsByName(methodName);
        for (const symbol of symbols) {
          // Always add relatedFile signal, even if already a candidate
          this.addCandidate(candidates, symbol.filePath, { relatedFile: true });
        }
      }

      // Find files matching extracted file paths
      for (const refPath of refs.filePaths) {
        const matchingFiles = this.findMatchingFiles(refPath);
        for (const file of matchingFiles) {
          // Always add relatedFile signal, even if already a candidate
          this.addCandidate(candidates, file, { relatedFile: true });
        }
      }
    }
  }

  /**
   * Find files that match a class name
   */
  private findFilesByClassName(
    className: string,
    allFiles: { path: string }[],
    filesByBasename: Map<string, string[]>
  ): string[] {
    const results: string[] = [];

    // Strategy 1: Direct filename match (e.g., PaymentController -> PaymentController.php)
    const possibleFilenames = [
      `${className}.php`,
      `${className}.ts`,
      `${className}.js`,
      `${className}.tsx`,
      `${className}.jsx`,
      `${className}.py`,
      `${className}.rb`,
      `${className}.java`,
      `${className}.go`,
    ];

    for (const filename of possibleFilenames) {
      const matches = filesByBasename.get(filename.toLowerCase());
      if (matches) {
        results.push(...matches);
      }
    }

    // Strategy 2: Symbol search - find files that define this class/interface
    const symbols = this.db.findSymbolsByName(className);
    for (const symbol of symbols) {
      if (symbol.kind === 'class' || symbol.kind === 'interface') {
        if (!results.includes(symbol.filePath)) {
          results.push(symbol.filePath);
        }
      }
    }

    return results;
  }

  /**
   * Read file content safely
   */
  private readFileContent(filePath: string): string | null {
    try {
      const fullPath = path.join(this.rootDir, filePath);
      return fs.readFileSync(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  private async discoverTestFiles(candidates: Map<string, CandidateSignals>): Promise<void> {
    const allFiles = this.db.getAllFiles();
    const candidatePaths = new Set(candidates.keys());

    for (const file of allFiles) {
      // Check if this is a test file
      if (this.isTestFile(file.path)) {
        // Check if it might test any of our candidates
        const testedFile = this.getTestedFile(file.path);
        if (testedFile && candidatePaths.has(testedFile)) {
          this.addCandidate(candidates, file.path, { testFile: true });
        }

        // Also check by content - if test file content mentions candidate symbols
        const candidateSymbols = new Set<string>();
        for (const candidatePath of candidatePaths) {
          const symbols = this.db.getSymbolsByFile(candidatePath);
          symbols.forEach(s => candidateSymbols.add(s.name));
        }

        const testSymbols = this.db.getSymbolsByFile(file.path);
        for (const symbol of testSymbols) {
          if (candidateSymbols.has(symbol.name.replace('Test', '').replace('test_', ''))) {
            this.addCandidate(candidates, file.path, { testFile: true });
            break;
          }
        }
      }
    }
  }

  private isTestFile(filePath: string): boolean {
    const patterns = [
      /test/i,
      /spec/i,
      /__tests__/i,
      /\.test\./,
      /\.spec\./,
      /Test\.php$/,
      /Test\.ts$/,
      /Test\.js$/,
      /_test\.go$/,
      /_test\.py$/,
    ];
    return patterns.some(p => p.test(filePath));
  }

  private getTestedFile(testFilePath: string): string | null {
    // Try to infer the file being tested from the test file name
    const normalizedPath = testFilePath
      .replace(/test[s]?\//gi, '')
      .replace(/spec[s]?\//gi, '')
      .replace(/__tests__\//gi, '')
      .replace(/\.test\./g, '.')
      .replace(/\.spec\./g, '.')
      .replace(/Test\.php$/, '.php')
      .replace(/Test\.ts$/, '.ts')
      .replace(/Test\.js$/, '.js')
      .replace(/_test\.go$/, '.go')
      .replace(/_test\.py$/, '.py');

    // Check if this file exists in index
    const file = this.db.getFile(normalizedPath);
    if (file) {
      return normalizedPath;
    }

    return null;
  }

  private addCandidate(
    candidates: Map<string, CandidateSignals>,
    filePath: string,
    newSignals: Partial<CandidateSignals>
  ): void {
    const existing = candidates.get(filePath) || {
      stacktraceHit: false,
      diffHit: false,
      symbolMatch: false,
      keywordMatch: false,
      graphRelated: false,
      testFile: false,
      gitHotspot: false,
      relatedFile: false,
      exampleUsage: false,
    };

    candidates.set(filePath, {
      ...existing,
      ...newSignals,
    });
  }

  private normalizePath(filePath: string): string {
    return filePath
      .replace(/\\/g, '/')
      .replace(/^\.\//, '');
  }

  private findMatchingFiles(filePattern: string): string[] {
    const allFiles = this.db.getAllFiles();
    const normalizedPattern = this.normalizePath(filePattern).toLowerCase();

    // Try to match by filename
    const fileName = path.basename(normalizedPattern);

    return allFiles
      .filter(f => {
        const normalizedPath = f.path.toLowerCase();
        // Match full path or just filename
        return normalizedPath.includes(normalizedPattern) ||
               path.basename(normalizedPath) === fileName;
      })
      .map(f => f.path);
  }
}
