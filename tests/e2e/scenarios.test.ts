import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { CODEBASES_DIR } from '../helpers/setup.js';

/**
 * E2E Scenario Tests
 *
 * These tests execute the actual ctx-pack CLI on predefined scenarios
 * and verify that the correct files are identified.
 *
 * Run with: npm run test:e2e
 */

interface Scenario {
  name: string;
  task: string;
  expectedFiles: string[];        // Files that MUST be in results
  expectedInTop5?: string[];      // Files that should be in top 5
  forbiddenFiles?: string[];      // Files that should NOT be in results
  options?: string;               // Additional CLI options
}

interface CodebaseScenarios {
  codebase: string;
  scenarios: Scenario[];
}

// CLI path
const CLI_PATH = path.join(process.cwd(), 'dist', 'cli', 'index.js');

// Define scenarios for each codebase
const ALL_SCENARIOS: CodebaseScenarios[] = [
  {
    codebase: 'laravel-app',
    scenarios: [
      {
        name: 'Controller bug',
        task: 'Bug in UserController when creating users',
        expectedFiles: ['app/Http/Controllers/UserController.php'],
        expectedInTop5: ['app/Http/Controllers/UserController.php', 'app/Models/User.php'],
      },
      {
        name: 'Explicit file mention',
        task: 'Fix issue in @app/Services/StripeService.php',
        expectedFiles: ['app/Services/StripeService.php'],
        expectedInTop5: ['app/Services/StripeService.php'],
      },
      {
        name: 'Payment domain',
        task: 'Payment webhook error with Stripe checkout',
        expectedFiles: ['app/Http/Controllers/PaymentController.php'],
        expectedInTop5: ['app/Services/StripeService.php'],
      },
      {
        name: 'Model issue',
        task: 'User model validation failing',
        expectedFiles: ['app/Models/User.php'],
      },
      {
        name: 'API authentication',
        task: 'API authentication endpoint returns 401',
        expectedFiles: ['app/Http/Controllers/Api/AuthController.php'],
      },
    ],
  },
  {
    codebase: 'nodejs-express',
    scenarios: [
      {
        name: 'Service method bug',
        task: 'Bug in PaymentService.createPayment method',
        expectedFiles: ['src/services/PaymentService.ts'],
        expectedInTop5: ['src/services/PaymentService.ts'],
      },
      {
        name: 'Route handler issue',
        task: 'Issue with /api/users endpoint returning wrong data',
        expectedFiles: ['src/routes/users.ts'],
      },
      {
        name: 'Controller error',
        task: 'UserController throws TypeError on null input',
        expectedFiles: ['src/controllers/UserController.ts'],
        expectedInTop5: ['src/controllers/UserController.ts', 'src/models/User.ts'],
      },
      {
        name: 'Entry point',
        task: 'Server startup fails with port already in use',
        expectedFiles: ['src/index.ts'],
      },
    ],
  },
  {
    codebase: 'react-frontend',
    scenarios: [
      {
        name: 'Component bug',
        task: 'UserList component not rendering correctly',
        expectedFiles: ['src/components/UserList.tsx'],
      },
      {
        name: 'Hook issue',
        task: 'useAuth hook returns stale token',
        expectedFiles: ['src/hooks/useAuth.ts'],
      },
      {
        name: 'Form validation',
        task: 'UserForm validation not working on submit',
        expectedFiles: ['src/components/UserForm.tsx'],
      },
      {
        name: 'API service',
        task: 'API calls failing with CORS error',
        expectedFiles: ['src/services/api.ts'],
      },
    ],
  },
  {
    codebase: 'python-flask',
    scenarios: [
      {
        name: 'Route handler',
        task: 'User creation endpoint returns 500 error',
        expectedFiles: ['app/routes/users.py'],
      },
      {
        name: 'Model validation',
        task: 'User model __init__ raises ValueError',
        expectedFiles: ['app/models/user.py'],
      },
      {
        name: 'Service layer',
        task: 'payment_service process_payment failing',
        expectedFiles: ['app/services/payment_service.py'],
      },
    ],
  },
  {
    codebase: 'typescript-nestjs',
    scenarios: [
      {
        name: 'Controller endpoint',
        task: 'UsersController findOne returns null',
        expectedFiles: ['src/users/users.controller.ts'],
      },
      {
        name: 'Service injection',
        task: 'UsersService dependency injection error',
        expectedFiles: ['src/users/users.service.ts'],
        expectedInTop5: ['src/users/users.module.ts'],
      },
      {
        name: 'DTO validation',
        task: 'CreateUserDto validation not working',
        expectedFiles: ['src/users/dto/create-user.dto.ts'],
      },
    ],
  },
  {
    codebase: 'mixed-fullstack',
    scenarios: [
      {
        name: 'Backend server',
        task: 'Backend server.ts not starting',
        expectedFiles: ['backend/src/server.ts'],
      },
      {
        name: 'Frontend app',
        task: 'Frontend App component crash on mount',
        expectedFiles: ['frontend/src/App.tsx'],
      },
      {
        name: 'Shared types',
        task: 'Shared types causing TypeScript errors',
        expectedFiles: ['shared/types.ts'],
      },
    ],
  },
  {
    codebase: 'minimal-project',
    scenarios: [
      {
        name: 'Single file',
        task: 'Main function not working',
        expectedFiles: ['index.ts'],
      },
    ],
  },
  {
    codebase: 'circular-imports',
    scenarios: [
      {
        name: 'Circular dependency',
        task: 'Module A import error',
        expectedFiles: ['src/a.ts'],
        // Should handle circular imports without hanging
      },
    ],
  },
  {
    codebase: 'with-ctxignore',
    scenarios: [
      {
        name: 'Respect ignore patterns',
        task: 'Fix app.ts main function',
        expectedFiles: ['src/app.ts'],
        forbiddenFiles: ['vendor/dep.ts'], // Should be ignored
      },
    ],
  },
];

