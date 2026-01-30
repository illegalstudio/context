import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskResolver } from '../../../src/core/resolver/TaskResolver.js';
import { createTempProject, cleanupTempProject } from '../../helpers/setup.js';

describe('TaskResolver', () => {
  let resolver: TaskResolver;
  let projectDir: string;

  beforeEach(async () => {
    projectDir = createTempProject({
      'package.json': '{"name": "test"}',
      'src/app.ts': 'export const app = 1;',
    });
    resolver = new TaskResolver(projectDir);
    await resolver.init();
  });

  afterEach(() => {
    if (projectDir) {
      cleanupTempProject(projectDir);
    }
  });

  describe('resolve()', () => {
    it('should resolve task with basic text', async () => {
      const result = await resolver.resolve({
        task: 'Fix bug in UserController where login fails',
      });

      expect(result.task.raw).toContain('Fix bug in UserController');
      expect(result.task.keywords.length).toBeGreaterThan(0);
      expect(result.task.changeType).toBe('bugfix');
    });

    it('should extract symbols from task', async () => {
      const result = await resolver.resolve({
        task: 'Bug in PaymentService.processPayment method',
      });

      expect(result.task.symbols.some(s =>
        s.toLowerCase().includes('payment') || s.toLowerCase().includes('service')
      )).toBe(true);
    });

    it('should extract file hints', async () => {
      const result = await resolver.resolve({
        task: 'Fix issue in app/Services/PaymentService.php',
      });

      expect(result.task.filesHint).toContain('app/Services/PaymentService.php');
    });

    it('should detect domains', async () => {
      const result = await resolver.resolve({
        task: 'Payment webhook failing for Stripe checkout',
      });

      expect(result.task.domains).toContain('payments');
    });

    it('should calculate domain weights', async () => {
      const result = await resolver.resolve({
        task: 'Payment processing, checkout, credit card validation',
      });

      expect(result.task.domainWeights).toBeDefined();
      expect(Object.keys(result.task.domainWeights).length).toBeGreaterThan(0);
    });

    it('should calculate confidence', async () => {
      const result = await resolver.resolve({
        task: 'Bug in UserController.php class UserService method handleAuth',
      });

      expect(result.task.confidence).toBeDefined();
      expect(result.task.confidence.overall).toBeGreaterThan(0);
    });

    it('should handle explicit file option', async () => {
      const result = await resolver.resolve({
        task: 'Some task',
        file: 'src/specific.ts',
      });

      expect(result.task.filesHint).toContain('src/specific.ts');
      expect(result.task.confidence.signals.hasExactFileName).toBe(true);
    });

    it('should handle explicit symbol option', async () => {
      const result = await resolver.resolve({
        task: 'Some task',
        symbol: 'MySpecificClass',
      });

      expect(result.task.symbols).toContain('MySpecificClass');
      expect(result.task.confidence.signals.hasMethodName).toBe(true);
    });

    it('should extract raw words from task', async () => {
      const result = await resolver.resolve({
        task: 'Fix payment processing bug',
      });

      expect(result.task.rawWords).toBeDefined();
      expect(result.task.rawWords.some(w => w === 'payment')).toBe(true);
    });

    it('should filter short words from rawWords', async () => {
      const result = await resolver.resolve({
        task: 'Fix a bug in the app',
      });

      // Words less than 3 chars should be filtered (unless allowed)
      expect(result.task.rawWords.every(w => w.length >= 3)).toBe(true);
    });

    it('should allow short technical terms', async () => {
      const result = await resolver.resolve({
        task: 'Issue with API endpoint and DB connection',
      });

      // "api" and "db" should be allowed despite being short
      expect(result.task.rawWords.some(w => w === 'api')).toBe(true);
    });
  });

  describe('isTaskVague()', () => {
    it('should identify vague tasks', async () => {
      const result = await resolver.resolve({
        task: 'Something is wrong',
      });

      expect(resolver.isTaskVague(result.task)).toBe(true);
    });

    it('should not mark detailed tasks as vague', async () => {
      const result = await resolver.resolve({
        task: 'Fix bug in app/Services/PaymentService.php class PaymentHandler method processCheckout',
      });

      expect(resolver.isTaskVague(result.task)).toBe(false);
    });
  });

  describe('needsClarification()', () => {
    it('should identify tasks needing clarification', async () => {
      const result = await resolver.resolve({
        task: 'Issue with user login',
      });

      // Medium confidence tasks need clarification
      const needsClarification = resolver.needsClarification(result.task);
      expect(typeof needsClarification).toBe('boolean');
    });
  });

  describe('generateSuggestions()', () => {
    it('should generate suggestions for vague tasks', async () => {
      const result = await resolver.resolve({
        task: 'Something is broken',
      });

      const suggestions = resolver.generateSuggestions(result.task);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some(s => s.includes('file path'))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle empty task', async () => {
      const result = await resolver.resolve({
        task: '',
      });

      expect(result.task.raw).toBe('');
      expect(result.task.confidence.overall).toBeLessThan(0.5);
    });
  });
});
