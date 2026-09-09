/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: KeySelector Logic for Triage & Capacity Filtering (T-03)
 *
 * Invariants & Standards:
 * - Strict TypeScript: No `any`, strict mode.
 * - Conforms to LLD 3.3:
 *   - Logic: Filters out rate-limited or circuit-broken keys.
 *   - Selection: Implements Round-Robin or Least-Used selection among healthy keys.
 *   - Multi-provider fallback support.
 * - Fixed-Point Microdollars: All costs in `bigint` microdollars.
 * - DO Transactional Storage: Survives DO instance eviction.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RETRY_AFTER_SECONDS, DEFAULT_RPM_LIMIT } from "../../src/constants/limits";
import { EncryptedKey } from "../../src/contracts/key_pool";
import {
  CircuitBreaker,
  DurableObjectStorageLike,
} from "../../src/durable_objects/circuit_breaker";
import {
  CapacitySummary,
  isSelectableKey,
  KeySelector,
  KeyTriageResult,
  SelectableKey,
} from "../../src/durable_objects/key_selector";
import { RateLimiter } from "../../src/durable_objects/rate_limiter";
import { KeyExhaustedError } from "../../src/errors/key_errors";
import { APIKey } from "../../src/types/models";

/**
 * Mock DO storage implementation.
 */
