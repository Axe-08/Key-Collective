/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: KeyPoolDO Setup (T-04)
 *
 * Invariants & Standards:
 * - Strict TypeScript: No `any`, strict mode.
 * - Conforms to LLD 3.4 & KeyPoolContract:
 *   - getKey(provider: string): Promise<string>
 *   - recordUsage(keyId: string, costMicrodollars: bigint): Promise<void>
 *   - recordResult(keyId: string, success: boolean): Promise<void>
 * - Per-Tenant DO Isolation (GEMINI.md Invariant):
 *   - Cross-tenant state strictly forbidden.
 *   - Mismatched tenant operations throw TenantIsolationError (HTTP 403).
 * - Fixed-Point Microdollars: All costs in `bigint` microdollars. Zero floating-point math.
 * - DO Transactional Storage: Hot state survives DO eviction.
 * - Non-Blocking Telemetry: AnalyticsEngine telemetry emission never interrupts hot path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EncryptedKey } from "../../src/contracts/key_pool";
import { TelemetryContract, TelemetryEvent } from "../../src/contracts/telemetry";
import {
  DurableObjectStateLike,
  DurableObjectStorageLike,
  KeyPoolDO,
  KeyPoolDOEnv,
  isEncryptedKey,
} from "../../src/durable_objects/key_pool_do";
import { TenantIsolationError } from "../../src/errors/auth_errors";
import {
  InvalidKeyError,
  KeyExhaustedError,
  KeyNotFoundError,
} from "../../src/errors/key_errors";

/**
 * Mock DO storage implementing DurableObjectStorageLike.
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
 * Creates a mock DurableObjectStateLike.
 */
function createMockDOState(name?: string, idHex = "do-id-123"): {
  state: DurableObjectStateLike;
  storage: MockDOStorage;
} {
  const storage = new MockDOStorage();
  const state: DurableObjectStateLike = {
    id: {
      name,
      toString: () => idHex,
    },
    storage,
    waitUntil: vi.fn(),
  };
  return { state, storage };
}

/**
 * Creates sample EncryptedKey records for testing.
 */
function createSampleKeys(tenantId = "tenant-test"): EncryptedKey[] {
  return [
    {
      id: "key-openai-1",
      tenantId,
      provider: "openai",
      ciphertext: "c2FtcGxlLWNpcGhlcnRleHQtMQ==",
      nonce: "c2FtcGxlLW5vbmNlLTE=",
      label: "OpenAI Primary",
      priority: 10,
      rpmLimit: 60,
    },
    {
      id: "key-openai-2",
      tenantId,
      provider: "openai",
      ciphertext: "c2FtcGxlLWNpcGhlcnRleHQtMg==",
      nonce: "c2FtcGxlLW5vbmNlLTI=",
      label: "OpenAI Backup",
      priority: 5,
      rpmLimit: 60,
    },
    {
      id: "key-anthropic-1",
      tenantId,
      provider: "anthropic",
      ciphertext: "c2FtcGxlLWNpcGhlcnRleHQtMw==",
      nonce: "c2FtcGxlLW5vbmNlLTM=",
      label: "Anthropic Main",
      priority: 10,
      rpmLimit: 30,
    },
  ];
}

