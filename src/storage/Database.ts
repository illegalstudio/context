import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { FileMetadata, Symbol, ImportRelation, GitSignal } from '../types/index.js';

const SCHEMA = `
-- Files metadata
CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    language TEXT,
    size INTEGER,
    mtime INTEGER,
    hash TEXT
);

-- Symbols (classes, functions, methods)
CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT,
    name TEXT,
    kind TEXT,
    start_line INTEGER,
    end_line INTEGER,
    signature TEXT,
    FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE
);

-- Import graph
CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT,
    target_path TEXT,
    symbol TEXT,
    FOREIGN KEY (source_path) REFERENCES files(path) ON DELETE CASCADE
);

-- Git signals
CREATE TABLE IF NOT EXISTS git_signals (
    path TEXT PRIMARY KEY,
    last_modified TEXT,
    commit_count INTEGER,
    churn_score REAL,
    FOREIGN KEY (path) REFERENCES files(path) ON DELETE CASCADE
);

-- Full-text search for content
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(path, content);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_imports_source ON imports(source_path);
CREATE INDEX IF NOT EXISTS idx_imports_target ON imports(target_path);
`;

export class ContextDatabase {
  private db: Database.Database;
  private dbPath: string;

  constructor(rootDir: string) {
    const contextDir = path.join(rootDir, '.context');
    if (!fs.existsSync(contextDir)) {
      fs.mkdirSync(contextDir, { recursive: true });
    }

    this.dbPath = path.join(contextDir, 'index.db');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  private init(): void {
    this.db.exec(SCHEMA);
  }

  // File operations
  upsertFile(file: FileMetadata): void {
    const stmt = this.db.prepare(`
      INSERT INTO files (path, language, size, mtime, hash)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        language = excluded.language,
        size = excluded.size,
        mtime = excluded.mtime,
        hash = excluded.hash
    `);
    stmt.run(file.path, file.language, file.size, file.mtime, file.hash);
  }

  getFile(filePath: string): FileMetadata | undefined {
    const stmt = this.db.prepare('SELECT * FROM files WHERE path = ?');
    const row = stmt.get(filePath) as any;
    if (!row) return undefined;
    return {
      path: row.path,
      language: row.language,
      size: row.size,
      mtime: row.mtime,
      hash: row.hash,
    };
  }

  getAllFiles(): FileMetadata[] {
    const stmt = this.db.prepare('SELECT * FROM files');
    return (stmt.all() as any[]).map(row => ({
      path: row.path,
      language: row.language,
      size: row.size,
      mtime: row.mtime,
      hash: row.hash,
    }));
  }

  deleteFile(filePath: string): void {
    this.db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
  }

  // Symbol operations
  insertSymbol(symbol: Symbol): void {
    const stmt = this.db.prepare(`
      INSERT INTO symbols (file_path, name, kind, start_line, end_line, signature)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(symbol.filePath, symbol.name, symbol.kind, symbol.startLine, symbol.endLine, symbol.signature || null);
  }

  getSymbolsByFile(filePath: string): Symbol[] {
    const stmt = this.db.prepare('SELECT * FROM symbols WHERE file_path = ?');
    return (stmt.all(filePath) as any[]).map(row => ({
      id: row.id,
      filePath: row.file_path,
      name: row.name,
      kind: row.kind,
      startLine: row.start_line,
      endLine: row.end_line,
      signature: row.signature,
    }));
  }

  findSymbolsByName(name: string): Symbol[] {
    const stmt = this.db.prepare('SELECT * FROM symbols WHERE name LIKE ?');
    return (stmt.all(`%${name}%`) as any[]).map(row => ({
      id: row.id,
      filePath: row.file_path,
      name: row.name,
      kind: row.kind,
      startLine: row.start_line,
      endLine: row.end_line,
      signature: row.signature,
    }));
  }

  clearSymbolsForFile(filePath: string): void {
    this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(filePath);
  }

  // Import graph operations
  insertImport(importRel: ImportRelation): void {
    const stmt = this.db.prepare(`
      INSERT INTO imports (source_path, target_path, symbol)
      VALUES (?, ?, ?)
    `);
    stmt.run(importRel.sourcePath, importRel.targetPath, importRel.symbol || null);
  }

  getImportsFrom(sourcePath: string): ImportRelation[] {
    const stmt = this.db.prepare('SELECT * FROM imports WHERE source_path = ?');
    return (stmt.all(sourcePath) as any[]).map(row => ({
      sourcePath: row.source_path,
      targetPath: row.target_path,
      symbol: row.symbol,
    }));
  }

  getImportersOf(targetPath: string): ImportRelation[] {
    const stmt = this.db.prepare('SELECT * FROM imports WHERE target_path = ?');
    return (stmt.all(targetPath) as any[]).map(row => ({
      sourcePath: row.source_path,
      targetPath: row.target_path,
      symbol: row.symbol,
    }));
  }

  clearImportsForFile(sourcePath: string): void {
    this.db.prepare('DELETE FROM imports WHERE source_path = ?').run(sourcePath);
  }

  // Git signals operations
  upsertGitSignal(signal: GitSignal): void {
    const stmt = this.db.prepare(`
      INSERT INTO git_signals (path, last_modified, commit_count, churn_score)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        last_modified = excluded.last_modified,
        commit_count = excluded.commit_count,
        churn_score = excluded.churn_score
    `);
    stmt.run(signal.path, signal.lastModified || null, signal.commitCount, signal.churnScore);
  }

  getGitSignal(filePath: string): GitSignal | undefined {
    const stmt = this.db.prepare('SELECT * FROM git_signals WHERE path = ?');
    const row = stmt.get(filePath) as any;
    if (!row) return undefined;
    return {
      path: row.path,
      lastModified: row.last_modified,
      commitCount: row.commit_count,
      churnScore: row.churn_score,
    };
  }

  // Full-text search operations
  indexFileContent(filePath: string, content: string): void {
    // First remove existing entry
    this.db.prepare('DELETE FROM files_fts WHERE path = ?').run(filePath);
    // Then insert new content
    this.db.prepare('INSERT INTO files_fts (path, content) VALUES (?, ?)').run(filePath, content);
  }

  searchContent(query: string, limit: number = 50): Array<{ path: string; rank: number }> {
    const stmt = this.db.prepare(`
      SELECT path, rank
      FROM files_fts
      WHERE files_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    return (stmt.all(query, limit) as any[]).map(row => ({
      path: row.path,
      rank: row.rank,
    }));
  }

  // Utility operations
  clear(): void {
    this.db.exec(`
      DELETE FROM files_fts;
      DELETE FROM git_signals;
      DELETE FROM imports;
      DELETE FROM symbols;
      DELETE FROM files;
    `);
  }

  getStats(): { files: number; symbols: number; imports: number } {
    const files = (this.db.prepare('SELECT COUNT(*) as count FROM files').get() as any).count;
    const symbols = (this.db.prepare('SELECT COUNT(*) as count FROM symbols').get() as any).count;
    const imports = (this.db.prepare('SELECT COUNT(*) as count FROM imports').get() as any).count;
    return { files, symbols, imports };
  }

  close(): void {
    this.db.close();
  }
}
