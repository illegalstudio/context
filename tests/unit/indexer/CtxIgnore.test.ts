import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CtxIgnore } from '../../../src/core/indexer/CtxIgnore.js';
import { createTempProject, cleanupTempProject } from '../../helpers/setup.js';

describe('CtxIgnore', () => {
  let projectDir: string;

  afterEach(() => {
    if (projectDir) {
      cleanupTempProject(projectDir);
    }
  });

  describe('builtin patterns', () => {
    it('should ignore .context/ directory', () => {
      projectDir = createTempProject({
        'src/app.ts': 'export const x = 1;',
      });

      const ignore = new CtxIgnore(projectDir);

      expect(ignore.isIgnored('.context/index.db')).toBe(true);
      expect(ignore.isIgnored('.context/cache/data.json')).toBe(true);
    });

    it('should ignore .idea/ directory', () => {
      projectDir = createTempProject({
        'src/app.ts': 'export const x = 1;',
      });

      const ignore = new CtxIgnore(projectDir);

      expect(ignore.isIgnored('.idea/workspace.xml')).toBe(true);
    });

    it('should ignore .vscode/ directory', () => {
      projectDir = createTempProject({
        'src/app.ts': 'export const x = 1;',
      });

      const ignore = new CtxIgnore(projectDir);

      expect(ignore.isIgnored('.vscode/settings.json')).toBe(true);
    });

    it('should ignore .DS_Store', () => {
      projectDir = createTempProject({
        'src/app.ts': 'export const x = 1;',
      });

      const ignore = new CtxIgnore(projectDir);

      expect(ignore.isIgnored('.DS_Store')).toBe(true);
      expect(ignore.isIgnored('src/.DS_Store')).toBe(true);
    });

    it('should ignore swap files', () => {
      projectDir = createTempProject({
        'src/app.ts': 'export const x = 1;',
      });

      const ignore = new CtxIgnore(projectDir);

      expect(ignore.isIgnored('app.ts.swp')).toBe(true);
      expect(ignore.isIgnored('app.ts.swo')).toBe(true);
    });
  });

  describe('custom .ctxignore file', () => {
    it('should load and apply custom patterns', () => {
      projectDir = createTempProject({
        '.ctxignore': `
# Ignore vendor
vendor/
# Ignore cache
*.cache
        `,
        'src/app.ts': 'export const x = 1;',
        'vendor/dep.ts': 'export const dep = 1;',
      });

      const ignore = new CtxIgnore(projectDir);

      expect(ignore.isIgnored('vendor/dep.ts')).toBe(true);
      expect(ignore.isIgnored('data.cache')).toBe(true);
      expect(ignore.isIgnored('src/app.ts')).toBe(false);
    });

    it('should report hasCustomIgnores correctly', () => {
      projectDir = createTempProject({
        '.ctxignore': 'vendor/',
        'src/app.ts': 'export const x = 1;',
      });

      const ignore = new CtxIgnore(projectDir);
      expect(ignore.hasCustomIgnores()).toBe(true);
    });

    it('should report no custom ignores when file is missing', () => {
      projectDir = createTempProject({
        'src/app.ts': 'export const x = 1;',
      });

      const ignore = new CtxIgnore(projectDir);
      expect(ignore.hasCustomIgnores()).toBe(false);
    });

    it('should handle glob patterns', () => {
      projectDir = createTempProject({
        '.ctxignore': `
**/*.test.ts
**/fixtures/**
        `,
        'src/app.ts': 'export const x = 1;',
      });

      const ignore = new CtxIgnore(projectDir);

      expect(ignore.isIgnored('src/app.test.ts')).toBe(true);
      expect(ignore.isIgnored('tests/fixtures/data.json')).toBe(true);
      expect(ignore.isIgnored('src/app.ts')).toBe(false);
    });
  });

  describe('filter()', () => {
    it('should filter array of paths', () => {
      projectDir = createTempProject({
        '.ctxignore': 'vendor/',
        'src/app.ts': 'export const x = 1;',
      });

      const ignore = new CtxIgnore(projectDir);
      const filtered = ignore.filter([
        'src/app.ts',
        'src/utils.ts',
        'vendor/dep.ts',
        '.context/db.sqlite',
      ]);

      expect(filtered).toContain('src/app.ts');
      expect(filtered).toContain('src/utils.ts');
      expect(filtered).not.toContain('vendor/dep.ts');
      expect(filtered).not.toContain('.context/db.sqlite');
    });
  });

  describe('fromPatterns()', () => {
    it('should create instance from raw patterns', () => {
      const ignore = CtxIgnore.fromPatterns(`
# Custom patterns
*.log
temp/
      `);

      expect(ignore.isIgnored('app.log')).toBe(true);
      expect(ignore.isIgnored('temp/data.json')).toBe(true);
      expect(ignore.isIgnored('src/app.ts')).toBe(false);
      expect(ignore.hasCustomIgnores()).toBe(true);
    });
  });

  describe('path normalization', () => {
    it('should handle Windows-style paths', () => {
      projectDir = createTempProject({
        '.ctxignore': 'vendor/',
        'src/app.ts': 'export const x = 1;',
      });

      const ignore = new CtxIgnore(projectDir);

      // Should handle both forward and back slashes
      expect(ignore.isIgnored('vendor\\dep.ts')).toBe(true);
      expect(ignore.isIgnored('vendor/dep.ts')).toBe(true);
    });
  });
});
