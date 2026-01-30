import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Exclude E2E tests from regular test run (they need build first)
    exclude: ['tests/e2e/**/*.test.ts', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['tests/**', '**/node_modules/**'],
    },
    testTimeout: 30000,
  },
});
