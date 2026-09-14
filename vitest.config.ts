import { defineConfig } from 'vitest/config';
import { compile } from 'svelte/compiler';

export default defineConfig({
  plugins: [
    {
      name: 'svelte-loader',
      transform(code, id, options) {
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
    passWithNoTests: true,
  },
});
