/**
 * Key Collective v4 — Abuse Routes Revocation Tests
 *
 * Invariants Tested:
 * 1. Strict TypeScript: Zero any.
 * 2. Revocation via keyId: Updates status = invalid, community_routing_status = REVOKED.
 * 3. Revocation via leaked_key: Derives SHA-256 hash and key prefix, revokes matching key.
 * 4. Constant timing shield: Enforces >= 200ms response time.
 * 5. Drop references to abuse_rate_limits table.
 * 6. Turnstile gate validation: Enforces 403 on invalid Turnstile token when configured.
 */

import { describe, expect, it, vi } from "vitest";
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

describe("Abuse Routes: handleReportKeyAbuse", () => {
  it("revokes key by keyId with status = invalid and community_routing_status = REVOKED", async () => {
    const { db, queries } = createMockDb();
    const env: WorkerEnv = { DB: db };

    const req = new Request("http://localhost/api/abuse/report-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyId: "key_test_123" }),
    });

    const res = await handleReportKeyAbuse(req, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toBe("Report received");

    const updateById = queries.find(
      (q) =>
        q.sql.includes("UPDATE api_keys") &&
        q.sql.includes("status = 'invalid'") &&
        q.sql.includes("community_routing_status = 'REVOKED'") &&
        q.sql.includes("WHERE id = ?")
    );
    expect(updateById).toBeDefined();
    expect(updateById?.params).toContain("key_test_123");
  });

  it("revokes key by leaked_key deriving prefix and SHA-256 hash", async () => {
    const { db, queries } = createMockDb();
    const env: WorkerEnv = { DB: db };

    const leakedKey = "AIzaSySecretLeakedKey999";
    const req = new Request("http://localhost/api/abuse/report-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaked_key: leakedKey }),
    });

    const res = await handleReportKeyAbuse(req, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);

    const updateByPrefix = queries.find(
      (q) =>
        q.sql.includes("UPDATE api_keys") &&
        q.sql.includes("key_prefix = ?")
    );
    expect(updateByPrefix).toBeDefined();
    expect(updateByPrefix?.params[0]).toBe("AIzaSySe"); // 8 chars prefix
    expect(updateByPrefix?.params[1]).toBe("AIzaSy");   // 6 chars prefix

    // Verify SHA-256 derivation was computed and passed
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(leakedKey));
    const expectedHashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const updateByHash = queries.find(
      (q) => q.params.includes(expectedHashHex)
    );
    expect(updateByHash).toBeDefined();
  });

  it("does not reference the deleted abuse_rate_limits table", async () => {
    const { db, queries } = createMockDb();
    const env: WorkerEnv = { DB: db };

    const req = new Request("http://localhost/api/abuse/report-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyId: "test_key" }),
    });

    await handleReportKeyAbuse(req, env);

    const abuseRateLimitQuery = queries.find((q) =>
      q.sql.toLowerCase().includes("abuse_rate_limits")
    );
    expect(abuseRateLimitQuery).toBeUndefined();
  });

  it("enforces constant-time response shield of at least 200ms", async () => {
    const { db } = createMockDb();
    const env: WorkerEnv = { DB: db };

    const start = Date.now();
    const req = new Request("http://localhost/api/abuse/report-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyId: "test_timing" }),
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

    const invalidReq = new Request("http://localhost/api/abuse/report-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-turnstile-token": "invalid_turnstile_response",
      },
      body: JSON.stringify({ keyId: "test_key" }),
    });

    await expect(handleReportKeyAbuse(invalidReq, env)).rejects.toThrow(
      "Turnstile validation failed"
    );

    const validReq = new Request("http://localhost/api/abuse/report-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-turnstile-token": "1x0000000000000000000000000000000AA", // ALWAYS_PASS token
      },
      body: JSON.stringify({ keyId: "test_key" }),
    });

    const validRes = await handleReportKeyAbuse(validReq, env);
    expect(validRes.status).toBe(200);
  });
});
