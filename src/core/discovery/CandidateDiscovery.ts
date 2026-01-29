import path from 'path';
import { ContextDatabase } from '../../storage/Database.js';
import type { ResolvedTask, Candidate, CandidateSignals, StacktraceEntry, DiffEntry } from '../../types/index.js';

export interface DiscoveryContext {
  task: ResolvedTask;
  stacktraceEntries: StacktraceEntry[];
  diffEntries: DiffEntry[];
}

export class CandidateDiscovery {
  private db: ContextDatabase;
  private rootDir: string;

  constructor(db: ContextDatabase, rootDir: string) {
    this.db = db;
    this.rootDir = rootDir;
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
    ]);

    // Expand graph to find related files
    await this.expandGraph(candidates);

    // Add test files for discovered candidates
    await this.discoverTestFiles(candidates);

    return candidates;
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
    for (const keyword of task.keywords.slice(0, 10)) { // Limit to top 10 keywords
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
