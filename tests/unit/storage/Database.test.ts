import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextDatabase } from '../../../src/storage/Database.js';
import { createTempDir, cleanupTempDir } from '../../helpers/setup.js';
import fs from 'fs';
import path from 'path';

describe('Database', () => {
  let db: ContextDatabase;
  let rootDir: string;

  beforeEach(() => {
    rootDir = path.join(createTempDir(), `db-${Date.now()}`);
    fs.mkdirSync(rootDir, { recursive: true });
    db = new ContextDatabase(rootDir);
  });

  afterEach(() => {
    db.close();
  });

  describe('File operations', () => {
    it('should upsert and get a file', () => {
      const file = {
        path: 'src/app.ts',
        language: 'typescript',
        size: 1024,
        mtime: Date.now(),
        hash: 'abc123',
      };

      db.upsertFile(file);
      const retrieved = db.getFile('src/app.ts');

      expect(retrieved).toBeDefined();
      expect(retrieved?.path).toBe('src/app.ts');
      expect(retrieved?.language).toBe('typescript');
      expect(retrieved?.size).toBe(1024);
      expect(retrieved?.hash).toBe('abc123');
    });

    it('should return undefined for non-existent file', () => {
      const retrieved = db.getFile('non-existent.ts');
      expect(retrieved).toBeUndefined();
    });

    it('should get all files', () => {
      db.upsertFile({ path: 'file1.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h1' });
      db.upsertFile({ path: 'file2.ts', language: 'typescript', size: 200, mtime: Date.now(), hash: 'h2' });
      db.upsertFile({ path: 'file3.ts', language: 'typescript', size: 300, mtime: Date.now(), hash: 'h3' });

      const files = db.getAllFiles();
      expect(files).toHaveLength(3);
      expect(files.map(f => f.path).sort()).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
    });

    it('should update existing file on upsert', () => {
      db.upsertFile({ path: 'app.ts', language: 'typescript', size: 100, mtime: 1000, hash: 'old' });
      db.upsertFile({ path: 'app.ts', language: 'typescript', size: 200, mtime: 2000, hash: 'new' });

      const retrieved = db.getFile('app.ts');
      expect(retrieved?.size).toBe(200);
      expect(retrieved?.mtime).toBe(2000);
      expect(retrieved?.hash).toBe('new');
    });

    it('should delete file and cascade to symbols', () => {
      db.upsertFile({ path: 'app.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h' });
      db.insertSymbol({
        filePath: 'app.ts',
        name: 'MyClass',
        kind: 'class',
        startLine: 1,
        endLine: 10,
      });

      db.deleteFile('app.ts');

      expect(db.getFile('app.ts')).toBeUndefined();
      expect(db.getSymbolsByFile('app.ts')).toHaveLength(0);
    });
  });

  describe('Symbol operations', () => {
    beforeEach(() => {
      db.upsertFile({ path: 'app.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h' });
    });

    it('should insert and get symbols by file', () => {
      db.insertSymbol({
        filePath: 'app.ts',
        name: 'UserService',
        kind: 'class',
        startLine: 10,
        endLine: 50,
        signature: 'class UserService',
      });

      const symbols = db.getSymbolsByFile('app.ts');
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('UserService');
      expect(symbols[0].kind).toBe('class');
    });

    it('should find symbols by name with LIKE query', () => {
      db.insertSymbol({ filePath: 'app.ts', name: 'UserService', kind: 'class', startLine: 1, endLine: 10 });
      db.insertSymbol({ filePath: 'app.ts', name: 'UserController', kind: 'class', startLine: 11, endLine: 20 });
      db.insertSymbol({ filePath: 'app.ts', name: 'PaymentService', kind: 'class', startLine: 21, endLine: 30 });

      const userSymbols = db.findSymbolsByName('User');
      expect(userSymbols).toHaveLength(2);

      const serviceSymbols = db.findSymbolsByName('Service');
      expect(serviceSymbols).toHaveLength(2);
    });

    it('should get all symbols with deduplication', () => {
      db.upsertFile({ path: 'file2.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h2' });

      db.insertSymbol({ filePath: 'app.ts', name: 'User', kind: 'class', startLine: 1, endLine: 10 });
      db.insertSymbol({ filePath: 'file2.ts', name: 'Payment', kind: 'class', startLine: 1, endLine: 10 });
      db.insertSymbol({ filePath: 'app.ts', name: 'process', kind: 'function', startLine: 11, endLine: 15 });

      const symbols = db.getAllSymbols();
      expect(symbols.length).toBeGreaterThanOrEqual(2);
    });

    it('should clear symbols for a file', () => {
      db.insertSymbol({ filePath: 'app.ts', name: 'Class1', kind: 'class', startLine: 1, endLine: 10 });
      db.insertSymbol({ filePath: 'app.ts', name: 'Class2', kind: 'class', startLine: 11, endLine: 20 });

      db.clearSymbolsForFile('app.ts');
      expect(db.getSymbolsByFile('app.ts')).toHaveLength(0);
    });
  });

  describe('Import graph operations', () => {
    beforeEach(() => {
      db.upsertFile({ path: 'a.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'ha' });
      db.upsertFile({ path: 'b.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'hb' });
      db.upsertFile({ path: 'c.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'hc' });
    });

    it('should insert import and get imports from source', () => {
      db.insertImport({ sourcePath: 'a.ts', targetPath: 'b.ts' });

      const imports = db.getImportsFrom('a.ts');
      expect(imports).toHaveLength(1);
      expect(imports[0].targetPath).toBe('b.ts');
    });

    it('should get importers of a target', () => {
      db.insertImport({ sourcePath: 'a.ts', targetPath: 'c.ts' });
      db.insertImport({ sourcePath: 'b.ts', targetPath: 'c.ts' });

      const importers = db.getImportersOf('c.ts');
      expect(importers).toHaveLength(2);
      expect(importers.map(i => i.sourcePath).sort()).toEqual(['a.ts', 'b.ts']);
    });

    it('should clear imports for a file', () => {
      db.insertImport({ sourcePath: 'a.ts', targetPath: 'b.ts' });
      db.insertImport({ sourcePath: 'a.ts', targetPath: 'c.ts' });

      db.clearImportsForFile('a.ts');
      expect(db.getImportsFrom('a.ts')).toHaveLength(0);
    });
  });

  describe('Full-text search operations', () => {
    beforeEach(() => {
      db.upsertFile({ path: 'app.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h1' });
      db.upsertFile({ path: 'user.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h2' });
    });

    it('should search content and find matches', () => {
      db.indexFileContent('app.ts', 'export class Application { constructor() {} }');
      db.indexFileContent('user.ts', 'export class User { name: string; }');

      const results = db.searchContent('class');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty for no matches', () => {
      db.indexFileContent('app.ts', 'export function hello() {}');

      const results = db.searchContent('xyz123nonexistent');
      expect(results).toHaveLength(0);
    });

    it('should handle special characters in query', () => {
      db.indexFileContent('app.ts', 'function test() { return true; }');

      // These should not throw errors
      const results1 = db.searchContent('test()');
      const results2 = db.searchContent('return -1');
      const results3 = db.searchContent('"quoted"');

      expect(results1).toBeDefined();
      expect(results2).toBeDefined();
      expect(results3).toBeDefined();
    });

    it('should return empty for very short queries', () => {
      db.indexFileContent('app.ts', 'export class A {}');

      const results = db.searchContent('a');
      expect(results).toHaveLength(0);
    });
  });

  describe('Git signals operations', () => {
    beforeEach(() => {
      db.upsertFile({ path: 'app.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h' });
    });

    it('should upsert and get git signal', () => {
      db.upsertGitSignal({
        path: 'app.ts',
        lastModified: '2024-01-01',
        commitCount: 50,
        churnScore: 0.75,
      });

      const signal = db.getGitSignal('app.ts');
      expect(signal).toBeDefined();
      expect(signal?.commitCount).toBe(50);
      expect(signal?.churnScore).toBe(0.75);
    });

    it('should return undefined for non-existent git signal', () => {
      const signal = db.getGitSignal('nonexistent.ts');
      expect(signal).toBeUndefined();
    });
  });

  describe('Utility operations', () => {
    it('should clear all data', () => {
      db.upsertFile({ path: 'app.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h' });
      db.insertSymbol({ filePath: 'app.ts', name: 'Test', kind: 'class', startLine: 1, endLine: 10 });

      db.clear();

      expect(db.getAllFiles()).toHaveLength(0);
      expect(db.getStats().files).toBe(0);
      expect(db.getStats().symbols).toBe(0);
    });

    it('should return correct stats', () => {
      db.upsertFile({ path: 'file1.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h1' });
      db.upsertFile({ path: 'file2.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h2' });
      db.insertSymbol({ filePath: 'file1.ts', name: 'A', kind: 'class', startLine: 1, endLine: 10 });
      db.insertSymbol({ filePath: 'file1.ts', name: 'B', kind: 'class', startLine: 11, endLine: 20 });
      db.insertImport({ sourcePath: 'file1.ts', targetPath: 'file2.ts' });

      const stats = db.getStats();
      expect(stats.files).toBe(2);
      expect(stats.symbols).toBe(2);
      expect(stats.imports).toBe(1);
    });
  });
});
