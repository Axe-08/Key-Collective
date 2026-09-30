/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: KeyPoolDO Revocation Check for Non-Owned Keys (T-0.4.5)
 *
 * Requirements:
 * - When KeyPoolDO holds a key not owned by the tenant (e.g. communal key where key.tenantId !== this.tenantId),
 *   it re-checks D1 status before returning it (SELECT status FROM api_keys WHERE id = ?).
 * - Caches status with configurable TTL statusCacheTtlMs (default 60000ms).
 * - When status is 'REVOKED', drops key from keysMap and keySelector using removeKey(key.id)
 *   and re-selects an available key.
 * - Test item: After key 1 is revoked, another tenant's KeyPoolDO that holds a copy of it
 *   no longer returns it (status cache TTL set to 0 in test environment).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EncryptedKey } from "../../src/contracts/key_pool";
import {
  DurableObjectStateLike,
  DurableObjectStorageLike,
  KeyPoolDO,
  KeyPoolDOEnv,
  KeyPoolDOOptions,
} from "../../src/durable_objects/key_pool/key_pool_do";
import { KeyExhaustedError } from "../../src/errors/key_errors";

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
    this.db.executedQueries.push({ query: this.query, params: this.params });
    if (this.query.includes("SELECT status FROM api_keys WHERE id = ?")) {
      const keyId = this.params[0] as string;
      const status = this.db.keyStatuses.get(keyId);
      if (status !== undefined) {
        return { status } as T;
      }
      return null;
    }
    return null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    this.db.executedQueries.push({ query: this.query, params: this.params });
    return { results: [] };
  }

  async run(): Promise<{ success: boolean }> {
    this.db.executedQueries.push({ query: this.query, params: this.params });
    return { success: true };
  }
}

class MockD1Database {
  public keyStatuses = new Map<string, string>();
  public executedQueries: Array<{ query: string; params: unknown[] }> = [];

  prepare(query: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(query, this);
  }

