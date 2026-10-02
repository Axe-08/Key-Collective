/**
 * Key Collective — KeyPoolDO tolerant load of legacy status casing (WP-1.2 / T-1.2.3)
 *
 * Invariant Tested:
 * KeyPoolDO's D1 load query (ensureLoaded) must select and serve api_keys rows
 * regardless of whether `status` is stored as the legacy-cased 'Healthy' or the
 * canonical 'HEALTHY'. Both rows for the same tenant must load and be eligible.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EncryptedKey } from "../../../src/contracts/key_pool";
import {
  DurableObjectStateLike,
  DurableObjectStorageLike,
  KeyPoolDO,
  KeyPoolDOEnv,
  KeyPoolDOOptions,
} from "../../../src/durable_objects/key_pool/key_pool_do";

class MockDOStorage implements DurableObjectStorageLike {
  public store = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined>;
  async get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  async get<T = unknown>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
    if (Array.isArray(keyOrKeys)) {
      const map = new Map<string, T>();
      for (const k of keyOrKeys) {
        if (this.store.has(k)) {
          map.set(k, this.store.get(k) as T);
        }
      }
      return map;
    }
    return this.store.get(keyOrKeys) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void>;
  async put<T>(entries: Record<string, T>): Promise<void>;
  async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
    if (typeof keyOrEntries === "string") {
      this.store.set(keyOrEntries, value);
    } else {
      for (const [k, v] of Object.entries(keyOrEntries)) {
        this.store.set(k, v);
      }
    }
  }

  async delete(key: string): Promise<boolean>;
  async delete(keys: string[]): Promise<number>;
  async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
    if (Array.isArray(keyOrKeys)) {
      let count = 0;
      for (const k of keyOrKeys) {
        if (this.store.delete(k)) count++;
      }
      return count;
    }
    return this.store.delete(keyOrKeys);
  }

  async deleteAll(): Promise<void> {
    this.store.clear();
  }

  async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const map = new Map<string, T>();
    const prefix = options?.prefix ?? "";
    for (const [k, v] of this.store.entries()) {
      if (k.startsWith(prefix)) {
        map.set(k, v as T);
      }
    }
    return map;
  }
}

interface ApiKeyDbRow {
  id: string;
  tenant_id: string;
  label: string;
  provider: string;
  encrypted_key_b64: string;
  nonce_b64: string;
  rpm_limit: number;
  rpd_limit: number;
  priority: number;
  status: string;
  pool_type: string;
  dispatched_today: number;
  dispatched_communal: number;
  community_routing_status?: string | null;
}

class MockD1PreparedStatement {
  constructor(
    private readonly query: string,
    private readonly db: MockD1Database,
    private readonly params: unknown[] = []
  ) {}

  bind(...args: unknown[]): MockD1PreparedStatement {
    return new MockD1PreparedStatement(this.query, this.db, args);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const upper = this.query.toUpperCase().replace(/\s+/g, " ");
    if (upper.includes("FROM API_KEYS")) {
      const tenantId = this.params[0] as string;
      const rows = this.db.keys.filter(
        (k) =>
          // Mirrors `WHERE upper(k.status) = 'HEALTHY' AND (tenant_id = ? OR community)`
          k.status.toUpperCase() === "HEALTHY" &&
          (k.tenant_id === tenantId ||
            (k.pool_type === "COMMUNITY" && k.community_routing_status === "ACTIVE"))
      );
      return { results: rows as unknown as T[] };
    }
    return { results: [] };
  }

  async run(): Promise<{ success: boolean }> {
    return { success: true };
  }
}

class MockD1Database {
  public keys: ApiKeyDbRow[] = [];

  prepare(query: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(query, this);
  }
}

function createMockDOState(tenantId: string): {
  state: DurableObjectStateLike;
  storage: MockDOStorage;
} {
  const storage = new MockDOStorage();
  const state: DurableObjectStateLike = {
    id: {
      name: tenantId,
      toString: () => `id-${tenantId}`,
    },
    storage,
    waitUntil: vi.fn(),
  };
  return { state, storage };
}

describe("KeyPoolDO tolerant load of legacy status casing (T-1.2.3)", () => {
  let mockDb: MockD1Database;
  let mockEnv: KeyPoolDOEnv;

  beforeEach(() => {
    mockDb = new MockD1Database();
    mockEnv = {
      DB: mockDb as unknown as D1Database,
    };
  });

  it("loads and serves both a legacy-cased ('Healthy') and canonical ('HEALTHY') key for the same tenant", async () => {
    mockDb.keys.push({
      id: "key-legacy",
      tenant_id: "tenant-x",
      label: "legacy-key",
      provider: "openai",
      encrypted_key_b64: "Y2lwaGVyMQ==",
      nonce_b64: "bm9uY2Ux",
      rpm_limit: 60,
      rpd_limit: 1000,
      priority: 1,
      status: "Healthy",
      pool_type: "PRIVATE",
      dispatched_today: 0,
      dispatched_communal: 0,
      community_routing_status: null,
    });
    mockDb.keys.push({
      id: "key-migrated",
      tenant_id: "tenant-x",
      label: "migrated-key",
      provider: "openai",
      encrypted_key_b64: "Y2lwaGVyMg==",
      nonce_b64: "bm9uY2Uy",
      rpm_limit: 60,
      rpd_limit: 1000,
      priority: 2,
      status: "HEALTHY",
      pool_type: "PRIVATE",
      dispatched_today: 0,
      dispatched_communal: 0,
      community_routing_status: null,
    });

    const { state } = createMockDOState("tenant-x");
    const options: KeyPoolDOOptions = {
      tenantId: "tenant-x",
      timeProvider: () => 1_700_000_000_000,
    };

    const pool = new KeyPoolDO(state, mockEnv, options);
    await pool.ensureLoaded();

    expect(await pool.hasKey("key-legacy")).toBe(true);
    expect(await pool.hasKey("key-migrated")).toBe(true);

    const loadedKeys = await pool.getKeys("openai");
    const byId = new Map(loadedKeys.map((k: EncryptedKey) => [k.id, k]));
    expect(byId.size).toBe(2);
    expect(byId.get("key-legacy")?.status).toBe("HEALTHY");
    expect(byId.get("key-migrated")?.status).toBe("HEALTHY");

    // Both must be eligible for selection.
    const eligibleIds = new Set<string>();
    const first = await pool.getKey("openai");
    eligibleIds.add(first);
    await pool.removeKey(first);
    const second = await pool.getKey("openai");
    eligibleIds.add(second);

    expect(eligibleIds.has("key-legacy")).toBe(true);
    expect(eligibleIds.has("key-migrated")).toBe(true);
  });
});
