import { defineConfig } from 'vitest/config';

// Wall-clock budgets (R24): run serially, apart from the parallel default suite.
export default defineConfig({
  test: {
    include: ['tests/perf/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
  },
});