  setKeyStatus(keyId: string, status: string): void {
    this.keyStatuses.set(keyId, status);
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

describe("KeyPoolDO Revocation Check for Non-Owned Keys (T-0.4.5)", () => {
  let currentTime: number;
  let mockDb: MockD1Database;
  let mockEnv: KeyPoolDOEnv;

  beforeEach(() => {
    currentTime = 1_700_000_000_000;
    mockDb = new MockD1Database();
    mockEnv = {
      DB: mockDb as unknown as D1Database,
    };
  });

  it("drops revoked non-owned community key and does not return it when status cache TTL is 0", async () => {
    // Key 1 is owned by tenant-owner, but held in tenant-consumer's KeyPoolDO
    const communityKey: EncryptedKey = {
      id: "key-1",
      tenantId: "tenant-owner",
      provider: "openai",
      ciphertext: "Y2lwaGVyMQ==",
      nonce: "bm9uY2Ux",
      poolType: "COMMUNITY",
      priority: 10,
    };

    // D1 reports key-1 as Healthy initially
    mockDb.setKeyStatus("key-1", "Healthy");

    const { state } = createMockDOState("tenant-consumer");
    const options: KeyPoolDOOptions = {
      tenantId: "tenant-consumer",
      keys: [communityKey],
      timeProvider: () => currentTime,
      statusCacheTtlMs: 0,
    };

    const pool = new KeyPoolDO(state, mockEnv, options);

    // Initial check: key-1 is healthy and returned
    const firstKey = await pool.getKey("openai");
    expect(firstKey).toBe("key-1");
    expect(await pool.hasKey("key-1")).toBe(true);

    // Update status in D1 to REVOKED
    mockDb.setKeyStatus("key-1", "REVOKED");

    // Since TTL is 0, next getKey() re-checks D1, drops key-1, and throws KeyExhaustedError (no keys left)
    await expect(pool.getKey("openai")).rejects.toThrow(KeyExhaustedError);

    // Verify key-1 was removed from KeyPoolDO
    expect(await pool.hasKey("key-1")).toBe(false);
    expect(await pool.getKeyCount("openai")).toBe(0);
  });

  it("drops revoked community key and selects the next available key", async () => {
    // Key 1: community key owned by another tenant
    const communityKey1: EncryptedKey = {
      id: "key-comm-1",
      tenantId: "tenant-other",
      provider: "openai",
      ciphertext: "Y2lwaGVyMQ==",
      nonce: "bm9uY2Ux",
      poolType: "COMMUNITY",
      priority: 20, // higher priority initially
    };

    // Key 2: local key owned by tenant-consumer
    const localKey2: EncryptedKey = {
      id: "key-local-2",
      tenantId: "tenant-consumer",
      provider: "openai",
      ciphertext: "Y2lwaGVyMg==",
      nonce: "bm9uY2Uy",
      poolType: "PRIVATE",
      priority: 10,
    };

    mockDb.setKeyStatus("key-comm-1", "Healthy");

    const { state } = createMockDOState("tenant-consumer");
    const options: KeyPoolDOOptions = {
      tenantId: "tenant-consumer",
      keys: [communityKey1, localKey2],
      timeProvider: () => currentTime,
      statusCacheTtlMs: 0,
    };

    const pool = new KeyPoolDO(state, mockEnv, options);

    // Key 1 is Healthy, so it is selected first
    expect(await pool.getKey("openai")).toBe("key-comm-1");

    // Revoke Key 1 in D1
    mockDb.setKeyStatus("key-comm-1", "REVOKED");

    // getKey() re-checks D1 for key-comm-1, sees REVOKED, drops it, and re-selects key-local-2
    const nextKey = await pool.getKey("openai");
    expect(nextKey).toBe("key-local-2");

    // key-comm-1 is dropped from the pool
    expect(await pool.hasKey("key-comm-1")).toBe(false);
    expect(await pool.hasKey("key-local-2")).toBe(true);
    expect(await pool.getKeyCount("openai")).toBe(1);
  });

  it("caches D1 status for statusCacheTtlMs duration", async () => {
    const communityKey: EncryptedKey = {
      id: "key-cached-1",
      tenantId: "tenant-other",
      provider: "anthropic",
      ciphertext: "Y2lwaGVy",
      nonce: "bm9uY2U=",
      poolType: "COMMUNITY",
    };

    mockDb.setKeyStatus("key-cached-1", "Healthy");

    const { state } = createMockDOState("tenant-consumer");
    const options: KeyPoolDOOptions = {
      tenantId: "tenant-consumer",
      keys: [communityKey],
      timeProvider: () => currentTime,
      statusCacheTtlMs: 60_000, // 60s cache
    };

    const pool = new KeyPoolDO(state, mockEnv, options);

    // First call queries D1 and caches
    expect(await pool.getKey("anthropic")).toBe("key-cached-1");
    const queryCountAfterFirst = mockDb.executedQueries.length;
    expect(queryCountAfterFirst).toBeGreaterThan(0);

    // Revoke key in D1
    mockDb.setKeyStatus("key-cached-1", "REVOKED");

    // Advance time by 30 seconds (< 60s TTL)
    currentTime += 30_000;

    // Within TTL, cached status is used; key is still returned
    expect(await pool.getKey("anthropic")).toBe("key-cached-1");
    expect(mockDb.executedQueries.length).toBe(queryCountAfterFirst); // No new D1 query

    // Advance time past TTL (> 60s)
    currentTime += 35_000; // now +65s total

    // Cache expired; re-checks D1, discovers REVOKED, drops key
    await expect(pool.getKey("anthropic")).rejects.toThrow(KeyExhaustedError);
    expect(mockDb.executedQueries.length).toBeGreaterThan(queryCountAfterFirst);
    expect(await pool.hasKey("key-cached-1")).toBe(false);
  });

  it("does not re-check D1 status for keys owned by the tenant", async () => {
    const ownKey: EncryptedKey = {
      id: "key-own-1",
      tenantId: "tenant-consumer",
      provider: "openai",
      ciphertext: "Y2lwaGVyT3du",
      nonce: "bm9uY2VPd24=",
      poolType: "PRIVATE",
    };

    const { state } = createMockDOState("tenant-consumer");
    const options: KeyPoolDOOptions = {
      tenantId: "tenant-consumer",
      keys: [ownKey],
      timeProvider: () => currentTime,
      statusCacheTtlMs: 0,
    };

    const pool = new KeyPoolDO(state, mockEnv, options);

    // Call getKey()
    const key = await pool.getKey("openai");
    expect(key).toBe("key-own-1");

    // Verify D1 was NOT queried for own key
    const statusQueries = mockDb.executedQueries.filter((q) =>
      q.query.includes("SELECT status FROM api_keys")
    );
    expect(statusQueries).toHaveLength(0);
  });
});
