import { defineConfig } from 'vitest/config';
import { compile } from 'svelte/compiler';

// UI vitest config: Svelte component tests with svelte/compiler transform.
// svelte is a devDependency of ui/, so this import resolves correctly here.
// Run via: cd ui && npx vitest run
export default defineConfig({
  plugins: [
    {
      name: 'svelte-loader',
      transform(code, id) {
        if (id.endsWith('.svelte')) {
          const compiled = compile(code, {
            filename: id,
            generate: 'server',
          });
          return {
            code: compiled.js.code,
            map: compiled.js.map,
          };
        }
      },
    },
  ],
  test: {
    include: ['src/**/*.test.ts'],
    // Interactive component tests run in vitest.dom.config.ts (client build + happy-dom).
    exclude: ['src/**/*.dom.test.ts', '**/node_modules/**'],
    passWithNoTests: true,
    environment: 'node',
  },
});

