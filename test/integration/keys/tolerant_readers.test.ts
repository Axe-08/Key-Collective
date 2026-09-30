/**
 * Key Collective — Tolerant readers for key status, pool_type and timestamps (WP-1.2)
 *
 * Invariant Tested:
 * GET /api/keys returns identical status and identically-scaled (ms) timestamp values
 * for a row stored in the legacy shape (status='Healthy', epoch-second timestamps) and
 * a row for the same tenant already migrated (status='HEALTHY', epoch-millisecond
 * timestamps).
 */

import { describe, expect, it } from "vitest";
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
  circuit_open_until: string | number | null;
  created_at: string | number;
  pool_type: "PRIVATE" | "COMMUNITY" | null;
  community_routing_status: "OBSERVATION" | "ACTIVE" | "QUARANTINED" | "REVOKED" | null;
  observation_until: string | number | null;
  dispatched_today: number | null;
  dispatched_communal: number | null;
  vesting_tier: 0 | 1 | 2 | null;
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

    if (upper.includes("SELECT") && upper.includes("FROM USERS")) {
      const tenantId = String(this.boundParams[0]);
      const matched = this.db.users.find((u) => u.id === tenantId);
      return {
        results: (matched ? [matched] : []) as unknown as T[],
        success: true,
        meta: { duration: 1 } as D1Response["meta"],
      };
    }

    if (upper.includes("SELECT") && upper.includes("FROM API_KEYS")) {
      let filtered = [...this.db.keys];
      if (upper.includes("WHERE TENANT_ID = ?")) {
        const tenantId = String(this.boundParams[0]);
        filtered = filtered.filter((k) => k.tenant_id === tenantId);
      }
      return {
        results: filtered as unknown as T[],
        success: true,
        meta: { duration: 1 } as D1Response["meta"],
      };
    }

    if (upper.includes("SELECT") && upper.includes("FROM COST_LEDGER")) {
      return {
        results: [] as unknown as T[],
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

describe("Tolerant readers: GET /api/keys handles legacy and migrated row shapes identically", () => {
  it("returns identical status and identically-scaled (ms) timestamps for a legacy-shape row and a migrated-shape row", async () => {
    const db = new MockD1Database();
    db.users.push({ id: "tenant-x", email: "x@test.local", tier: "free", role: "user" });

    // Legacy shape: mixed-case status string, epoch-SECOND timestamps stored as numbers.
    const legacyCreatedAtSec = 1_735_000_000; // seconds
    const legacyObservationUntilSec = 1_735_003_600; // seconds
    db.keys.push({
      id: "key-legacy",
      tenant_id: "tenant-x",
      label: "legacy-key",
      provider: "google",
      key_prefix: "AIzaSyLegacyPrefix",
      key_suffix: "111L",
      rpm_limit: 60,
      rpd_limit: 1000,
      priority: 1,
      status: "Healthy",
      circuit_open_until: null,
      created_at: legacyCreatedAtSec,
      pool_type: "private",
      community_routing_status: null,
      observation_until: legacyObservationUntilSec,
      dispatched_today: 1,
      dispatched_communal: 0,
      vesting_tier: 0,
    });

    // Migrated shape: canonical uppercase status, epoch-MILLISECOND timestamps.
    const migratedCreatedAtMs = legacyCreatedAtSec * 1000;
    const migratedObservationUntilMs = legacyObservationUntilSec * 1000;
    db.keys.push({
      id: "key-migrated",
      tenant_id: "tenant-x",
      label: "migrated-key",
      provider: "google",
      key_prefix: "AIzaSyMigratedPrefix",
      key_suffix: "222M",
      rpm_limit: 60,
      rpd_limit: 1000,
      priority: 2,
      status: "HEALTHY",
      circuit_open_until: null,
      created_at: migratedCreatedAtMs,
      pool_type: "PRIVATE",
      community_routing_status: null,
      observation_until: migratedObservationUntilMs,
      dispatched_today: 1,
      dispatched_communal: 0,
      vesting_tier: 0,
    });

    const env: WorkerEnv = { DB: db };
    const res = await handleGetKeys(env, "tenant-x");
    expect(res.status).toBe(200);

    const keys = (await res.json()) as Array<{
      id: string;
      status: string;
      pool_type: string;
      created_at: number | null;
      observation_until: number | null;
    }>;
    expect(keys.length).toBe(2);

    const legacy = keys.find((k) => k.id === "key-legacy");
    const migrated = keys.find((k) => k.id === "key-migrated");
    expect(legacy).toBeDefined();
    expect(migrated).toBeDefined();

    // Status must normalise identically regardless of raw casing.
    expect(legacy!.status).toBe(migrated!.status);
    expect(legacy!.status).toBe("HEALTHY");

    // pool_type must normalise identically regardless of raw casing.
    expect(legacy!.pool_type).toBe(migrated!.pool_type);
    expect(legacy!.pool_type).toBe("PRIVATE");

    // Timestamps must both be scaled to milliseconds and be numerically identical.
    expect(legacy!.created_at).toBe(migratedCreatedAtMs);
    expect(migrated!.created_at).toBe(migratedCreatedAtMs);
    expect(legacy!.created_at).toBe(migrated!.created_at);

    expect(legacy!.observation_until).toBe(migratedObservationUntilMs);
    expect(migrated!.observation_until).toBe(migratedObservationUntilMs);
    expect(legacy!.observation_until).toBe(migrated!.observation_until);
  });
});
