import { describe, expect, it, vi } from "vitest";
import { PoolCoordinatorDO } from "../../../src/pool/coordinator_do";
import type { WorkerEnv } from "../../../src/worker/auth/types";

interface CoordinatorTestAccess {
  getMeta(key: string): string | null;
}

class MockD1Database {
  public prepareCalls: Array<{ query: string; bindings: unknown[] }> = [];

  prepare(query: string) {
    const record = { query, bindings: [] as unknown[] };
    return {
      bind: (...args: unknown[]) => {
        record.bindings = args;
        return {
          run: async () => {
            this.prepareCalls.push(record);
            return { success: true };
          },
          all: async () => {
            this.prepareCalls.push(record);
            return { results: [] };
          },
          first: async () => {
            this.prepareCalls.push(record);
            return null;
          },
        };
      },
      all: async () => {
        this.prepareCalls.push(record);
        return { results: [] };
      },
      run: async () => {
        this.prepareCalls.push(record);
        return { success: true };
      },
      first: async () => {
        this.prepareCalls.push(record);
        return null;
      },
    };
  }
}

function createMockSqlStorage() {
  const meta = new Map<string, string>();
  return {
    exec(query: string, ...bindings: unknown[]) {
      const q = query.trim();
      if (q.includes("INSERT INTO meta")) {
        meta.set(String(bindings[0]), String(bindings[1]));
        return { toArray: () => [] };
      }
      if (q.includes("SELECT v FROM meta WHERE k = ?")) {
        const val = meta.get(String(bindings[0]));
        return { toArray: () => (val !== undefined ? [{ v: val }] : []) };
      }
      if (q.includes("FROM borrower_window")) {
        return { toArray: () => [{ total_cu: 0 }] };
      }
      if (q.includes("FROM keys")) {
        if (q.startsWith("SELECT") && q.includes("SUM(")) {
          return {
            toArray: () => [
              {
                active_keys: 0,
                observation_keys: 0,
                cooldown_keys: 0,
                quarantined_keys: 0,
                revoked_keys: 0,
                dispatches_today: 0,
                dispatches_communal: 0,
                active_day_count: 0,
                active_rpd_limit: 0,
              },
            ],
          };
        }
        return { toArray: () => [] };
      }
      return { toArray: () => [] };
    },
  };
}

function createMockDOState(name: string) {
  let scheduledAlarm: number | null = null;
  const sql = createMockSqlStorage();

  const ctx = {
    id: {
      name,
      toString: () => name,
    },
    storage: {
      sql,
      getAlarm: async () => scheduledAlarm,
      setAlarm: async (time: number) => {
        scheduledAlarm = time;
      },
      deleteAlarm: async () => {
        scheduledAlarm = null;
      },
    },
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => {
      return await fn();
    },
    waitUntil: (_promise: Promise<unknown>) => {},
  };

  return ctx as unknown as DurableObjectState;
}

describe("PoolCoordinatorDO Cold Initialization (T-3.1.1)", () => {
  it("extracts shard provider from DO ID name and sets provider in meta on instantiation", () => {
    const ctx = createMockDOState("pool:google");
    const mockDb = new MockD1Database();
    const env: WorkerEnv = { DB: mockDb as unknown as D1Database };

    const coord = new PoolCoordinatorDO(ctx, env);

    // Assert that provider meta is set to 'google' immediately upon instantiation without prior RPC calls
    expect((coord as unknown as CoordinatorTestAccess).getMeta("provider")).toBe("google");
  });

  it("canonicalizes various shard provider names on initialization", () => {
    const providers: Array<{ shardName: string; expectedCanonical: string }> = [
      { shardName: "pool:openai", expectedCanonical: "openai" },
      { shardName: "pool:anthropic", expectedCanonical: "anthropic" },
      { shardName: "pool:gemini", expectedCanonical: "google" },
      { shardName: "pool:google", expectedCanonical: "google" },
      { shardName: "pool:groq", expectedCanonical: "groq" },
    ];

    for (const { shardName, expectedCanonical } of providers) {
      const ctx = createMockDOState(shardName);
      const mockDb = new MockD1Database();
      const env: WorkerEnv = { DB: mockDb as unknown as D1Database };

      const coord = new PoolCoordinatorDO(ctx, env);
      expect((coord as unknown as CoordinatorTestAccess).getMeta("provider")).toBe(expectedCanonical);
    }
  });

  it("triggers alarm() on cold DO and executes D1 reconciliation successfully", async () => {
    const ctx = createMockDOState("pool:google");
    const mockDb = new MockD1Database();
    const env: WorkerEnv = { DB: mockDb as unknown as D1Database };

    const coord = new PoolCoordinatorDO(ctx, env);

    const reconcileSpy = vi.spyOn(coord, "reconcile");

    await coord.alarm();

    // Verify D1 reconciliation executed
    expect(reconcileSpy).toHaveBeenCalledWith("google");

    const reconcileCall = mockDb.prepareCalls.find((c) =>
      c.query.includes("pool_type = 'COMMUNITY'")
    );
    expect(reconcileCall).toBeDefined();
    expect(reconcileCall?.query).toContain("lower(k.provider) IN ('google', 'gemini')");
  });
});
