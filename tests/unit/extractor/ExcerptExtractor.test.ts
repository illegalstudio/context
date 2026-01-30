import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExcerptExtractor } from '../../../src/core/extractor/ExcerptExtractor.js';
import { ContextDatabase } from '../../../src/storage/Database.js';
import { createTempProject, cleanupTempProject } from '../../helpers/setup.js';
import { createMockSignals } from '../../helpers/utils.js';

describe('ExcerptExtractor', () => {
  let extractor: ExcerptExtractor;
  let db: ContextDatabase;
  let projectDir: string;

  beforeEach(() => {
    projectDir = createTempProject({
      'src/service.ts': `// Line 1
// Line 2
export class UserService {
  // Line 4
  constructor() {
    // Line 6
  }
  // Line 8
  async getUsers() {
    // Line 10
    return [];
    // Line 12
  }
  // Line 14
  async createUser(data: any) {
    // Line 16
    return data;
    // Line 18
  }
  // Line 20
}
// Line 22
`,
      'package.json': '{"name": "test"}',
    });

    db = new ContextDatabase(projectDir);

    // Index file
    db.upsertFile({ path: 'src/service.ts', language: 'typescript', size: 500, mtime: Date.now(), hash: 'h1' });

    // Index symbols
    db.insertSymbol({ filePath: 'src/service.ts', name: 'UserService', kind: 'class', startLine: 3, endLine: 21 });
    db.insertSymbol({ filePath: 'src/service.ts', name: 'getUsers', kind: 'method', startLine: 9, endLine: 13 });
    db.insertSymbol({ filePath: 'src/service.ts', name: 'createUser', kind: 'method', startLine: 15, endLine: 19 });

    // Note: ExcerptExtractor constructor signature is (rootDir, db, options)
    extractor = new ExcerptExtractor(projectDir, db);
  });

  afterEach(() => {
    db.close();
    if (projectDir) {
      cleanupTempProject(projectDir);
    }
  });

  describe('extractExcerpts()', () => {
    it('should extract excerpts for candidates', async () => {
      const candidates = [
        { path: 'src/service.ts', score: 1.0, reasons: [], signals: createMockSignals() }
      ];

      const excerpts = await extractor.extractExcerpts(candidates);

      expect(excerpts).toHaveLength(1);
      expect(excerpts[0].path).toBe('src/service.ts');
      expect(excerpts[0].content).toContain('export class UserService');
    });

    it('should return excerpt metadata', async () => {
      const candidates = [
        { path: 'src/service.ts', score: 1.0, reasons: [], signals: createMockSignals() }
      ];

      const excerpts = await extractor.extractExcerpts(candidates);

      // Content should exist and have meaningful data
      expect(excerpts[0].content.length).toBeGreaterThan(0);
      // Should have line metadata
      expect(excerpts[0].startLine).toBeDefined();
      expect(excerpts[0].totalLines).toBeGreaterThan(0);
    });

    it('should handle non-existent file gracefully', async () => {
      const candidates = [
        { path: 'src/nonexistent.ts', score: 1.0, reasons: [], signals: createMockSignals() }
      ];

      const excerpts = await extractor.extractExcerpts(candidates);

      // Should return empty array or skip missing files
      expect(excerpts.length).toBeLessThanOrEqual(1);
    });

    it('should extract multiple files', async () => {
      projectDir = createTempProject({
        'src/a.ts': 'export const a = 1;',
        'src/b.ts': 'export const b = 2;',
        'package.json': '{"name": "test"}',
      });

      db.close();
      db = new ContextDatabase(projectDir);
      db.upsertFile({ path: 'src/a.ts', language: 'typescript', size: 20, mtime: Date.now(), hash: 'ha' });
      db.upsertFile({ path: 'src/b.ts', language: 'typescript', size: 20, mtime: Date.now(), hash: 'hb' });

      extractor = new ExcerptExtractor(projectDir, db);

      const candidates = [
        { path: 'src/a.ts', score: 1.0, reasons: [], signals: createMockSignals() },
        { path: 'src/b.ts', score: 0.8, reasons: [], signals: createMockSignals() },
      ];

      const excerpts = await extractor.extractExcerpts(candidates);

      expect(excerpts).toHaveLength(2);
      expect(excerpts.some(e => e.path === 'src/a.ts')).toBe(true);
      expect(excerpts.some(e => e.path === 'src/b.ts')).toBe(true);
    });

    it('should mark truncation correctly for small files', async () => {
      const candidates = [
        { path: 'src/service.ts', score: 1.0, reasons: [], signals: createMockSignals() }
      ];

      const excerpts = await extractor.extractExcerpts(candidates);

      // Small file should not be truncated
      expect(excerpts[0].truncated).toBe(false);
    });
  });

  describe('extractSymbol()', () => {
    it('should extract specific symbol from file', async () => {
      const symbolContent = await extractor.extractSymbol('src/service.ts', 'getUsers');

      expect(symbolContent).toBeDefined();
      expect(symbolContent).toContain('getUsers');
    });

    it('should return null for non-existent symbol', async () => {
      const symbolContent = await extractor.extractSymbol('src/service.ts', 'nonExistent');

      expect(symbolContent).toBeNull();
    });
  });
});
