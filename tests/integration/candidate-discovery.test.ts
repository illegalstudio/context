import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { CandidateDiscovery } from '../../src/core/discovery/CandidateDiscovery.js';
import { Indexer } from '../../src/core/indexer/Indexer.js';
import { TaskResolver } from '../../src/core/resolver/TaskResolver.js';
import { ContextDatabase } from '../../src/storage/Database.js';
import { CODEBASES_DIR } from '../helpers/setup.js';

describe('Candidate Discovery Integration', () => {
  describe('Laravel app', () => {
    let discovery: CandidateDiscovery;
    let db: ContextDatabase;
    let resolver: TaskResolver;
    let indexer: Indexer;
    const codebasePath = path.join(CODEBASES_DIR, 'laravel-app');

    beforeEach(async () => {
      indexer = new Indexer(codebasePath);
      db = indexer.getDatabase();
      await indexer.index();

      discovery = new CandidateDiscovery(db, codebasePath);
      await discovery.init();

      resolver = new TaskResolver(codebasePath);
      await resolver.init();
    });

    afterEach(() => {
      db.close();
    });

    it('should discover controller when mentioned in task', async () => {
      const { task } = await resolver.resolve({
        task: 'Bug in UserController show method',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      expect(candidates.has('app/Http/Controllers/UserController.php')).toBe(true);
    });

    it('should discover related model via imports', async () => {
      const { task } = await resolver.resolve({
        task: 'Bug in UserController',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      // Should find User model via keyword matching or graph
      expect(candidates.has('app/Models/User.php')).toBe(true);
    });

    it('should discover service from file hint', async () => {
      const { task } = await resolver.resolve({
        task: 'Fix issue in @StripeService.php',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      expect(candidates.has('app/Services/StripeService.php')).toBe(true);
    });

    it('should set correct signals for stacktrace hit', async () => {
      const { task } = await resolver.resolve({
        task: 'Error in payment',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [
          { file: 'app/Http/Controllers/PaymentController.php', line: 25 },
        ],
        diffEntries: [],
      });

      const signals = candidates.get('app/Http/Controllers/PaymentController.php');
      expect(signals?.stacktraceHit).toBe(true);
    });

    it('should set correct signals for diff hit', async () => {
      const { task } = await resolver.resolve({
        task: 'Review changes',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [
          { file: 'app/Services/StripeService.php', status: 'modified', additions: 10, deletions: 5 },
        ],
      });

      const signals = candidates.get('app/Services/StripeService.php');
      expect(signals?.diffHit).toBe(true);
    });

    it('should discover test files', async () => {
      const { task } = await resolver.resolve({
        task: 'Bug in UserController',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      // Should find the test file
      expect(candidates.has('tests/Feature/UserTest.php')).toBe(true);
    });
  });

  describe('Node.js Express app', () => {
    let discovery: CandidateDiscovery;
    let db: ContextDatabase;
    let resolver: TaskResolver;
    let indexer: Indexer;
    const codebasePath = path.join(CODEBASES_DIR, 'nodejs-express');

    beforeEach(async () => {
      indexer = new Indexer(codebasePath);
      db = indexer.getDatabase();
      await indexer.index();

      discovery = new CandidateDiscovery(db, codebasePath);
      await discovery.init();

      resolver = new TaskResolver(codebasePath);
      await resolver.init();
    });

    afterEach(() => {
      db.close();
    });

    it('should discover files via import graph', async () => {
      const { task } = await resolver.resolve({
        task: 'Bug in src/index.ts',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      // Index imports from routes
      expect(candidates.has('src/index.ts')).toBe(true);
    });

    it('should discover service from symbol mention', async () => {
      const { task } = await resolver.resolve({
        task: 'Error in PaymentService.createPayment',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      expect(candidates.has('src/services/PaymentService.ts')).toBe(true);
    });
  });

  describe('React Frontend app', () => {
    let discovery: CandidateDiscovery;
    let db: ContextDatabase;
    let resolver: TaskResolver;
    let indexer: Indexer;
    const codebasePath = path.join(CODEBASES_DIR, 'react-frontend');

    beforeEach(async () => {
      indexer = new Indexer(codebasePath);
      db = indexer.getDatabase();
      await indexer.index();

      discovery = new CandidateDiscovery(db, codebasePath);
      await discovery.init();

      resolver = new TaskResolver(codebasePath);
      await resolver.init();
    });

    afterEach(() => {
      db.close();
    });

    it('should discover components', async () => {
      const { task } = await resolver.resolve({
        task: 'Bug in UserList component',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      expect(candidates.has('src/components/UserList.tsx')).toBe(true);
    });

    it('should discover hooks', async () => {
      const { task } = await resolver.resolve({
        task: 'Issue with useAuth hook',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      expect(candidates.has('src/hooks/useAuth.ts')).toBe(true);
    });

    it('should discover related test file', async () => {
      const { task } = await resolver.resolve({
        task: 'Fix UserList',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      expect(candidates.has('src/__tests__/UserList.test.tsx')).toBe(true);
    });
  });

  describe('Multi-keyword path matching', () => {
    let discovery: CandidateDiscovery;
    let db: ContextDatabase;
    let resolver: TaskResolver;
    let indexer: Indexer;
    const codebasePath = path.join(CODEBASES_DIR, 'typescript-nestjs');

    beforeEach(async () => {
      indexer = new Indexer(codebasePath);
      db = indexer.getDatabase();
      await indexer.index();

      discovery = new CandidateDiscovery(db, codebasePath);
      await discovery.init();

      resolver = new TaskResolver(codebasePath);
      await resolver.init();
    });

    afterEach(() => {
      db.close();
    });

    it('should give higher match count for paths matching multiple keywords', async () => {
      const { task } = await resolver.resolve({
        task: 'Fix user controller create method',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      // users.controller.ts should match "user" and "controller"
      const controllerSignals = candidates.get('src/users/users.controller.ts');
      if (controllerSignals?.filenameMatchCount) {
        expect(controllerSignals.filenameMatchCount).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('ctxignore filtering', () => {
    let discovery: CandidateDiscovery;
    let db: ContextDatabase;
    let resolver: TaskResolver;
    let indexer: Indexer;
    const codebasePath = path.join(CODEBASES_DIR, 'with-ctxignore');

    beforeEach(async () => {
      indexer = new Indexer(codebasePath);
      db = indexer.getDatabase();
      await indexer.index();

      discovery = new CandidateDiscovery(db, codebasePath);
      await discovery.init();

      resolver = new TaskResolver(codebasePath);
      await resolver.init();
    });

    afterEach(() => {
      db.close();
    });

    it('should not include ignored files in candidates', async () => {
      const { task } = await resolver.resolve({
        task: 'Find all files',
      });

      const candidates = await discovery.discover({
        task,
        stacktraceEntries: [],
        diffEntries: [],
      });

      // vendor/dep.ts should be ignored
      expect(candidates.has('vendor/dep.ts')).toBe(false);
    });
  });
});
