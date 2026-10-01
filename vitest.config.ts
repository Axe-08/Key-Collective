import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Root vitest config: Node tests only. Tests needing the Workers runtime (D1, DOs, SELF, fetchMock)
// live under test/integration and test/do and run via vitest.workers.config.ts.
// UI (Svelte) tests run via `cd ui && npx vitest run` with ui/vitest.config.ts.
export default defineConfig({
  resolve: {
    alias: { 'cloudflare:workers': path.resolve(__dirname, 'test/shims/cloudflare_workers.ts') },
  },
  test: {
    include: ['test/**/*.test.ts', 'tests/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
    exclude: [
      'test/integration/**',
      'test/do/**',
      'ui/**',
      'node_modules/**',
      'tests/storage/repositories/apiKeys.test.ts',
      'tests/admin/**',
    ],
    passWithNoTests: false,
    environment: 'node',
    testTimeout: 15000,
  },
});
