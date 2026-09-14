import { defineConfig } from 'vitest/config';

// Root vitest config: covers only the Cloudflare Worker / DO TypeScript tests.
// UI (Svelte) tests run via `cd ui && npx vitest run` with ui/vitest.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['ui/**'],
    passWithNoTests: true,
    environment: 'node',
  },
});
