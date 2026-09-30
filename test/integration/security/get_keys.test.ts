/**
 * Key Collective v4 — Security Tests: GET /api/keys Isolation & Masking
 *
 * Invariants Tested:
 * 1. Strict TypeScript: Zero `any`.
 * 2. Unauthenticated calls (!tenantId, 'anonymous', 'guest') return 401 with { error: 'Unauthorized' }.
 * 3. Tenant Isolation: Authenticated tenant A only receives their own keys (WHERE tenant_id = ?).
 *    Tenant A never sees tenant B's labels, prefixes, or community keys.
 * 4. Masking: Keys are masked to first 6 characters for prefix and last 4 characters for suffix.
 * 5. Privacy: `tenant_id` is completely omitted from the response objects for non-admin callers.
 * 6. Admin Access: Admin callers can query all keys and retain `tenant_id` in response items.
 */

import { describe, expect, it, vi } from "vitest";
import { handleGetKeys } from "../../../src/worker/router/dashboard/keys/get_keys";
import type { WorkerEnv } from "../../../src/worker/auth/index";

interface UserRow {
  id: string;
  email: string;
  tier: string;
  role: string;
}

interface ApiKeyRow {
  id: string;
  tenant_id: string;
  label: string;
  provider: string;
  key_prefix: string;
  key_suffix: string;
  rpm_limit: number;
  rpd_limit: number;
  priority: number;
  status: string;
  circuit_open_until: string | null;
  created_at: string;
  pool_type: "PRIVATE" | "COMMUNITY" | null;
  community_routing_status: "OBSERVATION" | "ACTIVE" | "QUARANTINED" | "REVOKED" | null;
  observation_until: string | null;
  dispatched_today: number | null;
  dispatched_communal: number | null;
  vesting_tier: 0 | 1 | 2 | null;
}

interface CostLedgerRow {
  id: string;
  key_id: string;
  tenant_id: string;
  latency_ms: number;
}

class MockD1PreparedStatement implements D1PreparedStatement {
  private boundParams: unknown[] = [];

  constructor(
    private readonly query: string,
    private readonly db: MockD1Database
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundParams = values;
    return this;
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const res = await this.all<T>();
    const firstRow = res.results[0] ?? null;
    if (!firstRow) return null;
    if (colName && typeof firstRow === "object") {
      return ((firstRow as Record<string, unknown>)[colName] ?? null) as T;
    }
    return firstRow;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  raw<T = unknown[]>(_options?: { columnNames?: boolean }): Promise<T[]> {
    throw new Error("raw not implemented in mock");
  }

  private executeQuery<T>(): D1Result<T> {
    const trimmed = this.query.trim();
    const upper = trimmed.toUpperCase().replace(/\s+/g, " ");

    // SELECT FROM USERS
    if (upper.includes("SELECT") && upper.includes("FROM USERS")) {
      const tenantId = String(this.boundParams[0]);
      const matched = this.db.users.find((u) => u.id === tenantId);
      return {
        results: (matched ? [matched] : []) as unknown as T[],
        success: true,
        meta: { duration: 1 } as D1Response["meta"],
      };
    }

    // SELECT FROM API_KEYS
    if (upper.includes("SELECT") && upper.includes("FROM API_KEYS")) {
      let filtered = [...this.db.keys];

      if (upper.includes("WHERE TENANT_ID = ?")) {
        const tenantId = String(this.boundParams[0]);
        filtered = filtered.filter((k) => k.tenant_id === tenantId);
      } else if (
        upper.includes("WHERE POOL_TYPE = 'COMMUNITY' OR (POOL_TYPE = 'PRIVATE' AND TENANT_ID = ?)")
      ) {
        const tenantId = String(this.boundParams[0]);
        filtered = filtered.filter(
          (k) => k.pool_type === "COMMUNITY" || (k.pool_type === "PRIVATE" && k.tenant_id === tenantId)
        );
      } else if (upper.includes("WHERE POOL_TYPE = 'COMMUNITY'")) {
        filtered = filtered.filter((k) => k.pool_type === "COMMUNITY");
      }

      return {
        results: filtered as unknown as T[],
        success: true,
        meta: { duration: 1 } as D1Response["meta"],
      };
    }

    // SELECT FROM COST_LEDGER
    if (upper.includes("SELECT") && upper.includes("FROM COST_LEDGER")) {
      let ledgerRows = [...this.db.ledger];
      if (upper.includes("WHERE TENANT_ID = ?")) {
        const tenantId = String(this.boundParams[0]);
        ledgerRows = ledgerRows.filter((l) => l.tenant_id === tenantId);
      }

      const grouped = new Map<string, { total_reqs: number; total_lat: number }>();
      for (const row of ledgerRows) {
        const existing = grouped.get(row.key_id) ?? { total_reqs: 0, total_lat: 0 };
        existing.total_reqs += 1;
        existing.total_lat += row.latency_ms;
        grouped.set(row.key_id, existing);
      }

      const results = Array.from(grouped.entries()).map(([key_id, stats]) => ({
        key_id,
        total_reqs: stats.total_reqs,
        avg_lat: stats.total_reqs > 0 ? stats.total_lat / stats.total_reqs : null,
      }));

      return {
        results: results as unknown as T[],
        success: true,
        meta: { duration: 1 } as D1Response["meta"],
      };
    }

    return {
      results: [] as unknown as T[],
      success: true,
      meta: { duration: 1 } as D1Response["meta"],
    };
  }
}

class MockD1Database implements D1Database {
  public users: UserRow[] = [];
  public keys: ApiKeyRow[] = [];
  public ledger: CostLedgerRow[] = [];

  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(query, this);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const stmt of statements) {
      results.push(await stmt.run<T>());
    }
    return results;
  }

  async exec(_query: string): Promise<D1ExecResult> {
    return { count: 1, duration: 1 };
  }

  withSession(): D1DatabaseSession {
    throw new Error("withSession not implemented in mock");
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}

