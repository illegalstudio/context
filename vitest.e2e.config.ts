import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 120000, // 2 minutes per test for E2E
    hookTimeout: 60000,  // 1 minute for setup/teardown
    // Run E2E tests sequentially (they modify filesystem)
    fileParallelism: false,
  },
});