// Helper to run CLI command
function runCli(codebasePath: string, command: string): string {
  const cmd = `node "${CLI_PATH}" ${command}`;

  try {
    const output = execSync(cmd, {
      cwd: codebasePath,
      encoding: 'utf-8',
      timeout: 60000, // 60 second timeout
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output;
  } catch (error: any) {
    // CLI might exit with non-zero but still produce output
    if (error.stdout) {
      return error.stdout;
    }
    throw error;
  }
}

// Helper to index a codebase
function indexCodebase(codebasePath: string): void {
  runCli(codebasePath, 'index');
}

// Helper to run ctx-pack CLI
function runCtxPack(codebasePath: string, task: string, options: string = ''): string {
  return runCli(codebasePath, `pack --task "${task}" ${options}`);
}

// Helper to parse JSON output from ctx/ctx.json
function parseOutput(codebasePath: string): any {
  const jsonPath = path.join(codebasePath, 'ctx', 'ctx.json');
  if (fs.existsSync(jsonPath)) {
    const content = fs.readFileSync(jsonPath, 'utf-8');
    return JSON.parse(content);
  }
  return null;
}

// Helper to cleanup output files
function cleanup(codebasePath: string): void {
  const contextDir = path.join(codebasePath, 'ctx');
  if (fs.existsSync(contextDir)) {
    fs.rmSync(contextDir, { recursive: true, force: true });
  }
  // Also clean up .ctxpacker directory (database)
  const dbDir = path.join(codebasePath, '.ctxpacker');
  if (fs.existsSync(dbDir)) {
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
}

describe('E2E Scenario Tests', () => {
  // Build the project before running E2E tests
  beforeAll(() => {
    console.log('Building project for E2E tests...');
    execSync('npm run build', { stdio: 'inherit' });
  });

  for (const { codebase, scenarios } of ALL_SCENARIOS) {
    describe(`Codebase: ${codebase}`, () => {
      const codebasePath = path.join(CODEBASES_DIR, codebase);

      // Index the codebase once before all scenarios
      beforeAll(() => {
        cleanup(codebasePath);
        indexCodebase(codebasePath);
      });

      afterAll(() => {
        cleanup(codebasePath);
      });

      // Cleanup ctx output before each scenario
      beforeEach(() => {
        const contextDir = path.join(codebasePath, 'ctx');
        if (fs.existsSync(contextDir)) {
          fs.rmSync(contextDir, { recursive: true, force: true });
        }
      });

      for (const scenario of scenarios) {
        it(`${scenario.name}: "${scenario.task}"`, async () => {
          // Run ctx-pack
          runCtxPack(codebasePath, scenario.task, scenario.options);

          // Parse output
          const output = parseOutput(codebasePath);
          expect(output).not.toBeNull();
          expect(output.files).toBeDefined();
          expect(Array.isArray(output.files)).toBe(true);

          const resultPaths = output.files.map((f: any) => f.path);

          // Check expected files are present
          for (const expectedFile of scenario.expectedFiles) {
            expect(
              resultPaths.some((p: string) => p.includes(expectedFile) || expectedFile.includes(p)),
              `Expected file "${expectedFile}" not found in results: ${resultPaths.join(', ')}`
            ).toBe(true);
          }

          // Check expected files are in top 5
          if (scenario.expectedInTop5) {
            const top5 = resultPaths.slice(0, 5);
            for (const expectedTop of scenario.expectedInTop5) {
              expect(
                top5.some((p: string) => p.includes(expectedTop) || expectedTop.includes(p)),
                `Expected file "${expectedTop}" not in top 5: ${top5.join(', ')}`
              ).toBe(true);
            }
          }

          // Check forbidden files are not present
          if (scenario.forbiddenFiles) {
            for (const forbiddenFile of scenario.forbiddenFiles) {
              expect(
                resultPaths.every((p: string) => !p.includes(forbiddenFile)),
                `Forbidden file "${forbiddenFile}" found in results`
              ).toBe(true);
            }
          }

          // Basic sanity checks
          expect(output.files.length).toBeGreaterThan(0);
          expect(output.files.length).toBeLessThanOrEqual(50); // Reasonable limit

          // Each file should have a score
          for (const file of output.files) {
            expect(file.score).toBeDefined();
            expect(typeof file.score).toBe('number');
            expect(file.score).toBeGreaterThanOrEqual(0);
            expect(file.score).toBeLessThanOrEqual(1);
          }

          // Note: Files may not be sorted by score in JSON output
          // The important thing is that the right files are included
        }, 60000); // 60 second timeout per test
      }
    });
  }
});

describe('E2E Output Format Tests', () => {
  const codebasePath = path.join(CODEBASES_DIR, 'laravel-app');

  beforeAll(() => {
    cleanup(codebasePath);
    indexCodebase(codebasePath);
  });

  afterAll(() => {
    cleanup(codebasePath);
  });

  beforeEach(() => {
    const contextDir = path.join(codebasePath, 'ctx');
    if (fs.existsSync(contextDir)) {
      fs.rmSync(contextDir, { recursive: true, force: true });
    }
  });

  it('should generate valid JSON manifest', () => {
    runCtxPack(codebasePath, 'Bug in UserController');

    const jsonPath = path.join(codebasePath, 'ctx', 'ctx.json');
    expect(fs.existsSync(jsonPath)).toBe(true);

    const content = fs.readFileSync(jsonPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Validate JSON structure
    expect(parsed.version).toBeDefined();
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.task).toBeDefined();
    expect(parsed.task.raw).toContain('UserController');
    expect(parsed.files).toBeDefined();
  });

  it('should generate PACK.md with context', () => {
    runCtxPack(codebasePath, 'Bug in UserController');

    const packPath = path.join(codebasePath, 'ctx', 'PACK.md');
    expect(fs.existsSync(packPath)).toBe(true);

    const content = fs.readFileSync(packPath, 'utf-8');

    // Validate Markdown structure
    expect(content.length).toBeGreaterThan(100);
    expect(content).toContain('UserController');
  });

  it('should generate FILES.md with file list', () => {
    runCtxPack(codebasePath, 'Bug in UserController');

    const filesPath = path.join(codebasePath, 'ctx', 'FILES.md');
    expect(fs.existsSync(filesPath)).toBe(true);

    const content = fs.readFileSync(filesPath, 'utf-8');
    expect(content).toContain('UserController');
  });

  it('should generate TASK.md with task analysis', () => {
    runCtxPack(codebasePath, 'Bug in UserController');

    const taskPath = path.join(codebasePath, 'ctx', 'TASK.md');
    expect(fs.existsSync(taskPath)).toBe(true);

    const content = fs.readFileSync(taskPath, 'utf-8');
    expect(content.length).toBeGreaterThan(50);
  });

  it('should create excerpts directory', () => {
    runCtxPack(codebasePath, 'Bug in UserController');

    const excerptsPath = path.join(codebasePath, 'ctx', 'excerpts');
    expect(fs.existsSync(excerptsPath)).toBe(true);
    expect(fs.statSync(excerptsPath).isDirectory()).toBe(true);
  });

  it('should create portable archive', () => {
    runCtxPack(codebasePath, 'Bug in UserController');

    const archivePath = path.join(codebasePath, 'ctx', 'ctx.tgz');
    expect(fs.existsSync(archivePath)).toBe(true);
    expect(fs.statSync(archivePath).size).toBeGreaterThan(0);
  });
});

describe('E2E Edge Cases', () => {
  it('should handle empty/vague task gracefully', () => {
    const codebasePath = path.join(CODEBASES_DIR, 'laravel-app');
    // Index if not already indexed
    if (!fs.existsSync(path.join(codebasePath, '.ctxpacker'))) {
      indexCodebase(codebasePath);
    }

    // Should not crash with vague task
    expect(() => {
      runCtxPack(codebasePath, 'something is broken');
    }).not.toThrow();

    // Should still produce output
    const output = parseOutput(codebasePath);
    expect(output).not.toBeNull();
  });

  it('should handle non-existent file mention gracefully', () => {
    const codebasePath = path.join(CODEBASES_DIR, 'laravel-app');
    // Index if not already indexed
    if (!fs.existsSync(path.join(codebasePath, '.ctxpacker'))) {
      indexCodebase(codebasePath);
    }

    // Should not crash when mentioning non-existent file
    expect(() => {
      runCtxPack(codebasePath, 'Fix NonExistentFile.php');
    }).not.toThrow();
  });

  it('should complete within reasonable time for large project', () => {
    const codebasePath = path.join(CODEBASES_DIR, 'large-project');
    cleanup(codebasePath);

    // Index and pack
    const start = Date.now();
    indexCodebase(codebasePath);
    runCtxPack(codebasePath, 'Bug in module service');
    const elapsed = Date.now() - start;

    // Should complete indexing + packing within 15 seconds for 60+ files
    expect(elapsed).toBeLessThan(15000);

    cleanup(codebasePath);
  }, 30000);
});
