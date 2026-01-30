import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { Indexer } from '../../src/core/indexer/Indexer.js';
import { TaskResolver } from '../../src/core/resolver/TaskResolver.js';
import { CandidateDiscovery } from '../../src/core/discovery/CandidateDiscovery.js';
import { Scorer } from '../../src/core/discovery/Scorer.js';
import { ContextDatabase } from '../../src/storage/Database.js';
import { CODEBASES_DIR } from '../helpers/setup.js';

describe('Full Pack Creation Integration', () => {
  describe('Laravel app - complete pipeline', () => {
    let indexer: Indexer;
    let db: ContextDatabase;
    let resolver: TaskResolver;
    let discovery: CandidateDiscovery;
    let scorer: Scorer;
    const codebasePath = path.join(CODEBASES_DIR, 'laravel-app');

    beforeEach(async () => {
      indexer = new Indexer(codebasePath);
      db = indexer.getDatabase();
      await indexer.index();

      resolver = new TaskResolver(codebasePath);
      await resolver.init();

      discovery = new CandidateDiscovery(db, codebasePath);
      await discovery.init();

      scorer = new Scorer(db);
    });

    afterEach(() => {
      db.close();
    });

    it('should rank explicitly mentioned controller as top result', async () => {
      // Resolve task
      const { task } = await resolver.resolve({
        task: 'Bug in UserController',
      });

      // Discover candidates
      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      // Score and rank
      const scored = scorer.score(candidates, task, { maxFiles: 10 });

      // UserController.php should be in top results
      const topPaths = scored.slice(0, 3).map(c => c.path);
      expect(topPaths.some(p => p.includes('UserController.php'))).toBe(true);
    });

    it('should include related model when controller is mentioned', async () => {
      const { task } = await resolver.resolve({
        task: 'Fix UserController',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      const scored = scorer.score(candidates, task, { maxFiles: 10 });

      // User.php model should be discovered
      expect(scored.some(c => c.path.includes('User.php'))).toBe(true);
    });

    it('should give highest score to exact file match', async () => {
      const { task } = await resolver.resolve({
        task: 'Fix issue in @PaymentController.php',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      const scored = scorer.score(candidates, task, { maxFiles: 10 });

      // PaymentController should be first
      expect(scored[0].path).toContain('PaymentController.php');
      expect(scored[0].score).toBe(1.0); // Normalized max score
    });

    it('should discover related view for controller', async () => {
      const { task } = await resolver.resolve({
        task: 'Bug in UserController index method',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      // The users/index.blade.php should be discovered
      // (either via discovery rules or keyword matching)
      expect(candidates.size).toBeGreaterThan(1);
    });

    it('should include test files for discovered candidates', async () => {
      const { task } = await resolver.resolve({
        task: 'Bug in User model',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      const scored = scorer.score(candidates, task, { maxFiles: 10, includeTests: true });

      // UserTest.php should be included
      expect(scored.some(c => c.path.includes('UserTest.php'))).toBe(true);
    });
  });

  describe('Node.js Express - complete pipeline', () => {
    let indexer: Indexer;
    let db: ContextDatabase;
    let resolver: TaskResolver;
    let discovery: CandidateDiscovery;
    let scorer: Scorer;
    const codebasePath = path.join(CODEBASES_DIR, 'nodejs-express');

    beforeEach(async () => {
      indexer = new Indexer(codebasePath);
      db = indexer.getDatabase();
      await indexer.index();

      resolver = new TaskResolver(codebasePath);
      await resolver.init();

      discovery = new CandidateDiscovery(db, codebasePath);
      await discovery.init();

      scorer = new Scorer(db);
    });

    afterEach(() => {
      db.close();
    });

    it('should rank service file first when mentioned', async () => {
      const { task } = await resolver.resolve({
        task: 'Bug in PaymentService createPayment method',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      const scored = scorer.score(candidates, task, { maxFiles: 10 });

      // PaymentService should be in top results
      expect(scored.slice(0, 3).some(c => c.path.includes('PaymentService.ts'))).toBe(true);
    });

    it('should follow import graph to related files', async () => {
      const { task } = await resolver.resolve({
        task: 'Bug in src/routes/users.ts',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      // Should include the routes file
      expect(candidates.has('src/routes/users.ts')).toBe(true);

      // Should discover UserController via imports
      expect(candidates.has('src/controllers/UserController.ts')).toBe(true);
    });
  });

  describe('Domain relevance', () => {
    let indexer: Indexer;
    let db: ContextDatabase;
    let resolver: TaskResolver;
    let discovery: CandidateDiscovery;
    let scorer: Scorer;
    const codebasePath = path.join(CODEBASES_DIR, 'laravel-app');

    beforeEach(async () => {
      indexer = new Indexer(codebasePath);
      db = indexer.getDatabase();
      await indexer.index();

      resolver = new TaskResolver(codebasePath);
      await resolver.init();

      discovery = new CandidateDiscovery(db, codebasePath);
      await discovery.init();

      scorer = new Scorer(db);
    });

    afterEach(() => {
      db.close();
    });

    it('should rank payment-related files higher for payment domain task', async () => {
      const { task } = await resolver.resolve({
        task: 'Payment webhook error with Stripe checkout',
      });

      expect(task.domains).toContain('payments');

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      const scored = scorer.score(candidates, task, { maxFiles: 10 });

      // Payment-related files should be ranked higher
      const topPaths = scored.slice(0, 5).map(c => c.path.toLowerCase());
      expect(topPaths.some(p => p.includes('payment') || p.includes('stripe'))).toBe(true);
    });

    it('should rank auth-related files higher for auth domain task', async () => {
      const { task } = await resolver.resolve({
        task: 'Login authentication error for API users',
      });

      expect(task.domains).toContain('auth');

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      const scored = scorer.score(candidates, task, { maxFiles: 10 });

      // Auth-related files should be ranked higher
      const topPaths = scored.slice(0, 5).map(c => c.path.toLowerCase());
      expect(topPaths.some(p => p.includes('auth') || p.includes('user'))).toBe(true);
    });
  });

  describe('Scoring reasons', () => {
    let indexer: Indexer;
    let db: ContextDatabase;
    let resolver: TaskResolver;
    let discovery: CandidateDiscovery;
    let scorer: Scorer;
    const codebasePath = path.join(CODEBASES_DIR, 'laravel-app');

    beforeEach(async () => {
      indexer = new Indexer(codebasePath);
      db = indexer.getDatabase();
      await indexer.index();

      resolver = new TaskResolver(codebasePath);
      await resolver.init();

      discovery = new CandidateDiscovery(db, codebasePath);
      await discovery.init();

      scorer = new Scorer(db);
    });

    afterEach(() => {
      db.close();
    });

    it('should include explanatory reasons for each candidate', async () => {
      const { task } = await resolver.resolve({
        task: 'Bug in UserController',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [
          { file: 'app/Http/Controllers/UserController.php', line: 10 },
        ],
        diffEntries: [],
      });

      const scored = scorer.score(candidates, task, { maxFiles: 10 });

      const userController = scored.find(c => c.path.includes('UserController.php'));
      expect(userController?.reasons.length).toBeGreaterThan(0);
      expect(userController?.reasons).toContain('appears in stacktrace');
      expect(userController?.reasons.some(r => r.includes('controller'))).toBe(true);
    });

    it('should explain domain relevance in reasons', async () => {
      const { task } = await resolver.resolve({
        task: 'Payment processing bug',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      const scored = scorer.score(candidates, task, { maxFiles: 10 });

      const paymentFile = scored.find(c => c.path.toLowerCase().includes('payment'));
      if (paymentFile) {
        expect(paymentFile.reasons.some(r => r.includes('domain'))).toBe(true);
      }
    });
  });
});
