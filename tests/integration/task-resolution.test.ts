import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { TaskResolver } from '../../src/core/resolver/TaskResolver.js';
import { CODEBASES_DIR } from '../helpers/setup.js';

describe('Task Resolution Integration', () => {
  describe('Laravel app', () => {
    let resolver: TaskResolver;
    const codebasePath = path.join(CODEBASES_DIR, 'laravel-app');

    beforeEach(async () => {
      resolver = new TaskResolver(codebasePath);
      await resolver.init();
    });

    it('should resolve task mentioning controller', async () => {
      const result = await resolver.resolve({
        task: 'Bug in UserController when creating new users',
      });

      expect(result.task.symbols.some(s =>
        s.toLowerCase().includes('user') || s.toLowerCase().includes('controller')
      )).toBe(true);
      expect(result.task.changeType).toBe('bugfix');
    });

    it('should resolve task with file path', async () => {
      const result = await resolver.resolve({
        task: 'Fix issue in app/Services/StripeService.php',
      });

      expect(result.task.filesHint).toContain('app/Services/StripeService.php');
      expect(result.task.confidence.signals.hasExactFileName).toBe(true);
    });

    it('should detect payment domain', async () => {
      const result = await resolver.resolve({
        task: 'Payment webhook handling error for Stripe checkout',
      });

      expect(result.task.domains).toContain('payments');
    });
  });

  describe('Node.js Express app', () => {
    let resolver: TaskResolver;
    const codebasePath = path.join(CODEBASES_DIR, 'nodejs-express');

    beforeEach(async () => {
      resolver = new TaskResolver(codebasePath);
      await resolver.init();
    });

    it('should resolve TypeScript class names', async () => {
      const result = await resolver.resolve({
        task: 'Error in PaymentService.createPayment method',
      });

      expect(result.task.symbols.some(s =>
        s.toLowerCase().includes('payment')
      )).toBe(true);
    });

    it('should resolve API route mentions', async () => {
      const result = await resolver.resolve({
        task: 'Issue with POST /api/users endpoint',
      });

      // Route patterns are detected via confidence signals
      expect(result.task.confidence.signals.hasRoutePattern).toBe(true);
    });
  });

  describe('React Frontend app', () => {
    let resolver: TaskResolver;
    const codebasePath = path.join(CODEBASES_DIR, 'react-frontend');

    beforeEach(async () => {
      resolver = new TaskResolver(codebasePath);
      await resolver.init();
    });

    it('should resolve component names', async () => {
      const result = await resolver.resolve({
        task: 'Fix UserList component rendering issue',
      });

      expect(result.task.symbols.some(s =>
        s.toLowerCase().includes('user') || s.toLowerCase().includes('list')
      )).toBe(true);
    });

    it('should resolve hook names', async () => {
      const result = await resolver.resolve({
        task: 'Bug in useAuth hook login function',
      });

      expect(result.task.raw).toContain('useAuth');
      expect(result.task.domains).toContain('auth');
    });
  });

  describe('Python Flask app', () => {
    let resolver: TaskResolver;
    const codebasePath = path.join(CODEBASES_DIR, 'python-flask');

    beforeEach(async () => {
      resolver = new TaskResolver(codebasePath);
      await resolver.init();
    });

    it('should resolve snake_case identifiers', async () => {
      const result = await resolver.resolve({
        task: 'Issue with payment_service module',
      });

      // Should generate case variants
      expect(result.task.symbols.some(s =>
        s.toLowerCase().includes('payment')
      )).toBe(true);
    });
  });

  describe('Cross-language task resolution', () => {
    it('should handle multilingual keywords', async () => {
      const resolver = new TaskResolver(path.join(CODEBASES_DIR, 'laravel-app'));
      await resolver.init();

      // Italian keyword "pagamento" should expand to "payment"
      const result = await resolver.resolve({
        task: 'Problema con pagamento utente',
      });

      // Should have expanded keywords
      expect(result.task.keywords.some(k =>
        k.toLowerCase().includes('payment') || k.toLowerCase().includes('pagamento')
      )).toBe(true);
    });
  });

  describe('Confidence calculation', () => {
    let resolver: TaskResolver;

    beforeEach(async () => {
      resolver = new TaskResolver(path.join(CODEBASES_DIR, 'nodejs-express'));
      await resolver.init();
    });

    it('should have high confidence for detailed tasks', async () => {
      const result = await resolver.resolve({
        task: 'Fix bug in src/controllers/UserController.ts class UserController method createUser',
      });

      expect(result.task.confidence.overall).toBeGreaterThan(0.5);
      expect(result.task.confidence.signals.hasExactFileName).toBe(true);
      expect(result.task.confidence.signals.hasClassName).toBe(true);
    });

    it('should have low confidence for vague tasks', async () => {
      const result = await resolver.resolve({
        task: 'Something is broken',
      });

      expect(result.task.confidence.overall).toBeLessThan(0.5);
      expect(resolver.isTaskVague(result.task)).toBe(true);
    });

    it('should generate suggestions for vague tasks', async () => {
      const result = await resolver.resolve({
        task: 'Fix bug',
      });

      const suggestions = resolver.generateSuggestions(result.task);
      expect(suggestions.length).toBeGreaterThan(0);
    });
  });

  describe('Change type detection', () => {
    let resolver: TaskResolver;

    beforeEach(async () => {
      resolver = new TaskResolver(path.join(CODEBASES_DIR, 'nodejs-express'));
      await resolver.init();
    });

    it('should detect bugfix', async () => {
      const result = await resolver.resolve({
        task: 'Fix crash when user submits empty form',
      });

      expect(result.task.changeType).toBe('bugfix');
    });

    it('should detect feature', async () => {
      const result = await resolver.resolve({
        task: 'Add new export functionality for users',
      });

      expect(result.task.changeType).toBe('feature');
    });

    it('should detect refactor', async () => {
      const result = await resolver.resolve({
        task: 'Refactor the code to improve structure',
      });

      expect(result.task.changeType).toBe('refactor');
    });

    it('should detect performance', async () => {
      const result = await resolver.resolve({
        task: 'Optimize database queries for better performance',
      });

      expect(result.task.changeType).toBe('perf');
    });

    it('should detect security', async () => {
      const result = await resolver.resolve({
        task: 'Fix XSS vulnerability in user input handling',
      });

      expect(result.task.changeType).toBe('security');
    });
  });
});
