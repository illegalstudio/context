import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StacktraceParser } from '../../../src/core/resolver/StacktraceParser.js';
import { createTempProject, cleanupTempProject } from '../../helpers/setup.js';

describe('StacktraceParser', () => {
  let parser: StacktraceParser;
  let projectDir: string;

  beforeEach(() => {
    parser = new StacktraceParser();
  });

  afterEach(() => {
    if (projectDir) {
      cleanupTempProject(projectDir);
    }
  });

  describe('PHP stacktraces', () => {
    it('should parse Laravel-style stacktrace', () => {
      const content = `
[2024-01-15 10:30:45] local.ERROR: Call to undefined method App\\Models\\User::invalid()
#0 app/Http/Controllers/UserController.php(45): App\\Models\\User->invalid()
#1 app/Services/UserService.php(23): App\\Http\\Controllers\\UserController->show()
      `;

      const entries = parser.parse(content);

      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some(e => e.file.includes('UserController.php'))).toBe(true);
      expect(entries.some(e => e.file.includes('UserService.php'))).toBe(true);
    });

    it('should parse PHP exception with line number', () => {
      const content = `
Fatal error: Uncaught Exception: Something went wrong in app/Services/PaymentService.php on line 78
      `;

      const entries = parser.parse(content);

      expect(entries.some(e => e.file.includes('PaymentService.php'))).toBe(true);
      expect(entries.some(e => e.line === 78)).toBe(true);
    });

    it('should skip vendor directory files', () => {
      const content = `
#0 vendor/laravel/framework/src/Illuminate/Http/Request.php(123): something()
#1 app/Http/Controllers/UserController.php(45): something()
      `;

      const entries = parser.parse(content);

      expect(entries.every(e => !e.file.includes('vendor/'))).toBe(true);
      expect(entries.some(e => e.file.includes('UserController.php'))).toBe(true);
    });
  });

  describe('JavaScript/Node.js stacktraces', () => {
    it('should parse Node.js stacktrace', () => {
      const content = `
Error: Something went wrong
    at UserService.create (/app/src/services/UserService.ts:45:12)
    at UserController.store (/app/src/controllers/UserController.ts:23:8)
    at Router.handle (/app/node_modules/express/lib/router/index.js:123:5)
      `;

      const entries = parser.parse(content);

      expect(entries.some(e => e.file.includes('UserService.ts'))).toBe(true);
      expect(entries.some(e => e.file.includes('UserController.ts'))).toBe(true);
      // Should skip node_modules
      expect(entries.every(e => !e.file.includes('node_modules'))).toBe(true);
    });

    it('should parse stacktrace with column numbers', () => {
      const content = `
    at processData (src/utils/processor.ts:15:23)
      `;

      const entries = parser.parse(content);

      expect(entries.some(e => e.line === 15 && e.column === 23)).toBe(true);
    });
  });

  describe('Python stacktraces', () => {
    it('should parse Python traceback', () => {
      const content = `
Traceback (most recent call last):
  File "app/services/user_service.py", line 45, in create_user
    user = User(name=name)
  File "app/models/user.py", line 12, in __init__
    self.validate()
ValueError: Invalid user data
      `;

      const entries = parser.parse(content);

      expect(entries.some(e => e.file.includes('user_service.py'))).toBe(true);
      expect(entries.some(e => e.file.includes('user.py'))).toBe(true);
    });
  });

  describe('Generic patterns', () => {
    it('should parse generic file:line pattern', () => {
      const content = `
Error occurred at src/app.ts:25
Also check src/utils.js:10:5
      `;

      const entries = parser.parse(content);

      expect(entries.some(e => e.file.includes('app.ts') && e.line === 25)).toBe(true);
      expect(entries.some(e => e.file.includes('utils.js') && e.line === 10)).toBe(true);
    });

    it('should skip invalid extensions', () => {
      const content = `
Error at config.yml:10
Also image.png:5
      `;

      const entries = parser.parse(content);

      // Should not parse .yml or .png as code files
      expect(entries.every(e => !e.file.includes('.yml') && !e.file.includes('.png'))).toBe(true);
    });
  });

  describe('Error message extraction', () => {
    it('should extract error messages', () => {
      const content = `
TypeError: Cannot read property 'name' of undefined
    at processUser (src/services/user.ts:25:10)
      `;

      const messages = parser.extractErrorMessages(content);

      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some(m => m.includes('Cannot read property'))).toBe(true);
    });

    it('should extract PHP error messages', () => {
      const content = `
Fatal error: Call to undefined method App\\Models\\User::invalid() in app/Http/Controllers/UserController.php on line 45
      `;

      const messages = parser.extractErrorMessages(content);

      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('parseFromFile()', () => {
    it('should read and parse log file', async () => {
      projectDir = createTempProject({
        'error.log': `
[2024-01-15 10:30:45] ERROR: Something failed
Error at src/app.ts:25:10
        `,
      });

      const entries = await parser.parseFromFile(`${projectDir}/error.log`);

      expect(entries.length).toBeGreaterThan(0);
    });

    it('should throw for non-existent file', async () => {
      await expect(parser.parseFromFile('/non/existent/file.log')).rejects.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content', () => {
      const entries = parser.parse('');
      expect(entries).toHaveLength(0);
    });

    it('should deduplicate entries', () => {
      const content = `
Error at src/app.ts:25
Error at src/app.ts:25
Error at src/app.ts:25
      `;

      const entries = parser.parse(content);

      // Should have only one entry for src/app.ts:25
      const appEntries = entries.filter(e => e.file.includes('app.ts') && e.line === 25);
      expect(appEntries).toHaveLength(1);
    });
  });
});
