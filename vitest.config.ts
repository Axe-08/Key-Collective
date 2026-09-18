import { defineConfig } from 'vitest/config';

// Root vitest config: covers only the Cloudflare Worker / DO TypeScript tests.
// UI (Svelte) tests run via `cd ui && npx vitest run` with ui/vitest.config.ts.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    exclude: ['ui/**'],
    passWithNoTests: true,
    environment: 'node',
    testTimeout: 15000,
  },
});
