import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    // Integration suites share a single Postgres. Run test FILES sequentially so
    // one file's cleanup can never race another file's in-flight data.
    fileParallelism: false,
  },
});