describe("Security: Lock down GET /api/keys", () => {
  function createTestDb(): MockD1Database {
    const db = new MockD1Database();

    db.users.push(
      { id: "tenant-a", email: "a@test.local", tier: "free", role: "user" },
      { id: "tenant-b", email: "b@test.local", tier: "free", role: "user" },
      { id: "admin-user", email: "admin@test.local", tier: "admin", role: "admin" }
    );

    // Tenant A's private key
    db.keys.push({
      id: "key-a-private",
      tenant_id: "tenant-a",
      label: "tenant-a-private-gemini",
      provider: "google",
      key_prefix: "AIzaSySecretPrefixA1",
      key_suffix: "999A",
      rpm_limit: 60,
      rpd_limit: 1000,
      priority: 1,
      status: "Healthy",
      circuit_open_until: null,
      created_at: "2026-09-01T00:00:00Z",
      pool_type: "PRIVATE",
      community_routing_status: null,
      observation_until: null,
      dispatched_today: 5,
      dispatched_communal: 0,
      vesting_tier: 0,
    });

    // Tenant A's community key
    db.keys.push({
      id: "key-a-community",
      tenant_id: "tenant-a",
      label: "tenant-a-community-gemini",
      provider: "google",
      key_prefix: "AIzaSyCommunityPrefixA2",
      key_suffix: "888A",
      rpm_limit: 60,
      rpd_limit: 1000,
      priority: 2,
      status: "Healthy",
      circuit_open_until: null,
      created_at: "2026-09-02T00:00:00Z",
      pool_type: "COMMUNITY",
      community_routing_status: "ACTIVE",
      observation_until: null,
      dispatched_today: 10,
      dispatched_communal: 10,
      vesting_tier: 1,
    });

    // Tenant B's private key
    db.keys.push({
      id: "key-b-private",
      tenant_id: "tenant-b",
      label: "tenant-b-private-openai",
      provider: "openai",
      key_prefix: "sk-proj-SecretPrefixB1",
      key_suffix: "111B",
      rpm_limit: 60,
      rpd_limit: 1000,
      priority: 1,
      status: "Healthy",
      circuit_open_until: null,
      created_at: "2026-09-03T00:00:00Z",
      pool_type: "PRIVATE",
      community_routing_status: null,
      observation_until: null,
      dispatched_today: 2,
      dispatched_communal: 0,
      vesting_tier: 0,
    });

    // Tenant B's community key
    db.keys.push({
      id: "key-b-community",
      tenant_id: "tenant-b",
      label: "tenant-b-community-openai",
      provider: "openai",
      key_prefix: "sk-proj-CommunityPrefixB2",
      key_suffix: "222B",
      rpm_limit: 60,
      rpd_limit: 1000,
      priority: 2,
      status: "Healthy",
      circuit_open_until: null,
      created_at: "2026-09-04T00:00:00Z",
      pool_type: "COMMUNITY",
      community_routing_status: "ACTIVE",
      observation_until: null,
      dispatched_today: 20,
      dispatched_communal: 20,
      vesting_tier: 2,
    });

    return db;
  }

  describe("Requirement 1: Anonymous / Unauthenticated callers", () => {
    it("returns 401 Unauthorized for empty tenantId", async () => {
      const db = createTestDb();
      const env: WorkerEnv = { DB: db };

      const res = await handleGetKeys(env, "");
      expect(res.status).toBe(401);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Unauthorized");
    });

    it("returns 401 Unauthorized for 'anonymous' tenantId", async () => {
      const db = createTestDb();
      const env: WorkerEnv = { DB: db };

      const res = await handleGetKeys(env, "anonymous");
      expect(res.status).toBe(401);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Unauthorized");
    });

    it("returns 401 Unauthorized for 'guest' tenantId", async () => {
      const db = createTestDb();
      const env: WorkerEnv = { DB: db };

      const res = await handleGetKeys(env, "guest");
      expect(res.status).toBe(401);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("Requirement 2: Tenant Isolation & No State Leakage", () => {
    it("returns only tenant A's keys when authenticated as tenant A", async () => {
      const db = createTestDb();
      const env: WorkerEnv = { DB: db };

      const res = await handleGetKeys(env, "tenant-a");
      expect(res.status).toBe(200);

      const keys = (await res.json()) as Array<Record<string, unknown>>;
      expect(keys.length).toBe(2);

      const keyIds = keys.map((k) => k.id);
      expect(keyIds).toContain("key-a-private");
      expect(keyIds).toContain("key-a-community");
      expect(keyIds).not.toContain("key-b-private");
      expect(keyIds).not.toContain("key-b-community");

      // Verify Tenant A NEVER sees Tenant B's labels
      const labels = keys.map((k) => String(k.label));
      expect(labels.some((l) => l.includes("tenant-b"))).toBe(false);

      // Verify Tenant A NEVER sees Tenant B's prefixes
      const prefixes = keys.map((k) => String(k.key_prefix));
      expect(prefixes.some((p) => p.includes("sk-proj"))).toBe(false);
    });

    it("returns only tenant B's keys when authenticated as tenant B", async () => {
      const db = createTestDb();
      const env: WorkerEnv = { DB: db };

      const res = await handleGetKeys(env, "tenant-b");
      expect(res.status).toBe(200);

      const keys = (await res.json()) as Array<Record<string, unknown>>;
      expect(keys.length).toBe(2);

      const keyIds = keys.map((k) => k.id);
      expect(keyIds).toContain("key-b-private");
      expect(keyIds).toContain("key-b-community");
      expect(keyIds).not.toContain("key-a-private");
      expect(keyIds).not.toContain("key-a-community");

      const labels = keys.map((k) => String(k.label));
      expect(labels.some((l) => l.includes("tenant-a"))).toBe(false);
    });
  });

  describe("Requirement 3: Key Masking (first 6 + last 4 characters)", () => {
    it("masks key prefixes to at most 6 characters and suffix to last 4 characters", async () => {
      const db = createTestDb();
      const env: WorkerEnv = { DB: db };

      const res = await handleGetKeys(env, "tenant-a");
      expect(res.status).toBe(200);

      const keys = (await res.json()) as Array<{ key_prefix: string; key_suffix: string }>;
      expect(keys.length).toBeGreaterThan(0);

      for (const key of keys) {
        expect(key.key_prefix.length).toBeLessThanOrEqual(6);
        expect(key.key_prefix).toBe("AIzaSy"); // Sliced from AIzaSySecretPrefixA1 / AIzaSyCommunityPrefixA2
        expect(key.key_suffix.length).toBe(4);
      }
    });
  });

  describe("Requirement 4: Omission of tenant_id for non-admin callers", () => {
    it("omits tenant_id completely from response items for authenticated non-admin caller", async () => {
      const db = createTestDb();
      const env: WorkerEnv = { DB: db };

      const res = await handleGetKeys(env, "tenant-a");
      expect(res.status).toBe(200);

      const rawJson = await res.text();
      // Ensure the string "tenant_id" does not appear as a property in the JSON output
      expect(rawJson).not.toContain('"tenant_id"');

      const keys = JSON.parse(rawJson) as Array<Record<string, unknown>>;
      for (const item of keys) {
        expect(item).not.toHaveProperty("tenant_id");
        expect(item.tenant_id).toBeUndefined();
      }
    });

    it("includes tenant_id for admin callers", async () => {
      const db = createTestDb();
      const env: WorkerEnv = { DB: db };

      const res = await handleGetKeys(env, "admin");
      expect(res.status).toBe(200);

      const keys = (await res.json()) as Array<Record<string, unknown>>;
      expect(keys.length).toBe(4); // Admin sees all keys

      for (const item of keys) {
        expect(item).toHaveProperty("tenant_id");
        expect(item.tenant_id).toBeDefined();
      }
    });
  });
});
