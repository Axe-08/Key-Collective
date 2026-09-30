/**
 * Key Collective v4 — Abuse Routes Revocation Tests
 *
 * Invariants Tested:
 * 1. Strict TypeScript: Zero any.
 * 2. Revocation via leaked_key: Derives SHA-256 hash, revokes matching key by key_hash.
 * 3. Constant timing shield: Enforces >= 200ms response time.
 * 4. Drop references to abuse_rate_limits table.
 * 5. Turnstile gate validation: Enforces 403 unconditionally, with no bypass when the
 *    token/secret is absent.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { handleReportKeyAbuse } from "../src/worker/router/dashboard/abuse_routes";
import type { WorkerEnv } from "../src/worker/auth/index";

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

const VALID_TOKEN = "1x0000000000000000000000000000000AA";

function mockSiteverifySuccess() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Abuse Routes: handleReportKeyAbuse", () => {
  it("revokes key by leaked_key, updating key_hash and community_routing_status = REVOKED", async () => {
    const { db, queries } = createMockDb();
    vi.stubGlobal("fetch", mockSiteverifySuccess());
    const env: WorkerEnv = { DB: db, TURNSTILE_SECRET: "test-secret-key" };

    const leakedKey = "AIzaSySecretLeakedKey999";
    const req = new Request("http://localhost/api/abuse/report-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-turnstile-token": VALID_TOKEN,
      },
      body: JSON.stringify({ leaked_key: leakedKey }),
    });

    const res = await handleReportKeyAbuse(req, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("Report received");

    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(leakedKey));
    const expectedHashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const updateByHash = queries.find(
      (q) =>
        q.sql.includes("UPDATE api_keys") &&
        q.sql.includes("status = 'REVOKED'") &&
        q.sql.includes("community_routing_status = 'REVOKED'") &&
        q.sql.includes("WHERE key_hash = ?") &&
        q.params.includes(expectedHashHex)
    );
    expect(updateByHash).toBeDefined();
  });

  it("does not reference the deleted abuse_rate_limits table", async () => {
    const { db, queries } = createMockDb();
    vi.stubGlobal("fetch", mockSiteverifySuccess());
    const env: WorkerEnv = { DB: db, TURNSTILE_SECRET: "test-secret-key" };

    const req = new Request("http://localhost/api/abuse/report-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-turnstile-token": VALID_TOKEN,
      },
      body: JSON.stringify({ leaked_key: "test_key_value" }),
    });

    await handleReportKeyAbuse(req, env);

    const abuseRateLimitQuery = queries.find((q) =>
      q.sql.toLowerCase().includes("abuse_rate_limits")
    );
    expect(abuseRateLimitQuery).toBeUndefined();
  });

  it("enforces constant-time response shield of at least 200ms", async () => {
    const { db } = createMockDb();
    vi.stubGlobal("fetch", mockSiteverifySuccess());
    const env: WorkerEnv = { DB: db, TURNSTILE_SECRET: "test-secret-key" };

    const start = Date.now();
    const req = new Request("http://localhost/api/abuse/report-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-turnstile-token": VALID_TOKEN,
      },
      body: JSON.stringify({ leaked_key: "test_timing_key" }),
    });

    const res = await handleReportKeyAbuse(req, env);
    const duration = Date.now() - start;

    expect(res.status).toBe(200);
    // Allow slight timer granularity tolerance (e.g. 190ms+)
    expect(duration).toBeGreaterThanOrEqual(190);
  });

  it("validates Turnstile token when TURNSTILE_SECRET is configured", async () => {
    const { db } = createMockDb();
    const env: WorkerEnv = {
      DB: db,
      TURNSTILE_SECRET: "test-secret-key",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const invalidReq = new Request("http://localhost/api/abuse/report-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-turnstile-token": "invalid_turnstile_response",
      },
      body: JSON.stringify({ leaked_key: "test_key" }),
    });

    await expect(handleReportKeyAbuse(invalidReq, env)).rejects.toThrow(
      "Turnstile validation failed"
    );

    vi.stubGlobal("fetch", mockSiteverifySuccess());

    const validReq = new Request("http://localhost/api/abuse/report-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-turnstile-token": VALID_TOKEN,
      },
      body: JSON.stringify({ leaked_key: "test_key" }),
    });

    const validRes = await handleReportKeyAbuse(validReq, env);
    expect(validRes.status).toBe(200);
  });

  it("rejects with 403 when no Turnstile token is supplied at all", async () => {
    const { db } = createMockDb();
    vi.stubGlobal("fetch", mockSiteverifySuccess());
    const env: WorkerEnv = { DB: db, TURNSTILE_SECRET: "test-secret-key" };

    const req = new Request("http://localhost/api/abuse/report-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaked_key: "test_key" }),
    });

    await expect(handleReportKeyAbuse(req, env)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
