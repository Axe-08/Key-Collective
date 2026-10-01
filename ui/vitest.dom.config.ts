import { defineConfig } from 'vitest/config';
import { compile } from 'svelte/compiler';

// Interactive Svelte component tests: client-compiled components mounted into happy-dom.
// Run via: npm run test:ui (both UI configs) or npx vitest run --root ui -c vitest.dom.config.ts
export default defineConfig({
  plugins: [
    {
      name: 'svelte-client-loader',
      transform(code, id) {
        if (id.endsWith('.svelte')) {
          const compiled = compile(code, { filename: id, generate: 'client' });
          return { code: compiled.js.code, map: compiled.js.map };
        }
      },
    },
  ],
  resolve: { conditions: ['browser'] },
  test: {
    include: ['src/**/*.dom.test.ts'],
    environment: 'happy-dom',
    setupFiles: ['src/test/dom_setup.ts'],
    environmentOptions: { happyDOM: { url: 'http://localhost/' } },
  },
});
