/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: KeyPool Durable Object Bootstrap (TASK-DOP-01)
 *
 * Verifies:
 * - Bootstraps KeyPool DO class in src/durable_objects/key_pool.ts
 * - Implements KeyPoolContract (getKey, recordUsage, recordResult)
 * - Sets up this.ctx.storage access
 * - Per-Tenant DO Isolation (GEMINI.md Invariant)
 * - Fixed-Point Microdollars (bigint)
 * - DO Transactional Storage for Hot State
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EncryptedKey } from "../contracts/key_pool";
import {
  DurableObjectStateLike,
  DurableObjectStorageLike,
  KeyPool,
  KeyPoolContract,
  isEncryptedKey,
} from "./key_pool";
import { TenantIsolationError } from "../errors/auth_errors";
import {
  InvalidKeyError,
  KeyExhaustedError,
  KeyNotFoundError,
} from "../errors/key_errors";

/**
 * In-memory mock implementing DurableObjectStorageLike for deterministic DO testing.
 */
class MockDOStorage implements DurableObjectStorageLike {
  public store = new Map<string, unknown>();
  public putCalls: Array<{ key: string; value: unknown }> = [];
  public getCalls: string[] = [];

  async get<T = unknown>(key: string): Promise<T | undefined>;
  async get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  async get<T = unknown>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
    if (Array.isArray(keyOrKeys)) {
      const map = new Map<string, T>();
      for (const k of keyOrKeys) {
        this.getCalls.push(k);
        if (this.store.has(k)) {
          map.set(k, this.store.get(k) as T);
        }
      }
      return map;
    }
    this.getCalls.push(keyOrKeys);
    return this.store.get(keyOrKeys) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void>;
  async put<T>(entries: Record<string, T>): Promise<void>;
  async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
    if (typeof keyOrEntries === "string") {
      this.store.set(keyOrEntries, value);
      this.putCalls.push({ key: keyOrEntries, value });
    } else {
      for (const [k, v] of Object.entries(keyOrEntries)) {
        this.store.set(k, v);
        this.putCalls.push({ key: k, value: v });
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

/**
 * Creates a mock Cloudflare DurableObjectState.
 */
function createMockState(
  name = "tenant-test-1",
  storage?: MockDOStorage
): { state: DurableObjectStateLike; storage: MockDOStorage } {
  const store = storage ?? new MockDOStorage();
  const state: DurableObjectStateLike = {
    id: {
      toString: () => `id-${name}`,
      name,
    },
    storage: store,
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      void promise;
    }),
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  };
  return { state, storage: store };
}

function makeSampleKey(overrides?: Partial<EncryptedKey>): EncryptedKey {
  return {
    id: "key_openai_1",
    tenantId: "tenant-test-1",
    provider: "openai",
    ciphertext: "base64-encrypted-ciphertext-blob==",
    nonce: "base64-12byte-nonce==",
    label: "OpenAI Production Key 1",
    priority: 1,
    rpmLimit: 60,
    rpdLimit: 1000,
    status: "active",
    ...overrides,
  };
}

describe("KeyPool Durable Object Bootstrap (TASK-DOP-01)", () => {
  let mockStorage: MockDOStorage;
  let mockState: DurableObjectStateLike;

  beforeEach(() => {
    const mock = createMockState("tenant-test-1");
    mockStorage = mock.storage;
    mockState = mock.state;
  });

  describe("Initialization & Storage Setup", () => {
    it("successfully creates KeyPool instance with this.ctx.storage access", () => {
      const pool = new KeyPool(mockState);
      expect(pool).toBeInstanceOf(KeyPool);
      expect(pool.tenantId).toBe("tenant-test-1");
      expect(pool.ctx).toBeDefined();
      expect(pool.ctx.storage).toBe(mockStorage);
      expect(pool.storage).toBe(mockStorage);
    });

    it("derives tenantId from ctx.id.name matching env.KEY_POOL.idFromName(tenantId)", () => {
      const { state } = createMockState("acme-corp");
      const pool = new KeyPool(state);
      expect(pool.tenantId).toBe("acme-corp");
    });

    it("implements KeyPoolContract methods", () => {
      const pool = new KeyPool(mockState);
      const contract: KeyPoolContract = pool;
      expect(typeof contract.getKey).toBe("function");
      expect(typeof contract.recordUsage).toBe("function");
      expect(typeof contract.recordResult).toBe("function");
    });
  });

  describe("KeyPoolContract: getKey(provider: string)", () => {
    it("throws InvalidKeyError when provider is empty or whitespace", async () => {
      const pool = new KeyPool(mockState);
      await expect(pool.getKey("")).rejects.toThrow(InvalidKeyError);
      await expect(pool.getKey("   ")).rejects.toThrow(InvalidKeyError);
    });

    it("throws KeyExhaustedError when no keys are registered for provider", async () => {
      const pool = new KeyPool(mockState);
      await expect(pool.getKey("anthropic")).rejects.toThrow(KeyExhaustedError);
    });

    it("returns keyId when an active key exists for provider", async () => {
      const key = makeSampleKey();
      const pool = new KeyPool(mockState, {}, { keys: [key] });
      const keyId = await pool.getKey("openai");
      expect(keyId).toBe("key_openai_1");
    });
  });

  describe("KeyPoolContract: recordUsage(keyId: string, costMicrodollars: bigint)", () => {
    it("throws InvalidKeyError if keyId is empty", async () => {
      const pool = new KeyPool(mockState);
      await expect(pool.recordUsage("", 1000n)).rejects.toThrow(InvalidKeyError);
    });

    it("throws KeyNotFoundError if keyId does not exist in pool", async () => {
      const pool = new KeyPool(mockState);
      await expect(pool.recordUsage("non-existent-key", 1000n)).rejects.toThrow(KeyNotFoundError);
    });

    it("records usage with fixed-point microdollars (bigint) into storage", async () => {
      const key = makeSampleKey();
      const pool = new KeyPool(mockState, {}, { keys: [key] });

      const costMicrodollars = 50_000n; // 0.05 USD = 50,000 µ$
      await pool.recordUsage("key_openai_1", costMicrodollars);

      const metrics = await pool.getKeyMetrics("key_openai_1");
      expect(metrics.rpm).toBe(1);
      expect(metrics.costAccumulatedMicrodollars).toBe(50_000n);

      // Verify that this.ctx.storage was written to
      expect(mockStorage.putCalls.length).toBeGreaterThan(0);
    });
  });

  describe("KeyPoolContract: recordResult(keyId: string, success: boolean)", () => {
    it("throws InvalidKeyError if keyId is empty", async () => {
      const pool = new KeyPool(mockState);
      await expect(pool.recordResult("", true)).rejects.toThrow(InvalidKeyError);
    });

    it("throws KeyNotFoundError if keyId does not exist in pool", async () => {
      const pool = new KeyPool(mockState);
      await expect(pool.recordResult("non-existent-key", true)).rejects.toThrow(KeyNotFoundError);
    });

    it("records successful execution without tripping circuit breaker", async () => {
      const key = makeSampleKey();
      const pool = new KeyPool(mockState, {}, { keys: [key] });

      await pool.recordResult("key_openai_1", true);

      const metrics = await pool.getKeyMetrics("key_openai_1");
      expect(metrics.circuitBreakerTripped).toBe(false);
    });

    it("trips circuit breaker after consecutive failures, updating storage", async () => {
      const key = makeSampleKey();
      const pool = new KeyPool(mockState, {}, { keys: [key] });

      // Record consecutive failures
      await pool.recordResult("key_openai_1", false);
      await pool.recordResult("key_openai_1", false);
      await pool.recordResult("key_openai_1", false);

      const metrics = await pool.getKeyMetrics("key_openai_1");
      expect(metrics.circuitBreakerTripped).toBe(true);

      // Verify getKey throws KeyExhaustedError when tripped
      await expect(pool.getKey("openai")).rejects.toThrow(KeyExhaustedError);
    });
  });

  describe("DO Transactional Storage & Eviction Survival", () => {
    it("survives in-memory eviction and restores state from this.ctx.storage", async () => {
      const key = makeSampleKey();
      const pool = new KeyPool(mockState);
      await pool.addKey(key);

      // Verify key is in pool
      expect(await pool.getKey("openai")).toBe("key_openai_1");

      // Simulate DO instance eviction (in-memory cache cleared)
      pool.clearMemoryCache();

      // State re-hydrates from mockStorage
      const rehydratedKeyId = await pool.getKey("openai");
      expect(rehydratedKeyId).toBe("key_openai_1");
    });
  });

  describe("Strict Per-Tenant DO Isolation (GEMINI.md Invariant)", () => {
    it("rejects keys belonging to another tenant with TenantIsolationError", async () => {
      const pool = new KeyPool(mockState); // tenant: tenant-test-1
      const alienKey = makeSampleKey({
        id: "key_alien",
        tenantId: "tenant-alien-99",
      });

      await expect(pool.addKey(alienKey)).rejects.toThrow(TenantIsolationError);
    });
  });

  describe("Type Guard isEncryptedKey", () => {
    it("validates correct EncryptedKey structures", () => {
      expect(isEncryptedKey(makeSampleKey())).toBe(true);
    });

    it("rejects incomplete or malformed objects", () => {
      expect(isEncryptedKey(null)).toBe(false);
      expect(isEncryptedKey({})).toBe(false);
      expect(isEncryptedKey({ id: "1" })).toBe(false);
    });
  });
});