class MockDurableObjectStorage implements DurableObjectStorageLike {
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
      this.putCalls.push({ key: keyOrEntries, value });
      this.store.set(keyOrEntries, value);
    } else {
      for (const [k, v] of Object.entries(keyOrEntries)) {
        this.putCalls.push({ key: k, value: v });
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
}

describe("KeySelector (T-03)", () => {
  let storage: MockDurableObjectStorage;
  let currentTime: number;
  const timeProvider = () => currentTime;

  let circuitBreaker: CircuitBreaker;
  let rateLimiter: RateLimiter;
  let selector: KeySelector;

  const mockOpenAIKey1: SelectableKey = {
    id: "key-openai-1",
    provider: "openai",
    tenantId: "tenant-1",
    label: "OpenAI Primary",
    priority: 10,
    status: "Healthy",
    rpmLimit: 60,
  };

  const mockOpenAIKey2: SelectableKey = {
    id: "key-openai-2",
    provider: "openai",
    tenantId: "tenant-1",
    label: "OpenAI Secondary",
    priority: 5,
    status: "Healthy",
    rpmLimit: 60,
  };

  const mockOpenAIKey3: SelectableKey = {
    id: "key-openai-3",
    provider: "openai",
    tenantId: "tenant-1",
    label: "OpenAI Tertiary",
    priority: 1,
    status: "Healthy",
    rpmLimit: 60,
  };

  const mockAnthropicKey1: SelectableKey = {
    id: "key-anthropic-1",
    provider: "anthropic",
    tenantId: "tenant-1",
    label: "Anthropic Claude",
    priority: 10,
    status: "Healthy",
    rpmLimit: 60,
  };

  beforeEach(() => {
    storage = new MockDurableObjectStorage();
    currentTime = 1_700_000_000_000;

    circuitBreaker = new CircuitBreaker(storage, {
      failureThreshold: 3,
      cooldownSeconds: 60,
      timeProvider,
    });

    rateLimiter = new RateLimiter(storage, {
      tenantId: "tenant-1",
      rpmLimit: 60,
      timeProvider,
    });

    selector = new KeySelector({
      tenantId: "tenant-1",
      keys: [mockOpenAIKey1, mockOpenAIKey2, mockOpenAIKey3, mockAnthropicKey1],
      circuitBreaker,
      rateLimiter,
      storage,
      timeProvider,
    });
  });

  describe("1. Pool Management & Lookups", () => {
    it("initializes with keys and tenantId", () => {
      expect(selector.tenantId).toBe("tenant-1");
      expect(selector.getKeyCount()).toBe(4);
      expect(selector.getKeyCount("openai")).toBe(3);
      expect(selector.getKeyCount("anthropic")).toBe(1);
    });

    it("matches providers case-insensitively", () => {
      expect(selector.getKeys("OPENAI")).toHaveLength(3);
      expect(selector.getKeys("OpenAI")).toHaveLength(3);
      expect(selector.getKeys("anthropic")).toHaveLength(1);
    });

    it("supports wildcard provider to retrieve all keys", () => {
      expect(selector.getKeys("*")).toHaveLength(4);
    });

    it("adds, retrieves, and removes individual keys", () => {
      const newKey: SelectableKey = {
        id: "key-gemini-1",
        provider: "gemini",
        tenantId: "tenant-1",
      };

      selector.addKey(newKey);
      expect(selector.hasKey("key-gemini-1")).toBe(true);
      expect(selector.getKeyById("key-gemini-1")?.id).toBe("key-gemini-1");
      expect(selector.getKeyCount("gemini")).toBe(1);

      const removed = selector.removeKey("key-gemini-1");
      expect(removed).toBe(true);
      expect(selector.hasKey("key-gemini-1")).toBe(false);
      expect(selector.getKeyById("key-gemini-1")).toBeUndefined();
    });

    it("replaces keys via setKeys() and clears via clearKeys()", () => {
      selector.setKeys([mockAnthropicKey1]);
      expect(selector.getKeyCount()).toBe(1);
      expect(selector.getKeyCount("openai")).toBe(0);

      selector.clearKeys();
      expect(selector.getKeyCount()).toBe(0);
    });

    it("allows dynamic injection of circuitBreaker and rateLimiter", () => {
      const emptySelector = new KeySelector();
      expect(emptySelector.getCircuitBreaker()).toBeUndefined();
      expect(emptySelector.getRateLimiter()).toBeUndefined();

      emptySelector.setCircuitBreaker(circuitBreaker);
      emptySelector.setRateLimiter(rateLimiter);

      expect(emptySelector.getCircuitBreaker()).toBe(circuitBreaker);
      expect(emptySelector.getRateLimiter()).toBe(rateLimiter);
    });
  });

  describe("2. Key Triage & Status Filtering", () => {
    it("filters out disabled, invalid, or exhausted keys", async () => {
      selector.setKeys([
        { id: "k-active", provider: "openai", status: "Healthy" },
        { id: "k-disabled", provider: "openai", status: "Disabled" },
        { id: "k-invalid", provider: "openai", status: "invalid" },
        { id: "k-exhausted", provider: "openai", status: "exhausted" },
      ]);

      const triage = await selector.triageKeys("openai");
      expect(triage.totalKeys).toBe(4);
      expect(triage.healthyKeys).toHaveLength(1);
      expect(triage.healthyKeys[0]?.id).toBe("k-active");
      expect(triage.disabledKeys).toHaveLength(3);
      expect(triage.unhealthyKeys).toHaveLength(3);
    });

    it("filters out circuit-broken keys (OPEN state)", async () => {
      // Trip key 1
      await circuitBreaker.trip("key-openai-1");

      const triage = await selector.triageKeys("openai");
      expect(triage.healthyKeys.map((k) => k.id)).toEqual([
        "key-openai-2",
        "key-openai-3",
      ]);
      expect(triage.circuitBrokenKeys).toHaveLength(1);
      expect(triage.circuitBrokenKeys[0]?.key.id).toBe("key-openai-1");
      expect(triage.circuitBrokenKeys[0]?.reason).toBe("circuit_breaker_open");
      expect(triage.circuitBrokenKeys[0]?.retryAfterSeconds).toBe(60);
    });

    it("re-admits circuit breaker key when HALF_OPEN cooldown expires", async () => {
      await circuitBreaker.trip("key-openai-1");
      expect((await selector.triageKeys("openai")).healthyKeys).toHaveLength(2);

      // Advance time beyond cooldown (60 seconds)
      currentTime += 61_000;

      const triage = await selector.triageKeys("openai");
      expect(triage.healthyKeys.map((k) => k.id)).toContain("key-openai-1");
      expect(triage.healthyKeys).toHaveLength(3);
    });

    it("filters out static circuitOpenUntil timestamps if no dynamic circuit breaker is attached", async () => {
      const staticSelector = new KeySelector({
        keys: [
          {
            id: "static-1",
            provider: "openai",
            circuitOpenUntil: new Date(currentTime + 45_000).toISOString(),
          },
          { id: "static-2", provider: "openai" },
        ],
        timeProvider,
      });

      const triage = await staticSelector.triageKeys("openai");
      expect(triage.healthyKeys).toHaveLength(1);
      expect(triage.healthyKeys[0]?.id).toBe("static-2");
      expect(triage.circuitBrokenKeys[0]?.key.id).toBe("static-1");
      expect(triage.circuitBrokenKeys[0]?.retryAfterSeconds).toBe(45);
    });

    it("filters out rate-limited keys exceeding RPM limit", async () => {
      // Consume 60 requests on key-openai-1
      for (let i = 0; i < 60; i++) {
        await rateLimiter.increment("key-openai-1");
      }

      const triage = await selector.triageKeys("openai");
      expect(triage.healthyKeys.map((k) => k.id)).toEqual([
        "key-openai-2",
        "key-openai-3",
      ]);
      expect(triage.rateLimitedKeys).toHaveLength(1);
      expect(triage.rateLimitedKeys[0]?.key.id).toBe("key-openai-1");
      expect(triage.rateLimitedKeys[0]?.reason).toBe("rate_limit_exceeded");
      expect(triage.rateLimitedKeys[0]?.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("filters out keys exceeding financial microdollar budget capacity", async () => {
      const budgetLimiter = new RateLimiter(storage, {
        tenantId: "tenant-1",
        maxBudgetMicrodollars: 500_000n, // $0.50 cap
        timeProvider,
      });

      const budgetSelector = new KeySelector({
        keys: [mockOpenAIKey1],
        rateLimiter: budgetLimiter,
        timeProvider,
      });

      // Advance spend to 400_000 µ$
      await budgetLimiter.increment("key-openai-1", 400_000n);

      // Cost of 50_000 µ$ is permitted (400k + 50k <= 500k)
      const allowed = await budgetSelector.filterHealthyKeys("openai", {
        costMicrodollars: 50_000n,
      });
      expect(allowed).toHaveLength(1);

      // Cost of 150_000 µ$ breaches ceiling (400k + 150k > 500k)
      const triage = await budgetSelector.triageKeys("openai", {
        costMicrodollars: 150_000n,
      });
      expect(triage.healthyKeys).toHaveLength(0);
      expect(triage.rateLimitedKeys[0]?.reason).toBe("budget_exceeded");
    });
  });

  describe("3. Round-Robin Key Selection", () => {
    it("cycles across healthy keys in deterministic round-robin order", async () => {
      const k1 = await selector.selectKey("openai", { strategy: "round-robin" });
      const k2 = await selector.selectKey("openai", { strategy: "round-robin" });
      const k3 = await selector.selectKey("openai", { strategy: "round-robin" });
      const k4 = await selector.selectKey("openai", { strategy: "round-robin" });

      expect(k1.id).toBe("key-openai-1");
      expect(k2.id).toBe("key-openai-2");
      expect(k3.id).toBe("key-openai-3");
      expect(k4.id).toBe("key-openai-1");
    });

    it("dynamically adjusts round-robin sequence when a key becomes unhealthy", async () => {
      const k1 = await selector.selectKey("openai");
      expect(k1.id).toBe("key-openai-1");

      // Key 2 trips circuit breaker
      await circuitBreaker.trip("key-openai-2");

      // Next selections must smoothly alternate between key-1 and key-3
      const k2 = await selector.selectKey("openai");
      const k3 = await selector.selectKey("openai");
      const k4 = await selector.selectKey("openai");

      expect(k2.id).toBe("key-openai-3");
      expect(k3.id).toBe("key-openai-1");
      expect(k4.id).toBe("key-openai-3");
    });

    it("updates lastUsedAt on selected key", async () => {
      const selected = await selector.selectKey("openai");
      expect(selected.lastUsedAt).toBe(new Date(currentTime).toISOString());
    });
  });

  describe("4. Least-Used Key Selection", () => {
    it("selects the key with lowest current RPM load", async () => {
      // Key 1 has 5 requests, Key 2 has 2 requests, Key 3 has 0 requests
      for (let i = 0; i < 5; i++) await rateLimiter.increment("key-openai-1");
      for (let i = 0; i < 2; i++) await rateLimiter.increment("key-openai-2");

      const selected = await selector.selectKey("openai", {
        strategy: "least-used",
      });
      expect(selected.id).toBe("key-openai-3");
    });

    it("breaks ties using internal total invocation counts", async () => {
      // Set usage counts
      selector.recordUsage("key-openai-1");
      selector.recordUsage("key-openai-1");
      selector.recordUsage("key-openai-2");
      // key-openai-3 has 0

      const selected = await selector.selectKey("openai", {
        strategy: "least-used",
      });
      expect(selected.id).toBe("key-openai-3");
    });

    it("resets usage counts cleanly via resetUsage()", () => {
      selector.recordUsage("key-openai-1");
      expect(selector.getUsageCount("key-openai-1")).toBe(1);
      selector.resetUsage();
      expect(selector.getUsageCount("key-openai-1")).toBe(0);
    });
  });

  describe("5. Priority-Based Key Selection", () => {
    it("strictly prioritizes keys in the highest priority tier", async () => {
      // Priorities: key-openai-1 = 10, key-openai-2 = 5, key-openai-3 = 1
      const k1 = await selector.selectKey("openai", { strategy: "priority" });
      const k2 = await selector.selectKey("openai", { strategy: "priority" });

      expect(k1.id).toBe("key-openai-1");
      expect(k2.id).toBe("key-openai-1");
    });

    it("falls back to next priority tier when top tier is degraded or rate-limited", async () => {
      // Trip key 1 (priority 10)
      await circuitBreaker.trip("key-openai-1");

      // Key 2 (priority 5) must be selected
      const selected = await selector.selectKey("openai", { strategy: "priority" });
      expect(selected.id).toBe("key-openai-2");

      // Trip key 2 as well
      await circuitBreaker.trip("key-openai-2");

      // Key 3 (priority 1) must be selected
      const fallbackSelected = await selector.selectKey("openai", {
        strategy: "priority",
      });
      expect(fallbackSelected.id).toBe("key-openai-3");
    });

    it("round-robins among tied keys in the highest priority tier", async () => {
      selector.setKeys([
        { id: "tier1-a", provider: "openai", priority: 10 },
        { id: "tier1-b", provider: "openai", priority: 10 },
        { id: "tier2-a", provider: "openai", priority: 5 },
      ]);

      const s1 = await selector.selectKey("openai", { strategy: "priority" });
      const s2 = await selector.selectKey("openai", { strategy: "priority" });
      const s3 = await selector.selectKey("openai", { strategy: "priority" });

      expect(s1.id).toBe("tier1-a");
      expect(s2.id).toBe("tier1-b");
      expect(s3.id).toBe("tier1-a");
    });
  });

  describe("6. Exhaustion, Errors, and Provider Fallback", () => {
    it("throws KeyExhaustedError with retry-after header when all provider keys are degraded", async () => {
      await circuitBreaker.trip("key-openai-1");
      await circuitBreaker.trip("key-openai-2");
      await circuitBreaker.trip("key-openai-3");

      await expect(selector.selectKey("openai")).rejects.toThrow(KeyExhaustedError);

      try {
        await selector.selectKey("openai");
      } catch (err) {
        expect(err).toBeInstanceOf(KeyExhaustedError);
        const exhausted = err as KeyExhaustedError;
        expect(exhausted.statusCode).toBe(429);
        expect(exhausted.totalKeys).toBe(3);
        expect(exhausted.retryAfterSeconds).toBe(60);

        const response = exhausted.toResponse();
        expect(response.headers.get("retry-after")).toBe("60");
      }
    });

    it("returns null when throwOnExhausted: false", async () => {
      await circuitBreaker.trip("key-openai-1");
      await circuitBreaker.trip("key-openai-2");
      await circuitBreaker.trip("key-openai-3");

      const selected = await selector.selectKey("openai", {
        throwOnExhausted: false,
      });
      expect(selected).toBeNull();
    });

    it("throws KeyExhaustedError if provider has zero configured keys", async () => {
      await expect(selector.selectKey("groq")).rejects.toThrow(KeyExhaustedError);

      try {
        await selector.selectKey("groq");
      } catch (err) {
        const exhausted = err as KeyExhaustedError;
        expect(exhausted.totalKeys).toBe(0);
        expect(exhausted.message).toContain("No API keys configured for provider 'groq'");
      }
    });

    it("falls back to alternative healthy providers when fallbackToAnyProvider is enabled", async () => {
      // Exhaust all OpenAI keys
      await circuitBreaker.trip("key-openai-1");
      await circuitBreaker.trip("key-openai-2");
      await circuitBreaker.trip("key-openai-3");

      // With fallbackToAnyProvider enabled, anthropic key should be selected
      const fallbackKey = await selector.selectKey("openai", {
        fallbackToAnyProvider: true,
      });

      expect(fallbackKey.id).toBe("key-anthropic-1");
      expect(fallbackKey.provider).toBe("anthropic");
    });
  });

  describe("7. Synchronous Hot-Path Execution", () => {
    it("selects key synchronously with zero async I/O (<0.5ms proxy path)", () => {
      const k1 = selector.selectKeySync("openai");
      const k2 = selector.selectKeySync("openai");
      const k3 = selector.selectKeySync("openai");
      const k4 = selector.selectKeySync("openai");

      expect(k1?.id).toBe("key-openai-1");
      expect(k2?.id).toBe("key-openai-2");
      expect(k3?.id).toBe("key-openai-3");
      expect(k4?.id).toBe("key-openai-1");
    });

    it("sync triage detects circuit breaker trips and rate limits from memory", async () => {
      await circuitBreaker.trip("key-openai-1");
      const triage = selector.triageKeysSync("openai");

      expect(triage.healthyKeys.map((k) => k.id)).toEqual([
        "key-openai-2",
        "key-openai-3",
      ]);
      expect(triage.circuitBrokenKeys).toHaveLength(1);
    });

    it("sync selection throws KeyExhaustedError on total exhaustion", async () => {
      await circuitBreaker.trip("key-openai-1");
      await circuitBreaker.trip("key-openai-2");
      await circuitBreaker.trip("key-openai-3");

      expect(() => selector.selectKeySync("openai")).toThrow(KeyExhaustedError);
    });
  });

  describe("8. Durable Object Transactional Storage & Eviction", () => {
    it("persists round-robin pointers to DO storage", async () => {
      await selector.selectKey("openai");
      expect(storage.putCalls.some((c) => c.key === "ks:rr:openai")).toBe(true);
    });

    it("restores round-robin sequence after memory cache eviction", async () => {
      const k1 = await selector.selectKey("openai");
      expect(k1.id).toBe("key-openai-1");

      const k2 = await selector.selectKey("openai");
      expect(k2.id).toBe("key-openai-2");

      // Simulate DO eviction
      selector.clearMemoryCache();

      // Next key must be key-openai-3, NOT resetting to key-openai-1
      const k3 = await selector.selectKey("openai");
      expect(k3.id).toBe("key-openai-3");
    });
  });

  describe("9. Telemetry, KeyMetrics & Capacity Reporting", () => {
    it("implements getKeyMetrics() matching KeyPoolContract", async () => {
      await rateLimiter.increment("key-openai-1", 125_000n);
      await circuitBreaker.trip("key-openai-2");

      const metrics1 = await selector.getKeyMetrics("key-openai-1");
      expect(metrics1.rpm).toBe(1);
      expect(metrics1.circuitBreakerTripped).toBe(false);
      expect(metrics1.costAccumulatedMicrodollars).toBe(125_000n);

      const metrics2 = await selector.getKeyMetrics("key-openai-2");
      expect(metrics2.circuitBreakerTripped).toBe(true);
    });

    it("calculates comprehensive CapacitySummary for tenant pool", async () => {
      // 3 OpenAI keys with rpmLimit: 60 -> totalRpmLimit = 180
      await rateLimiter.increment("key-openai-1");
      await rateLimiter.increment("key-openai-1");
      await rateLimiter.increment("key-openai-2");

      const summary = await selector.getCapacitySummary("openai");
      expect(summary.totalKeys).toBe(3);
      expect(summary.healthyKeys).toBe(3);
      expect(summary.totalRpmLimit).toBe(180);
      expect(summary.currentRpm).toBe(3);
      expect(summary.remainingRpm).toBe(177);
      expect(summary.utilizationPercent).toBe(2);
    });
  });

  describe("10. Type Contracts & SelectableKey Compatibility", () => {
    it("validates EncryptedKey contract compatibility", async () => {
      const encryptedKey: EncryptedKey = {
        id: "enc-key-1",
        tenantId: "tenant-1",
        provider: "anthropic",
        ciphertext: "base64-ciphertext",
        nonce: "base64-nonce",
      };

      const encryptedSelector = new KeySelector<EncryptedKey>({
        keys: [encryptedKey],
        timeProvider,
      });

      const selected = await encryptedSelector.selectKey("anthropic");
      expect(selected.id).toBe("enc-key-1");
      expect(selected.ciphertext).toBe("base64-ciphertext");
      expect(selected.nonce).toBe("base64-nonce");
    });

    it("isSelectableKey type guard verifies objects accurately", () => {
      expect(isSelectableKey({ id: "k1", provider: "openai" })).toBe(true);
      expect(isSelectableKey(mockOpenAIKey1)).toBe(true);
      expect(isSelectableKey(null)).toBe(false);
      expect(isSelectableKey({ id: "k1" })).toBe(false);
      expect(isSelectableKey({ provider: "openai" })).toBe(false);
      expect(isSelectableKey({ id: "", provider: "openai" })).toBe(false);
    });
  });
});
