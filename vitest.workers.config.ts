delete process.env.NODE_EXTRA_CA_CERTS;

import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  delete process.env.NODE_EXTRA_CA_CERTS;
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    plugins: [
      {
        name: "decode-percent-encoding",
        resolveId(id: string) {
          if (id.includes("%20")) {
            return decodeURI(id);
          }
        },
      },
    ],
    test: {
      include: [
        "test/integration/**/*.test.ts",
        "test/do/**/*.test.ts",
        "tests/storage/repositories/apiKeys.test.ts",
      ],
      setupFiles: ["./test/setup/apply-migrations.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: {
            configPath: "./wrangler.jsonc",
            environment: "test",
          },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              KC_ENV: "test",
              KC_MASTER_KEY: "test-master-key-please-rotate",
              SESSION_SIGNING_KEY: "test-signing",
              GITHUB_CLIENT_ID: "test-github-client",
              GITHUB_CLIENT_SECRET: "test-github-secret",
              TURNSTILE_SECRET: "test-secret",
              API_HOST: "api.test",
              CONSOLE_HOST: "console.test",
              ADMIN_HOST: "admin.test",
              APEX_HOST: "apex.test",
            },
          },
        },
      },
    },
  };
});
