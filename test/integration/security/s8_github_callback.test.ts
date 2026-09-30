/**
 * Key Collective v4 — S8 GitHub OAuth Callback Security Tests
 *
 * Invariants Tested:
 * 1. Strict TypeScript: Zero any.
 * 2. HTTP 410 Gone: GET /api/auth/github/callback (with or without query parameters) returns 410.
 * 3. Token Exfiltration Shield: Response body never contains 'postMessage' or '/?token='.
 * 4. Zero Persistence: No user records or auth tokens inserted into D1.
 */

import { describe, expect, it, vi } from "vitest";
import { handleOAuthGithubCallback } from "../../../src/worker/router/dashboard/auth_routes";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";

interface MockStatement {
  bind: (...args: unknown[]) => MockStatement;
  run: () => Promise<{ success: boolean }>;
  first: <T = unknown>() => Promise<T | null>;
  all: <T = unknown>() => Promise<{ results: T[] }>;
}

function createMockDb() {
  const queries: { sql: string; params: unknown[] }[] = [];

  const db: D1Database = {
    prepare: (query: string): D1PreparedStatement => {
      let boundParams: unknown[] = [];
      const stmt: MockStatement = {
        bind: (...args: unknown[]) => {
          boundParams = args;
          return stmt;
        },
        run: async () => {
          queries.push({ sql: query, params: boundParams });
          return { success: true };
        },
        first: async <T = unknown>() => {
          queries.push({ sql: query, params: boundParams });
          return null as T | null;
        },
        all: async <T = unknown>() => {
          queries.push({ sql: query, params: boundParams });
          return { results: [] as T[] };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
    dump: vi.fn(),
    batch: vi.fn(),
    exec: vi.fn(),
  };

  return { db, queries };
}

describe("S8 Security: Disabled GitHub OAuth Callback (HTTP 410 Gone)", () => {
  it("returns HTTP 410 Gone when called directly without query parameters", async () => {
    const { db, queries } = createMockDb();
    const env: WorkerEnv = { DB: db };

    const req = new Request("http://localhost/api/auth/github/callback", {
      method: "GET",
    });

    const res = await handleOAuthGithubCallback(req, env);
    expect(res.status).toBe(410);

    const bodyText = await res.text();
    expect(bodyText).not.toContain("postMessage");
    expect(bodyText).not.toContain("/?token=");

    const data = JSON.parse(bodyText) as {
      error: { message: string; code: string; statusCode: number };
    };
    expect(data.error.code).toBe("GONE");
    expect(data.error.statusCode).toBe(410);
    expect(data.error.message).toBe(
      "GitHub authentication is disabled until link flow is implemented."
    );

    const userOrTokenInserts = queries.filter(
      (q) =>
        q.sql.toLowerCase().includes("insert into users") ||
        q.sql.toLowerCase().includes("insert into auth_tokens")
    );
    expect(userOrTokenInserts).toHaveLength(0);
  });

  it("returns HTTP 410 Gone when called directly with OAuth code and state", async () => {
    const { db, queries } = createMockDb();
    const env: WorkerEnv = {
      DB: db,
      GITHUB_CLIENT_SECRET: "test-github-secret",
    };

    const req = new Request(
      "http://localhost/api/auth/github/callback?code=foo&state=bar",
      {
        method: "GET",
      }
    );

    const res = await handleOAuthGithubCallback(req, env);
    expect(res.status).toBe(410);

    const bodyText = await res.text();
    expect(bodyText).not.toContain("postMessage");
    expect(bodyText).not.toContain("/?token=");

    const data = JSON.parse(bodyText) as {
      error: { message: string; code: string; statusCode: number };
    };
    expect(data.error.code).toBe("GONE");
    expect(data.error.statusCode).toBe(410);
    expect(data.error.message).toBe(
      "GitHub authentication is disabled until link flow is implemented."
    );

    const userOrTokenInserts = queries.filter(
      (q) =>
        q.sql.toLowerCase().includes("insert into users") ||
        q.sql.toLowerCase().includes("insert into auth_tokens")
    );
    expect(userOrTokenInserts).toHaveLength(0);
    expect(queries).toHaveLength(0);
  });

  it("routes GET /api/auth/github/callback through MainWorker to HTTP 410 without inserting into D1", async () => {
    const { db, queries } = createMockDb();
    const env: WorkerEnv = {
      DB: db,
      GITHUB_CLIENT_SECRET: "mock-secret",
    };

    const req = new Request(
      "https://console.key-col.axe08.tech/api/auth/github/callback?code=test_code_123&state=xyz",
      {
        method: "GET",
      }
    );

    const res = await defaultMainWorker.fetch(req, env);
    expect(res.status).toBe(410);

    const bodyText = await res.text();
    expect(bodyText).not.toContain("postMessage");
    expect(bodyText).not.toContain("/?token=");

    const data = JSON.parse(bodyText) as {
      error: { message: string; code: string; statusCode: number };
    };
    expect(data.error.code).toBe("GONE");
    expect(data.error.statusCode).toBe(410);

    const userOrTokenInserts = queries.filter(
      (q) =>
        q.sql.toLowerCase().includes("users") ||
        q.sql.toLowerCase().includes("auth_tokens")
    );
    expect(userOrTokenInserts).toHaveLength(0);
  });
});