describe("KeyPoolDO Setup & Invariants (T-04)", () => {
  let currentTime: number;
  let mockStorage: MockDOStorage;
  let mockState: DurableObjectStateLike;
  let mockEnv: KeyPoolDOEnv;
  let telemetryEvents: TelemetryEvent[];
  let mockTelemetryEmitter: TelemetryContract;
  let analyticsEngineDataPoints: unknown[];

  beforeEach(() => {
    currentTime = 1_700_000_000_000;
    const mock = createMockDOState("tenant-alpha");
    mockState = mock.state;
    mockStorage = mock.storage;

    telemetryEvents = [];
    mockTelemetryEmitter = {
      emit: (event: TelemetryEvent) => {
        telemetryEvents.push(event);
      },
    };

    analyticsEngineDataPoints = [];
    mockEnv = {
      TELEMETRY: {
        writeDataPoint: (dp: unknown) => {
          analyticsEngineDataPoints.push(dp);
        },
      } as unknown as AnalyticsEngineDataset,
    };
  });

  describe("Tenant Isolation (GEMINI.md Invariant)", () => {
    it("derives tenantId from ctx.id.name when provided via idFromName()", () => {
      const { state } = createMockDOState("tenant-xyz");
      const pool = new KeyPoolDO(state, mockEnv);
      expect(pool.tenantId).toBe("tenant-xyz");
    });

    it("accepts explicit tenantId via constructor options", () => {
      const { state } = createMockDOState("tenant-ignored");
      const pool = new KeyPoolDO(state, mockEnv, { tenantId: "tenant-explicit" });
      expect(pool.tenantId).toBe("tenant-explicit");
    });

    it("falls back to ctx.id.toString() if ctx.id.name is undefined", () => {
      const { state } = createMockDOState(undefined, "hex-id-999");
      const pool = new KeyPoolDO(state, mockEnv);
      expect(pool.tenantId).toBe("hex-id-999");
    });

    it("throws TenantIsolationError if key added has mismatched tenantId", async () => {
      const pool = new KeyPoolDO(mockState, mockEnv);
      const crossTenantKey: EncryptedKey = {
        id: "key-foreign-1",
        tenantId: "tenant-beta", // pool is tenant-alpha
        provider: "openai",
        ciphertext: "Y2lwaGVy",
        nonce: "bm9uY2U=",
      };

      await expect(pool.addKey(crossTenantKey)).rejects.toThrow(TenantIsolationError);
    });

    it("auto-assigns DO tenantId if key has no explicit tenantId", async () => {
      const pool = new KeyPoolDO(mockState, mockEnv);
      const keyWithoutTenant: EncryptedKey = {
        id: "key-1",
        tenantId: "",
        provider: "openai",
        ciphertext: "Y2lwaGVy",
        nonce: "bm9uY2U=",
      };

      await pool.addKey(keyWithoutTenant);
      const retrieved = await pool.getKeyById("key-1");
      expect(retrieved?.tenantId).toBe("tenant-alpha");
    });

    it("maintains strict compute and memory isolation between two distinct tenants", async () => {
      const { state: stateA } = createMockDOState("tenant-a");
      const { state: stateB } = createMockDOState("tenant-b");

      const poolA = new KeyPoolDO(stateA, mockEnv);
      const poolB = new KeyPoolDO(stateB, mockEnv);

      await poolA.addKey({
        id: "key-a",
        tenantId: "tenant-a",
        provider: "openai",
        ciphertext: "Y2lwaGVyQQ==",
        nonce: "bm9uY2VB",
      });

      await poolB.addKey({
        id: "key-b",
        tenantId: "tenant-b",
        provider: "openai",
        ciphertext: "Y2lwaGVyQg==",
        nonce: "bm9uY2VC",
      });

      expect(await poolA.hasKey("key-a")).toBe(true);
      expect(await poolA.hasKey("key-b")).toBe(false);
      expect(await poolB.hasKey("key-b")).toBe(true);
      expect(await poolB.hasKey("key-a")).toBe(false);
    });
  });

  describe("Key Pool Management & Validation", () => {
    it("adds, retrieves, and counts keys correctly", async () => {
      const pool = new KeyPoolDO(mockState, mockEnv);
      const keys = createSampleKeys("tenant-alpha");

      await pool.addKeys(keys);

      expect(await pool.getKeyCount()).toBe(3);
      expect(await pool.getKeyCount("openai")).toBe(2);
      expect(await pool.getKeyCount("anthropic")).toBe(1);
      expect(await pool.getKeyCount("nonexistent")).toBe(0);

      const all = await pool.getKeys();
      expect(all).toHaveLength(3);

      const openAIKeys = await pool.getKeys("OpenAI"); // Case-insensitive
      expect(openAIKeys).toHaveLength(2);

      const single = await pool.getKeyById("key-openai-1");
      expect(single?.id).toBe("key-openai-1");
      expect(single?.label).toBe("OpenAI Primary");
    });

    it("removes keys and syncs to DO storage", async () => {
      const pool = new KeyPoolDO(mockState, mockEnv);
      const keys = createSampleKeys("tenant-alpha");
      await pool.addKeys(keys);

      const removed = await pool.removeKey("key-openai-2");
      expect(removed).toBe(true);
      expect(await pool.getKeyCount("openai")).toBe(1);
      expect(await pool.getKeyById("key-openai-2")).toBeUndefined();

      const removedAgain = await pool.removeKey("key-openai-2");
      expect(removedAgain).toBe(false);
    });

    it("replaces entire pool with setKeys()", async () => {
      const pool = new KeyPoolDO(mockState, mockEnv);
      await pool.addKeys(createSampleKeys("tenant-alpha"));
      expect(await pool.getKeyCount()).toBe(3);

      await pool.setKeys([
        {
          id: "new-gemini-key",
          tenantId: "tenant-alpha",
          provider: "gemini",
          ciphertext: "Z2VtaW5p",
          nonce: "bm9uY2U=",
        },
      ]);

      expect(await pool.getKeyCount()).toBe(1);
      expect(await pool.hasKey("new-gemini-key")).toBe(true);
      expect(await pool.hasKey("key-openai-1")).toBe(false);
    });

    it("validates key structure and rejects malformed keys", async () => {
      const pool = new KeyPoolDO(mockState, mockEnv);
      const badKey = {
        id: "bad-key",
        tenantId: "tenant-alpha",
        provider: "", // invalid empty provider
        ciphertext: "abc",
        nonce: "123",
      } as unknown as EncryptedKey;

      await expect(pool.addKey(badKey)).rejects.toThrow(InvalidKeyError);
    });
  });

  describe("KeyPoolContract Implementation (LLD 3.4)", () => {
    let pool: KeyPoolDO;

    beforeEach(async () => {
      pool = new KeyPoolDO(mockState, mockEnv, {
        timeProvider: () => currentTime,
        telemetryEmitter: mockTelemetryEmitter,
      });
      await pool.addKeys(createSampleKeys("tenant-alpha"));
    });

    describe("getKey(provider)", () => {
      it("selects and returns keyId for requested provider", async () => {
        const keyId = await pool.getKey("anthropic");
        expect(keyId).toBe("key-anthropic-1");
      });

      it("round-robins or load-balances between multiple keys of the same provider", async () => {
        const key1 = await pool.getKey("openai");
        const key2 = await pool.getKey("openai");

        expect(["key-openai-1", "key-openai-2"]).toContain(key1);
        expect(["key-openai-1", "key-openai-2"]).toContain(key2);
      });

      it("throws InvalidKeyError when provider is empty or whitespace", async () => {
        await expect(pool.getKey("")).rejects.toThrow(InvalidKeyError);
        await expect(pool.getKey("   ")).rejects.toThrow(InvalidKeyError);
      });

      it("throws KeyExhaustedError when requested provider has no registered keys", async () => {
        await expect(pool.getKey("cohere")).rejects.toThrow(KeyExhaustedError);
      });

      it("throws KeyExhaustedError when all keys for a provider are circuit broken", async () => {
        // Record 3 failures to trip anthropic key breaker
        await pool.recordResult("key-anthropic-1", false);
        await pool.recordResult("key-anthropic-1", false);
        await pool.recordResult("key-anthropic-1", false);

        await expect(pool.getKey("anthropic")).rejects.toThrow(KeyExhaustedError);
      });

      it("getKeyDetails() returns the full EncryptedKey record", async () => {
        const key = await pool.getKeyDetails("anthropic");
        expect(key.id).toBe("key-anthropic-1");
        expect(key.provider).toBe("anthropic");
        expect(key.ciphertext).toBe("c2FtcGxlLWNpcGhlcnRleHQtMw==");
        expect(key.nonce).toBe("c2FtcGxlLW5vbmNlLTM=");
      });
    });

    describe("recordUsage(keyId, costMicrodollars)", () => {
      it("updates RateLimiter and emits non-blocking telemetry with fixed-point microdollars", async () => {
        const cost = 150_000n; // 0.15 USD in microdollars
        await pool.recordUsage("key-openai-1", cost);

        // Check metrics
        const metrics = await pool.getKeyMetrics("key-openai-1");
        expect(metrics.rpm).toBe(1);
        expect(metrics.costAccumulatedMicrodollars).toBe(150_000n);

        // Check injected telemetry
        expect(telemetryEvents).toHaveLength(1);
        expect(telemetryEvents[0]?.eventType).toBe("key_usage");
        expect(telemetryEvents[0]?.costMicrodollars).toBe(150_000n);
        expect(telemetryEvents[0]?.tenantId).toBe("tenant-alpha");

        // Check AnalyticsEngine dataset write
        expect(analyticsEngineDataPoints).toHaveLength(1);
      });

      it("throws KeyNotFoundError if keyId does not exist in pool", async () => {
        await expect(pool.recordUsage("non-existent-key", 1000n)).rejects.toThrow(
          KeyNotFoundError
        );
      });

      it("throws InvalidKeyError if keyId is empty", async () => {
        await expect(pool.recordUsage("", 1000n)).rejects.toThrow(InvalidKeyError);
      });

      it("does not fail request if telemetry emission encounters an error", async () => {
        const failingTelemetryEnv: KeyPoolDOEnv = {
          TELEMETRY: {
            writeDataPoint: () => {
              throw new Error("AnalyticsEngine quota exhausted");
            },
          } as unknown as AnalyticsEngineDataset,
        };

        const robustPool = new KeyPoolDO(mockState, failingTelemetryEnv, {
          timeProvider: () => currentTime,
        });
        await robustPool.addKeys(createSampleKeys("tenant-alpha"));

        // Should NOT throw despite telemetry failure
        await expect(
          robustPool.recordUsage("key-openai-1", 50_000n)
        ).resolves.not.toThrow();
      });
    });

    describe("recordResult(keyId, success)", () => {
      it("informs CircuitBreaker of success", async () => {
        await pool.recordResult("key-openai-1", true);
        const state = await pool.getCircuitBreakerState("key-openai-1");
        expect(state).toBe("CLOSED");

        expect(telemetryEvents).toHaveLength(1);
        expect(telemetryEvents[0]?.eventType).toBe("upstream_success");
      });

      it("informs CircuitBreaker of failure and trips to OPEN after threshold", async () => {
        await pool.recordResult("key-openai-1", false);
        await pool.recordResult("key-openai-1", false);
        await pool.recordResult("key-openai-1", false);

        const state = await pool.getCircuitBreakerState("key-openai-1");
        expect(state).toBe("OPEN");

        const metrics = await pool.getKeyMetrics("key-openai-1");
        expect(metrics.circuitBreakerTripped).toBe(true);

        expect(telemetryEvents).toHaveLength(3);
        expect(telemetryEvents[2]?.eventType).toBe("upstream_failure");
      });

      it("recordStatusCode() trips CircuitBreaker on HTTP 429 and 500", async () => {
        await pool.recordStatusCode("key-anthropic-1", 429);
        await pool.recordStatusCode("key-anthropic-1", 500);
        await pool.recordStatusCode("key-anthropic-1", 503);

        const state = await pool.getCircuitBreakerState("key-anthropic-1");
        expect(state).toBe("OPEN");
      });

      it("throws KeyNotFoundError if keyId does not exist in pool", async () => {
        await expect(pool.recordResult("unknown-id", true)).rejects.toThrow(
          KeyNotFoundError
        );
      });
    });
  });

  describe("DO Transactional Storage & Eviction Survival", () => {
    it("persists keys and state in DO storage, surviving eviction (clearMemoryCache)", async () => {
      const pool = new KeyPoolDO(mockState, mockEnv, {
        timeProvider: () => currentTime,
      });
      const keys = createSampleKeys("tenant-alpha");
      await pool.addKeys(keys);

      // Record some usage and trip breaker on key-anthropic-1
      await pool.recordUsage("key-openai-1", 200_000n);
      await pool.recordResult("key-anthropic-1", false);
      await pool.recordResult("key-anthropic-1", false);
      await pool.recordResult("key-anthropic-1", false);

      // Verify before eviction
      expect((await pool.getKeyMetrics("key-openai-1")).costAccumulatedMicrodollars).toBe(200_000n);
      expect(await pool.getCircuitBreakerState("key-anthropic-1")).toBe("OPEN");

      // Simulate DO instance eviction
      pool.clearMemoryCache();

      // State must be completely restored from DO transactional storage
      expect(await pool.getKeyCount()).toBe(3);
      const restoredMetrics = await pool.getKeyMetrics("key-openai-1");
      expect(restoredMetrics.costAccumulatedMicrodollars).toBe(200_000n);

      const restoredBreaker = await pool.getCircuitBreakerState("key-anthropic-1");
      expect(restoredBreaker).toBe("OPEN");

      // Anthropic key is still tripped, so getKey('anthropic') throws KeyExhaustedError
      await expect(pool.getKey("anthropic")).rejects.toThrow(KeyExhaustedError);
    });
  });

  describe("Diagnostics & Reset Capabilities", () => {
    it("returns capacity summary and metrics", async () => {
      const pool = new KeyPoolDO(mockState, mockEnv, {
        timeProvider: () => currentTime,
      });
      await pool.addKeys(createSampleKeys("tenant-alpha"));

      const capacity = await pool.getCapacitySummary("openai");
      expect(capacity.totalKeys).toBe(2);
      expect(capacity.healthyKeys).toBe(2);
      expect(capacity.totalRpmLimit).toBe(120);

      const rlMetrics = await pool.getRateLimiterMetrics("key-openai-1");
      expect(rlMetrics.rpm).toBe(0);
      expect(rlMetrics.isRateLimited).toBe(false);
    });

    it("resets circuit breaker and rate limiter counters", async () => {
      const pool = new KeyPoolDO(mockState, mockEnv, {
        timeProvider: () => currentTime,
      });
      await pool.addKeys(createSampleKeys("tenant-alpha"));

      // Trip breaker
      await pool.recordResult("key-openai-1", false);
      await pool.recordResult("key-openai-1", false);
      await pool.recordResult("key-openai-1", false);
      expect(await pool.getCircuitBreakerState("key-openai-1")).toBe("OPEN");

      // Reset breaker
      await pool.resetKeyCircuitBreaker("key-openai-1");
      expect(await pool.getCircuitBreakerState("key-openai-1")).toBe("CLOSED");

      // Record usage and reset rate limit
      await pool.recordUsage("key-openai-1", 500_000n);
      expect((await pool.getKeyMetrics("key-openai-1")).costAccumulatedMicrodollars).toBe(500_000n);

      await pool.resetKeyRateLimit("key-openai-1");
      expect((await pool.getKeyMetrics("key-openai-1")).costAccumulatedMicrodollars).toBe(0n);
    });
  });

  describe("HTTP Fetch Interface (Worker-to-DO RPC)", () => {
    let pool: KeyPoolDO;

    beforeEach(async () => {
      pool = new KeyPoolDO(mockState, mockEnv, {
        timeProvider: () => currentTime,
      });
      await pool.addKeys(createSampleKeys("tenant-alpha"));
    });

    it("responds to GET /health", async () => {
      const req = new Request("https://pool.internal/health");
      const res = await pool.fetch(req);
      expect(res.status).toBe(200);

      const data = (await res.json()) as { status: string; do: boolean; tenantId: string; keyCount: number };
      expect(data.status).toBe("healthy");
      expect(data.do).toBe(true);
      expect(data.tenantId).toBe("tenant-alpha");
      expect(data.keyCount).toBe(3);
    });

    it("selects key via POST /keys/get", async () => {
      const req = new Request("https://pool.internal/keys/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "anthropic" }),
      });

      const res = await pool.fetch(req);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { keyId: string; key: EncryptedKey };
      expect(data.keyId).toBe("key-anthropic-1");
      expect(data.key.provider).toBe("anthropic");
    });

    it("records usage via POST /keys/usage", async () => {
      const req = new Request("https://pool.internal/keys/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId: "key-openai-1", costMicrodollars: "75000" }),
      });

      const res = await pool.fetch(req);
      expect(res.status).toBe(200);

      const metrics = await pool.getKeyMetrics("key-openai-1");
      expect(metrics.costAccumulatedMicrodollars).toBe(75_000n);
    });

    it("records result via POST /keys/result", async () => {
      const req = new Request("https://pool.internal/keys/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId: "key-anthropic-1", success: false }),
      });

      const res = await pool.fetch(req);
      expect(res.status).toBe(200);
    });

    it("enforces tenant isolation header check on HTTP fetch", async () => {
      const req = new Request("https://pool.internal/health", {
        headers: { "x-tenant-id": "tenant-other" },
      });

      const res = await pool.fetch(req);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("TENANT_ISOLATION_VIOLATION");
    });

    it("returns 429 when keys are exhausted", async () => {
      const req = new Request("https://pool.internal/keys/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "non-existent-provider" }),
      });

      const res = await pool.fetch(req);
      expect(res.status).toBe(429);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("ALL_KEYS_EXHAUSTED");
    });

    it("returns 404 for unknown endpoints", async () => {
      const req = new Request("https://pool.internal/non-existent-path");
      const res = await pool.fetch(req);
      expect(res.status).toBe(404);
    });
  });

  describe("Type Guard isEncryptedKey", () => {
    it("validates correct EncryptedKey structures", () => {
      const valid = {
        id: "key-1",
        tenantId: "tenant-1",
        provider: "openai",
        ciphertext: "cipher",
        nonce: "nonce",
      };
      expect(isEncryptedKey(valid)).toBe(true);
    });

    it("rejects invalid structures", () => {
      expect(isEncryptedKey(null)).toBe(false);
      expect(isEncryptedKey({})).toBe(false);
      expect(isEncryptedKey({ id: "k1", provider: "openai" })).toBe(false);
      expect(isEncryptedKey({ id: "", provider: "openai", ciphertext: "c", nonce: "n" })).toBe(false);
    });
  });
});
