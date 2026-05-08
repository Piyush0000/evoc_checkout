/// <reference types="vitest" />
import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'dist/**'],
    setupFiles: ['./src/test/setup.ts'],
    maxConcurrency: 1,
    sequence: {
      concurrent: false,
    },
  },
});
