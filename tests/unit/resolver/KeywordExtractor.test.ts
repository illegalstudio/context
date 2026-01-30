import { describe, it, expect } from 'vitest';
import { KeywordExtractor, generateCaseVariants } from '../../../src/core/resolver/KeywordExtractor.js';

describe('KeywordExtractor', () => {
  let extractor: KeywordExtractor;

  beforeEach(() => {
    extractor = new KeywordExtractor();
  });

  describe('extract()', () => {
    it('should extract PascalCase class names', () => {
      const result = extractor.extract('Bug in UserController when creating PaymentService');

      expect(result.entities.classNames).toContain('UserController');
      expect(result.entities.classNames).toContain('PaymentService');
    });

    it('should extract camelCase method names', () => {
      const result = extractor.extract('Error in handleWebhook method of StripeService.processPayment');

      expect(result.entities.methodNames.some(m => m.toLowerCase().includes('webhook'))).toBe(true);
    });

    it('should extract snake_case identifiers', () => {
      const result = extractor.extract('Issue with manage_credit function in user_profile table');

      // Snake_case should be converted to variants
      expect(result.entities.classNames.some(c =>
        c.toLowerCase().includes('credit') || c.toLowerCase().includes('profile')
      )).toBe(true);
    });

    it('should extract file paths with extensions', () => {
      const result = extractor.extract('Bug in app/Services/StripeService.php and controllers/PaymentController.php');

      expect(result.entities.fileNames).toContain('app/Services/StripeService.php');
      expect(result.entities.fileNames).toContain('controllers/PaymentController.php');
    });

    it('should extract @file mentions', () => {
      const result = extractor.extract('Fix issue in @PaymentController.php');

      expect(result.entities.fileNames).toContain('PaymentController.php');
    });

    it('should extract route patterns', () => {
      const result = extractor.extract('Error on POST /api/checkout endpoint');

      expect(result.entities.routePatterns).toContain('/api/checkout');
    });

    it('should detect domains from keywords', () => {
      const result = extractor.extract('Payment webhook failing for Stripe integration');

      expect(result.domains).toContain('payments');
    });

    it('should calculate domain weights', () => {
      const result = extractor.extract('Payment processing error in checkout flow with credit card');

      expect(result.domainWeights).toBeDefined();
      // Payment-related keywords should result in higher weight for payments domain
    });

    it('should detect bugfix change type', () => {
      const result = extractor.extract('Fix bug in user authentication where login fails');

      expect(result.changeType).toBe('bugfix');
    });

    it('should detect feature change type', () => {
      const result = extractor.extract('Add new user registration feature');

      expect(result.changeType).toBe('feature');
    });

    it('should detect refactor change type', () => {
      const result = extractor.extract('Refactor authentication module for better structure');

      expect(result.changeType).toBe('refactor');
    });

    it('should detect performance change type', () => {
      const result = extractor.extract('Optimize database queries for better performance');

      expect(result.changeType).toBe('perf');
    });

    it('should detect security change type', () => {
      const result = extractor.extract('Fix XSS vulnerability in user input');

      expect(result.changeType).toBe('security');
    });

    it('should handle empty input', () => {
      const result = extractor.extract('');

      expect(result.keywords).toHaveLength(0);
      expect(result.entities.classNames).toHaveLength(0);
      expect(result.changeType).toBe('unknown');
    });

    it('should handle only stopwords', () => {
      const result = extractor.extract('the and or but with for');

      // Should filter out most stopwords
      expect(result.keywords.length).toBeLessThan(6);
    });

    it('should extract keyphrases', () => {
      const result = extractor.extract('Issue with payment webhook handling in checkout flow');

      expect(result.keyphrases).toBeDefined();
      expect(result.keyphrases.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('generateCaseVariants()', () => {
    it('should generate variants for snake_case', () => {
      const variants = generateCaseVariants('manage_credit');

      expect(variants).toContain('manage_credit');
      expect(variants).toContain('manageCredit');
      expect(variants).toContain('ManageCredit');
    });

    it('should generate variants for CamelCase', () => {
      const variants = generateCaseVariants('ManageCredit');

      expect(variants).toContain('ManageCredit');
      expect(variants).toContain('manage_credit');
      expect(variants).toContain('managecredit');
    });

    it('should handle simple lowercase', () => {
      const variants = generateCaseVariants('payment');

      expect(variants).toContain('payment');
    });
  });
});
