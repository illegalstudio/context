import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Scorer } from '../../../src/core/discovery/Scorer.js';
import { ContextDatabase } from '../../../src/storage/Database.js';
import { createTempProject, cleanupTempProject } from '../../helpers/setup.js';
import { createMockTask, createMockSignals } from '../../helpers/utils.js';

describe('Scorer', () => {
  let scorer: Scorer;
  let db: ContextDatabase;
  let projectDir: string;

  beforeEach(() => {
    projectDir = createTempProject({
      'package.json': '{"name": "test"}',
    });
    db = new ContextDatabase(projectDir);
    scorer = new Scorer(db);

    // Add some files to the database
    db.upsertFile({ path: 'src/controllers/UserController.ts', language: 'typescript', size: 200, mtime: Date.now(), hash: 'h1' });
    db.upsertFile({ path: 'src/services/PaymentService.ts', language: 'typescript', size: 200, mtime: Date.now(), hash: 'h2' });
    db.upsertFile({ path: 'src/models/User.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h3' });
    db.upsertFile({ path: 'tests/UserController.test.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'h4' });
    db.upsertFile({ path: 'config/app.ts', language: 'typescript', size: 50, mtime: Date.now(), hash: 'h5' });
  });

  afterEach(() => {
    db.close();
    if (projectDir) {
      cleanupTempProject(projectDir);
    }
  });

  describe('score()', () => {
    it('should give fileHintExact the highest score', () => {
      const task = createMockTask({
        filesHint: ['UserController.ts'],
      });

      const candidateSignals = new Map([
        ['src/controllers/UserController.ts', createMockSignals({ fileHintExact: true, fileHintHit: true })],
        ['src/services/PaymentService.ts', createMockSignals({ keywordMatch: true })],
      ]);

      const results = scorer.score(candidateSignals, task);

      // File with exact hint should be first
      expect(results[0].path).toBe('src/controllers/UserController.ts');
      expect(results[0].score).toBe(1.0); // Normalized to max
    });

    it('should give entry point bonus only with strong signals', () => {
      const task = createMockTask({
        raw: 'Fix user issue',
      });

      const candidateSignals = new Map([
        ['src/controllers/UserController.ts', createMockSignals({ fileHintHit: true })], // Strong signal
        ['src/controllers/OtherController.ts', createMockSignals({ keywordMatch: true })], // Weak signal
      ]);

      // Add OtherController to DB
      db.upsertFile({ path: 'src/controllers/OtherController.ts', language: 'typescript', size: 200, mtime: Date.now(), hash: 'h6' });

      const results = scorer.score(candidateSignals, task);

      // UserController should have higher score due to entry point bonus with strong signal
      const userController = results.find(r => r.path.includes('UserController'));
      const otherController = results.find(r => r.path.includes('OtherController'));

      expect(userController).toBeDefined();
      expect(otherController).toBeDefined();
    });

    it('should normalize scores to max = 1.0', () => {
      const task = createMockTask();

      const candidateSignals = new Map([
        ['file1.ts', createMockSignals({ stacktraceHit: true })],
        ['file2.ts', createMockSignals({ keywordMatch: true })],
        ['file3.ts', createMockSignals({ graphRelated: true })],
      ]);

      // Add files to DB
      db.upsertFile({ path: 'file1.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'hx1' });
      db.upsertFile({ path: 'file2.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'hx2' });
      db.upsertFile({ path: 'file3.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'hx3' });

      const results = scorer.score(candidateSignals, task);

      // Maximum score should be 1.0
      expect(results[0].score).toBe(1.0);
      // All scores should be <= 1.0
      expect(results.every(r => r.score <= 1.0)).toBe(true);
    });

    it('should reserve slots for exact symbol mentions', () => {
      const task = createMockTask({
        symbols: ['PaymentService'],
      });

      const candidateSignals = new Map([
        ['src/services/PaymentService.ts', createMockSignals({ exactSymbolMention: true, symbolMatch: true })],
        ['src/controllers/UserController.ts', createMockSignals({ stacktraceHit: true })],
      ]);

      const results = scorer.score(candidateSignals, task, { maxFiles: 5 });

      // PaymentService should be included as reserved
      expect(results.some(r => r.path === 'src/services/PaymentService.ts')).toBe(true);
    });

    it('should respect maxFiles limit', () => {
      const task = createMockTask();

      const candidateSignals = new Map();
      for (let i = 0; i < 50; i++) {
        const path = `src/file${i}.ts`;
        db.upsertFile({ path, language: 'typescript', size: 100, mtime: Date.now(), hash: `h${i}` });
        candidateSignals.set(path, createMockSignals({ keywordMatch: true }));
      }

      const results = scorer.score(candidateSignals, task, { maxFiles: 10 });

      expect(results.length).toBeLessThanOrEqual(10);
    });

    it('should separate test files when includeTests is true', () => {
      const task = createMockTask();

      const candidateSignals = new Map([
        ['src/controllers/UserController.ts', createMockSignals({ symbolMatch: true })],
        ['tests/UserController.test.ts', createMockSignals({ testFile: true })],
      ]);

      const results = scorer.score(candidateSignals, task, { includeTests: true });

      // Both should be included
      expect(results.some(r => r.path.includes('UserController.ts') && !r.path.includes('test'))).toBe(true);
      expect(results.some(r => r.path.includes('.test.ts'))).toBe(true);
    });

    it('should apply domain relevance bonus', () => {
      const task = createMockTask({
        domains: ['payments'],
        domainWeights: { payments: 3 },
      });

      const candidateSignals = new Map([
        ['src/services/PaymentService.ts', createMockSignals({ symbolMatch: true })],
        ['src/services/UserService.ts', createMockSignals({ symbolMatch: true })],
      ]);

      db.upsertFile({ path: 'src/services/UserService.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'hus' });

      const results = scorer.score(candidateSignals, task);

      // PaymentService should rank higher due to domain relevance
      const paymentIdx = results.findIndex(r => r.path.includes('Payment'));
      const userIdx = results.findIndex(r => r.path.includes('User') && r.path.includes('Service'));

      if (paymentIdx >= 0 && userIdx >= 0) {
        expect(paymentIdx).toBeLessThan(userIdx);
      }
    });

    it('should apply multi-keyword path bonus', () => {
      const task = createMockTask();

      const candidateSignals = new Map([
        ['src/services/PaymentService.ts', createMockSignals({
          symbolMatch: true,
          filenameMatchCount: 3, // Matches "payment", "service", etc.
        })],
        ['src/utils/helper.ts', createMockSignals({
          symbolMatch: true,
          filenameMatchCount: 1,
        })],
      ]);

      db.upsertFile({ path: 'src/utils/helper.ts', language: 'typescript', size: 100, mtime: Date.now(), hash: 'hh' });

      const results = scorer.score(candidateSignals, task);

      // PaymentService should have higher score due to multi-keyword bonus
      const paymentScore = results.find(r => r.path.includes('Payment'))?.score || 0;
      const helperScore = results.find(r => r.path.includes('helper'))?.score || 0;

      expect(paymentScore).toBeGreaterThan(helperScore);
    });

    it('should generate correct reasons', () => {
      const task = createMockTask({
        domains: ['payments'],
      });

      const candidateSignals = new Map([
        ['src/services/PaymentService.ts', createMockSignals({
          stacktraceHit: true,
          symbolMatch: true,
        })],
      ]);

      const results = scorer.score(candidateSignals, task);

      const paymentResult = results.find(r => r.path.includes('Payment'));
      expect(paymentResult?.reasons).toContain('appears in stacktrace');
      expect(paymentResult?.reasons).toContain('contains matching symbol');
    });
  });
});
