import fs from 'fs';
import path from 'path';
import { ContextDatabase } from '../../storage/Database.js';
import { FileScanner, type ScanOptions } from './FileScanner.js';
import { SymbolExtractor } from './SymbolExtractor.js';
import { ImportGraphBuilder } from './ImportGraphBuilder.js';
import { GitSignalsCollector } from './GitSignals.js';
import type { FileMetadata } from '../../types/index.js';

export interface IndexerOptions extends ScanOptions {
  verbose?: boolean;
  onProgress?: (current: number, total: number, file: string) => void;
}

export interface IndexStats {
  files: number;
  symbols: number;
  imports: number;
  duration: number;
}

export class Indexer {
  private rootDir: string;
  private db: ContextDatabase;
  private fileScanner: FileScanner;
  private symbolExtractor: SymbolExtractor;
  private importGraphBuilder: ImportGraphBuilder;
  private gitSignals: GitSignalsCollector;
  private options: IndexerOptions;

  constructor(rootDir: string, options: IndexerOptions = {}) {
    this.rootDir = path.resolve(rootDir);
    this.options = options;
    this.db = new ContextDatabase(this.rootDir);
    this.fileScanner = new FileScanner(this.rootDir, options);
    this.symbolExtractor = new SymbolExtractor(this.rootDir);
    this.importGraphBuilder = new ImportGraphBuilder(this.rootDir);
    this.gitSignals = new GitSignalsCollector(this.rootDir);
  }

  async index(): Promise<IndexStats> {
    const startTime = Date.now();

    // 1. Scan files
    this.log('Scanning files...');
    const files = await this.fileScanner.scan();
    this.log(`Found ${files.length} files`);

    // Build file index for import resolution
    this.importGraphBuilder.setFileIndex(files.map(f => f.path));

    // 2. Index each file
    let processed = 0;
    const total = files.length;

    for (const file of files) {
      // Update progress
      if (this.options.onProgress) {
        this.options.onProgress(processed + 1, total, file.path);
      }

      await this.indexFile(file);
      processed++;
    }

    // 3. Collect git signals
    if (this.gitSignals.isAvailable()) {
      this.log('Collecting git signals...');
      const signals = await this.gitSignals.collectSignals(files.map(f => f.path));
      for (const [filePath, signal] of signals) {
        this.db.upsertGitSignal(signal);
      }
    }

    const duration = Date.now() - startTime;
    const stats = this.db.getStats();

    return {
      ...stats,
      duration,
    };
  }

  private async indexFile(file: FileMetadata): Promise<void> {
    // Check if file has changed since last index
    const existing = this.db.getFile(file.path);
    if (existing && existing.hash === file.hash) {
      // File unchanged, skip
      return;
    }

    // Upsert file metadata
    this.db.upsertFile(file);

    // Clear old data for this file
    this.db.clearSymbolsForFile(file.path);
    this.db.clearImportsForFile(file.path);

    // Extract symbols
    if (file.language !== 'unknown') {
      const symbols = await this.symbolExtractor.extractSymbols(file.path, file.language);
      for (const symbol of symbols) {
        this.db.insertSymbol(symbol);
      }
    }

    // Extract imports
    const imports = await this.importGraphBuilder.extractImports(file.path, file.language);
    for (const imp of imports) {
      this.db.insertImport(imp);
    }

    // Index file content for FTS
    try {
      const fullPath = path.join(this.rootDir, file.path);
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      this.db.indexFileContent(file.path, content);
    } catch {
      // Skip FTS indexing on read error
    }
  }

  async incrementalUpdate(changedFiles: string[]): Promise<IndexStats> {
    const startTime = Date.now();

    for (const filePath of changedFiles) {
      const fullPath = path.join(this.rootDir, filePath);

      // Check if file exists
      try {
        const stat = await fs.promises.stat(fullPath);
        const content = await fs.promises.readFile(fullPath);
        const crypto = await import('crypto');
        const hash = crypto.createHash('md5').update(content).digest('hex');

        const file: FileMetadata = {
          path: filePath,
          language: FileScanner.detectLanguage(filePath),
          size: stat.size,
          mtime: Math.floor(stat.mtimeMs),
          hash,
        };

        await this.indexFile(file);
      } catch {
        // File was deleted
        this.db.deleteFile(filePath);
      }
    }

    const duration = Date.now() - startTime;
    const stats = this.db.getStats();

    return {
      ...stats,
      duration,
    };
  }

  getDatabase(): ContextDatabase {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  private log(message: string): void {
    if (this.options.verbose) {
      console.log(message);
    }
  }

  static isInitialized(rootDir: string): boolean {
    const contextDir = path.join(rootDir, '.context');
    const dbPath = path.join(contextDir, 'index.db');
    return fs.existsSync(dbPath);
  }
}
