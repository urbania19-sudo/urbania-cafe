import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/setup.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'tests/financial-workflow-integration.test.ts', 'tests/two-phase-migration-replay.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 20000,
  },
});
