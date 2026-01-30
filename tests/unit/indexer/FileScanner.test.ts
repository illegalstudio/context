import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileScanner } from '../../../src/core/indexer/FileScanner.js';
import { createTempProject, cleanupTempProject } from '../../helpers/setup.js';

describe('FileScanner', () => {
  let projectDir: string;

  afterEach(() => {
    if (projectDir) {
      cleanupTempProject(projectDir);
    }
  });

  describe('scan()', () => {
    it('should scan basic project structure', async () => {
      projectDir = createTempProject({
        'src/app.ts': 'export const app = "test";',
        'src/utils.ts': 'export function util() {}',
        'package.json': '{"name": "test"}',
      });

      const scanner = new FileScanner(projectDir);
      const files = await scanner.scan();

      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(files.some(f => f.path === 'src/app.ts')).toBe(true);
      expect(files.some(f => f.path === 'src/utils.ts')).toBe(true);
    });

    it('should detect correct language from extension', async () => {
      projectDir = createTempProject({
        'app.ts': 'export const x = 1;',
        'app.js': 'const x = 1;',
        'app.php': '<?php echo "hi";',
        'app.py': 'print("hi")',
      });

      const scanner = new FileScanner(projectDir);
      const files = await scanner.scan();

      const ts = files.find(f => f.path === 'app.ts');
      const js = files.find(f => f.path === 'app.js');
      const php = files.find(f => f.path === 'app.php');
      const py = files.find(f => f.path === 'app.py');

      expect(ts?.language).toBe('typescript');
      expect(js?.language).toBe('javascript');
      expect(php?.language).toBe('php');
      expect(py?.language).toBe('python');
    });

    it('should skip .git directory', async () => {
      projectDir = createTempProject({
        'src/app.ts': 'export const app = 1;',
        '.git/config': '[core]',
        '.git/HEAD': 'ref: refs/heads/main',
      });

      const scanner = new FileScanner(projectDir);
      const files = await scanner.scan();

      expect(files.every(f => !f.path.startsWith('.git'))).toBe(true);
    });

    it('should skip .context directory', async () => {
      projectDir = createTempProject({
        'src/app.ts': 'export const app = 1;',
        '.context/index.db': 'binary',
      });

      const scanner = new FileScanner(projectDir);
      const files = await scanner.scan();

      expect(files.every(f => !f.path.startsWith('.context'))).toBe(true);
    });

    it('should skip files larger than maxFileSize', async () => {
      const largeContent = 'x'.repeat(2 * 1024 * 1024); // 2MB
      projectDir = createTempProject({
        'small.ts': 'export const x = 1;',
        'large.ts': largeContent,
      });

      const scanner = new FileScanner(projectDir, { maxFileSize: 1024 * 1024 }); // 1MB limit
      const files = await scanner.scan();

      expect(files.some(f => f.path === 'small.ts')).toBe(true);
      expect(files.some(f => f.path === 'large.ts')).toBe(false);
    });

    it('should skip empty files', async () => {
      projectDir = createTempProject({
        'nonempty.ts': 'export const x = 1;',
        'empty.ts': '',
      });

      const scanner = new FileScanner(projectDir);
      const files = await scanner.scan();

      expect(files.some(f => f.path === 'nonempty.ts')).toBe(true);
      expect(files.some(f => f.path === 'empty.ts')).toBe(false);
    });

    it('should filter by language when includeLanguages is set', async () => {
      projectDir = createTempProject({
        'app.ts': 'export const x = 1;',
        'app.php': '<?php echo "hi";',
        'app.py': 'print("hi")',
      });

      const scanner = new FileScanner(projectDir, { includeLanguages: ['typescript', 'php'] });
      const files = await scanner.scan();

      expect(files.some(f => f.path === 'app.ts')).toBe(true);
      expect(files.some(f => f.path === 'app.php')).toBe(true);
      expect(files.some(f => f.path === 'app.py')).toBe(false);
    });

    it('should calculate file hash', async () => {
      projectDir = createTempProject({
        'app.ts': 'export const x = 1;',
      });

      const scanner = new FileScanner(projectDir);
      const files = await scanner.scan();

      const file = files.find(f => f.path === 'app.ts');
      expect(file?.hash).toBeDefined();
      expect(file?.hash.length).toBe(32); // MD5 hex string
    });

    it('should include mtime', async () => {
      projectDir = createTempProject({
        'app.ts': 'export const x = 1;',
      });

      const scanner = new FileScanner(projectDir);
      const files = await scanner.scan();

      const file = files.find(f => f.path === 'app.ts');
      expect(file?.mtime).toBeGreaterThan(0);
    });
  });

  describe('detectLanguage()', () => {
    it('should detect TypeScript', () => {
      expect(FileScanner.detectLanguage('file.ts')).toBe('typescript');
      expect(FileScanner.detectLanguage('file.tsx')).toBe('typescript');
    });

    it('should detect JavaScript', () => {
      expect(FileScanner.detectLanguage('file.js')).toBe('javascript');
      expect(FileScanner.detectLanguage('file.jsx')).toBe('javascript');
      expect(FileScanner.detectLanguage('file.mjs')).toBe('javascript');
    });

    it('should detect PHP', () => {
      expect(FileScanner.detectLanguage('file.php')).toBe('php');
    });

    it('should detect Python', () => {
      expect(FileScanner.detectLanguage('file.py')).toBe('python');
    });

    it('should return unknown for unrecognized extensions', () => {
      expect(FileScanner.detectLanguage('file.xyz')).toBe('unknown');
    });
  });
});
