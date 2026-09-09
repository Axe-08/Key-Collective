/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: RateLimiter Sliding-Window Counters & DO Storage Persistence (T-02)
 *
 * Invariants & Standards:
 * - Strict TypeScript: No `any`, strict mode.
 * - Conforms to LLD 3.2:
 *   - Sliding-window counters for RPM and RPD.
 *   - DO Transactional Storage persistence (survives eviction).
 *   - Contract: checkLimit(costMicrodollars), increment(costMicrodollars).
 * - Fixed-point microdollars (zero floating-point math).
 * - Strict tenant isolation.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  DEFAULT_RPD_LIMIT,
  DEFAULT_RPM_LIMIT,
  DEFAULT_WINDOW_SIZE_SECONDS,
} from "../../src/constants/limits";
import {
  createDefaultRateLimiterData,
  isRateLimitEntry,
  isRateLimiterData,
  ONE_DAY_MS,
  ONE_DAY_SECONDS,
  RateLimiter,
  RateLimiterData,
} from "../../src/durable_objects/rate_limiter";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "../../src/errors/key_errors";
import type { DurableObjectStorageLike } from "../../src/durable_objects/circuit_breaker";

/**
 * Mock implementation of Cloudflare DurableObjectStorage.
 */
class MockDurableObjectStorage implements DurableObjectStorageLike {
  public store = new Map<string, unknown>();
  public putCalls: Array<{ key: string; value: unknown }> = [];
  public getCalls: string[] = [];

  async get<T = unknown>(key: string): Promise<T | undefined>;
  async get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  async get<T = unknown>(
    keyOrKeys: string | string[]
  ): Promise<T | undefined | Map<string, T>> {
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
  async put<T>(
    keyOrEntries: string | Record<string, T>,
    value?: T
  ): Promise<void> {
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

  async list<T = unknown>(_options?: unknown): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [k, v] of this.store.entries()) {
      result.set(k, v as T);
    }
    return result;
  }
}

describe("RateLimiter (T-02)", () => {
  let storage: MockDurableObjectStorage;
  let currentTime: number;
  const timeProvider = () => currentTime;

  beforeEach(() => {
    storage = new MockDurableObjectStorage();
    currentTime = 1_000_000;
  });

  describe("1. Initial State & Defaults", () => {
    it("initializes with default constants and empty counters", async () => {
      const rl = new RateLimiter(storage, { timeProvider });

      expect(rl.rpmLimit).toBe(DEFAULT_RPM_LIMIT);
      expect(rl.rpdLimit).toBe(DEFAULT_RPD_LIMIT);
      expect(rl.windowSizeSeconds).toBe(DEFAULT_WINDOW_SIZE_SECONDS);
      expect(rl.windowSizeMs).toBe(60_000);
      expect(rl.dayWindowSeconds).toBe(ONE_DAY_SECONDS);
      expect(rl.dayWindowMs).toBe(ONE_DAY_MS);

      expect(await rl.checkLimit()).toBe(true);
      expect(rl.checkLimitSync()).toBe(true);
      expect(await rl.getCurrentRpm()).toBe(0);
      expect(await rl.getCurrentRpd()).toBe(0);
      expect(await rl.getRemainingRpm()).toBe(DEFAULT_RPM_LIMIT);
      expect(await rl.getRemainingRpd()).toBe(DEFAULT_RPD_LIMIT);
      expect(await rl.getAccumulatedCost()).toBe(0n);
      expect(await rl.getRetryAfterSeconds()).toBe(0);

      const data = await rl.getData();
      expect(data.entries).toEqual([]);
      expect(data.totalCostMicrodollars).toBe("0");
      expect(data.lastRequestTime).toBeNull();
    });

    it("accepts custom limit options", () => {
      const rl = new RateLimiter(storage, {
        tenantId: "tenant-123",
        keyId: "key-custom",
        rpmLimit: 10,
        rpdLimit: 200,
        windowSizeSeconds: 30,
        dayWindowSeconds: 43200,
        maxBudgetMicrodollars: 50_000_000n,
        storageKeyPrefix: "custom-rl:",
        timeProvider,
      });

      expect(rl.tenantId).toBe("tenant-123");
      expect(rl.rpmLimit).toBe(10);
      expect(rl.rpdLimit).toBe(200);
      expect(rl.windowSizeSeconds).toBe(30);
      expect(rl.windowSizeMs).toBe(30_000);
      expect(rl.dayWindowSeconds).toBe(43200);
      expect(rl.dayWindowMs).toBe(43_200_000);
      expect(rl.maxBudgetMicrodollars).toBe(50_000_000n);
      expect(rl.getStorageKey()).toBe("custom-rl:key-custom");
      expect(rl.getStorageKey("override-key")).toBe("custom-rl:override-key");
    });

    it("supports RateLimitConfig partial config parameter", () => {
      const rl = new RateLimiter(storage, {
        defaultRpmLimit: 120,
        defaultRpdLimit: 5000,
        windowSizeSeconds: 120,
      });

      expect(rl.rpmLimit).toBe(120);
      expect(rl.rpdLimit).toBe(5000);
      expect(rl.windowSizeSeconds).toBe(120);
    });
  });

  describe("2. RPM Sliding Window Counter Behavior", () => {
    it("increments counters and computes accurate remaining headroom", async () => {
      const rl = new RateLimiter(storage, { rpmLimit: 5, timeProvider });

      expect(await rl.checkLimit()).toBe(true);

      // Increment 1
      await rl.increment();
      expect(await rl.getCurrentRpm()).toBe(1);
      expect(await rl.getRemainingRpm()).toBe(4);
      expect(await rl.checkLimit()).toBe(true);

      // Increment 2 & 3
      currentTime += 500;
      await rl.increment();
      currentTime += 500;
      await rl.increment();
      expect(await rl.getCurrentRpm()).toBe(3);
      expect(await rl.getRemainingRpm()).toBe(2);
      expect(await rl.checkLimit()).toBe(true);
    });

    it("rejects checkLimit when RPM reaches configured limit", async () => {
      const rl = new RateLimiter(storage, { rpmLimit: 3, timeProvider });

      await rl.increment(); // 1
      currentTime += 1000;
      await rl.increment(); // 2
      currentTime += 1000;
      await rl.increment(); // 3 (capacity reached)

      expect(await rl.getCurrentRpm()).toBe(3);
      expect(await rl.getRemainingRpm()).toBe(0);
      expect(await rl.checkLimit()).toBe(false);
      expect(rl.checkLimitSync()).toBe(false);

      const detailed = await rl.checkLimitDetailed();
      expect(detailed.allowed).toBe(false);
      expect(detailed.reason).toBe("rpm_limit_exceeded");
      expect(detailed.currentRpm).toBe(3);
      expect(detailed.rpmLimit).toBe(3);
      expect(detailed.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("slides requests out of the window as time advances", async () => {
      // 60-second window
      const rl = new RateLimiter(storage, { rpmLimit: 2, windowSizeSeconds: 60, timeProvider });

      // t = 1,000,000: Request 1
      await rl.increment();
      expect(await rl.getCurrentRpm()).toBe(1);

      // t = 1,010,000: Request 2 -> Capacity full
      currentTime += 10_000;
      await rl.increment();
      expect(await rl.getCurrentRpm()).toBe(2);
      expect(await rl.checkLimit()).toBe(false);

      // Advance to t = 1,060,001 (60.001s after Request 1)
      currentTime = 1_000_000 + 60_001;

      // Request 1 has slid out, Request 2 (from 1,010,000) is still within window
      expect(await rl.getCurrentRpm()).toBe(1);
      expect(await rl.getRemainingRpm()).toBe(1);
      expect(await rl.checkLimit()).toBe(true);
      expect(rl.checkLimitSync()).toBe(true);

      // Advance to t = 1,070,001 (60.001s after Request 2)
      currentTime = 1_010_000 + 60_001;

      // Request 2 has also slid out
      expect(await rl.getCurrentRpm()).toBe(0);
      expect(await rl.getRemainingRpm()).toBe(2);
      expect(await rl.checkLimit()).toBe(true);
    });

    it("calculates precise retry-after seconds based on oldest request in window", async () => {
      const rl = new RateLimiter(storage, { rpmLimit: 2, windowSizeSeconds: 60, timeProvider });

      // t = 1,000,000: Request 1
      await rl.increment();
      // t = 1,020,000: Request 2
      currentTime += 20_000;
      await rl.increment();

      expect(await rl.checkLimit()).toBe(false);

      // Oldest request (1,000,000) will slide out at 1,060,000.
      // Current time is 1,020,000, so remaining time is 40,000 ms = 40 seconds.
      expect(await rl.getRetryAfterSeconds()).toBe(40);

      // Advance time by 15 seconds
      currentTime += 15_000;
      expect(await rl.getRetryAfterSeconds()).toBe(25);
    });
  });

  describe("3. RPD (Daily Quota) Sliding Window Counter Behavior", () => {
    it("enforces RPD limit even when RPM window has reset", async () => {
      const rl = new RateLimiter(storage, {
        rpmLimit: 100, // High RPM
        rpdLimit: 3,   // Low daily limit
        windowSizeSeconds: 60,
        dayWindowSeconds: ONE_DAY_SECONDS,
        timeProvider,
      });

      // Execute 3 requests
      await rl.increment();
      currentTime += 1000;
      await rl.increment();
      currentTime += 1000;
      await rl.increment();

      expect(await rl.getCurrentRpm()).toBe(3);
      expect(await rl.getCurrentRpd()).toBe(3);
      expect(await rl.checkLimit()).toBe(false);

      const detailed = await rl.checkLimitDetailed();
      expect(detailed.allowed).toBe(false);
      expect(detailed.reason).toBe("rpd_limit_exceeded");
      expect(detailed.currentRpd).toBe(3);
      expect(detailed.rpdLimit).toBe(3);

      // Advance time by 2 minutes (RPM resets to 0, but RPD is still 3)
      currentTime += 120_000;
      expect(await rl.getCurrentRpm()).toBe(0);
      expect(await rl.getCurrentRpd()).toBe(3);
      expect(await rl.checkLimit()).toBe(false);

      // Advance time past 24 hours
      currentTime += ONE_DAY_MS;
      expect(await rl.getCurrentRpd()).toBe(0);
      expect(await rl.checkLimit()).toBe(true);
    });

    it("calculates accurate RPD retry-after seconds", async () => {
      const rl = new RateLimiter(storage, {
        rpmLimit: 100,
        rpdLimit: 1,
        dayWindowSeconds: 3600, // 1 hour day window for test
        timeProvider,
      });

      await rl.increment();
      expect(await rl.checkLimit()).toBe(false);

      // Request was made at t = 1,000,000, expires at 1,000,000 + 3,600,000 = 4,600,000.
      currentTime += 600_000; // 10 minutes later
      expect(await rl.getRetryAfterSeconds()).toBe(3000);
    });
  });

  describe("4. Fixed-Point Microdollars & Financial Budget Invariants", () => {
    it("accumulates costs in fixed-point microdollars without precision loss", async () => {
      const rl = new RateLimiter(storage, { timeProvider });

      await rl.increment(123_456n);
      currentTime += 100;
      await rl.increment(789_012n);
      currentTime += 100;
      await rl.increment(1n);

      const accumulated = await rl.getAccumulatedCost();
      expect(accumulated).toBe(912_469n);

      const data = await rl.getData();
      expect(data.totalCostMicrodollars).toBe("912469");
    });

    it("enforces maxBudgetMicrodollars ceiling when configured", async () => {
      const rl = new RateLimiter(storage, {
        maxBudgetMicrodollars: 1_000_000n, // $1.00 USD
        timeProvider,
      });

      // Request 1: 800_000n µ$ ($0.80) -> within budget
      expect(await rl.checkLimit(800_000n)).toBe(true);
      await rl.increment(800_000n);
      expect(await rl.getAccumulatedCost()).toBe(800_000n);

      // Prospective Request 2: 250_000n µ$ ($0.25) -> exceeds $1.00 budget ceiling
      expect(await rl.checkLimit(250_000n)).toBe(false);

      const check = await rl.checkLimitDetailed(undefined, 250_000n);
      expect(check.allowed).toBe(false);
      expect(check.reason).toBe("budget_exceeded");
      expect(check.costAccumulatedMicrodollars).toBe(800_000n);

      // Prospective Request 3: 150_000n µ$ ($0.15) -> fits within remaining $0.20 budget
      expect(await rl.checkLimit(150_000n)).toBe(true);
      await rl.increment(150_000n);
      expect(await rl.getAccumulatedCost()).toBe(950_000n);
    });
  });

  describe("5. Error Assertion (throwIfExceeded)", () => {
    it("throws RateLimitExceededError with retryAfterSeconds when RPM exceeded", async () => {
      const rl = new RateLimiter(storage, {
        tenantId: "tenant-corp",
        keyId: "key-gpt4",
        rpmLimit: 2,
        timeProvider,
      });

      await rl.increment();
      await rl.increment();

      await expect(rl.throwIfExceeded()).rejects.toThrow(RateLimitExceededError);

      try {
        await rl.throwIfExceeded();
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitExceededError);
        const rlErr = err as RateLimitExceededError;
        expect(rlErr.statusCode).toBe(429);
        expect(rlErr.code).toBe("RATE_LIMIT_EXCEEDED");
        expect(rlErr.tenantId).toBe("tenant-corp");
        expect(rlErr.keyId).toBe("key-gpt4");
        expect(rlErr.rpmLimit).toBe(2);
        expect(rlErr.currentRpm).toBe(2);
        expect(rlErr.retryAfterSeconds).toBeGreaterThan(0);

        const res = rlErr.toResponse();
        expect(res.headers.get("retry-after")).toBe(String(rlErr.retryAfterSeconds));
      }
    });

    it("throws QuotaExceededError when RPD quota is reached", async () => {
      const rl = new RateLimiter(storage, {
        tenantId: "tenant-acme",
        keyId: "key-claude",
        rpmLimit: 100,
        rpdLimit: 2,
        timeProvider,
      });

      await rl.increment();
      await rl.increment();

      await expect(rl.throwIfExceeded()).rejects.toThrow(QuotaExceededError);

      try {
        await rl.throwIfExceeded();
      } catch (err) {
        expect(err).toBeInstanceOf(QuotaExceededError);
        const qErr = err as QuotaExceededError;
        expect(qErr.statusCode).toBe(429);
        expect(qErr.code).toBe("QUOTA_EXCEEDED");
        expect(qErr.tenantId).toBe("tenant-acme");
        expect(qErr.quotaType).toBe("rpd");
        expect(qErr.limit).toBe(2);
        expect(qErr.consumed).toBe(2);
      }
    });

    it("throws QuotaExceededError when spending ceiling is reached", async () => {
      const rl = new RateLimiter(storage, {
        tenantId: "tenant-budget",
        keyId: "key-o1",
        maxBudgetMicrodollars: 500_000n,
        timeProvider,
      });

      await rl.increment(400_000n);

      // Attempting request that exceeds ceiling
      await expect(rl.throwIfExceeded(undefined, 200_000n)).rejects.toThrow(QuotaExceededError);

      try {
        await rl.throwIfExceeded(undefined, 200_000n);
      } catch (err) {
        expect(err).toBeInstanceOf(QuotaExceededError);
        const qErr = err as QuotaExceededError;
        expect(qErr.quotaType).toBe("spend_limit");
        expect(qErr.limit).toBe(500_000n);
        expect(qErr.consumed).toBe(400_000n);
      }
    });
  });

  describe("6. DO Transactional Storage Persistence & Eviction Survival", () => {
    it("persists counter state to DO storage on each increment", async () => {
      const rl = new RateLimiter(storage, { keyId: "key-gemini", timeProvider });

      await rl.increment(10_000n);
      const storageKey = rl.getStorageKey();
      const raw = storage.store.get(storageKey) as RateLimiterData;

      expect(raw).toBeDefined();
      expect(raw.entries.length).toBe(1);
      expect(raw.entries[0]?.timestamp).toBe(currentTime);
      expect(raw.entries[0]?.count).toBe(1);
      expect(raw.entries[0]?.costMicrodollars).toBe("10000");
      expect(raw.totalCostMicrodollars).toBe("10000");
      expect(raw.lastRequestTime).toBe(currentTime);
    });

    it("survives DO eviction and restores counters accurately", async () => {
      const rl1 = new RateLimiter(storage, {
        keyId: "key-evict",
        rpmLimit: 3,
        windowSizeSeconds: 60,
        timeProvider,
      });

      // Record 2 requests
      await rl1.increment(500n);
      currentTime += 5000;
      await rl1.increment(500n);
      expect(await rl1.getCurrentRpm()).toBe(2);

      // Simulate DO eviction
      rl1.clearMemoryCache();

      // New instance resurrected from DO storage
      const rl2 = new RateLimiter(storage, {
        keyId: "key-evict",
        rpmLimit: 3,
        windowSizeSeconds: 60,
        timeProvider,
      });

      expect(await rl2.getCurrentRpm()).toBe(2);
      expect(await rl2.getAccumulatedCost()).toBe(1000n);
      expect(await rl2.checkLimit()).toBe(true);

      // One more request hits limit
      await rl2.increment(500n);
      expect(await rl2.getCurrentRpm()).toBe(3);
      expect(await rl2.checkLimit()).toBe(false);

      // Evict again while rate limited
      rl2.clearMemoryCache();

      // Time advances past 60s while DO was sleeping
      currentTime += 65_000;

      const rl3 = new RateLimiter(storage, {
        keyId: "key-evict",
        rpmLimit: 3,
        windowSizeSeconds: 60,
        timeProvider,
      });

      // Window has naturally slid out
      expect(await rl3.getCurrentRpm()).toBe(0);
      expect(await rl3.checkLimit()).toBe(true);
      // Cumulative lifetime cost is preserved
      expect(await rl3.getAccumulatedCost()).toBe(1500n);
    });
  });

  describe("7. Multi-Key Isolation within Single Durable Object", () => {
    it("maintains strict per-key isolation in the same DO storage", async () => {
      const rl = new RateLimiter(storage, { rpmLimit: 2, timeProvider });

      // Exhaust key-A
      await rl.increment("key-A", 100n);
      await rl.increment("key-A", 100n);
      expect(await rl.checkLimit("key-A")).toBe(false);
      expect(await rl.getCurrentRpm("key-A")).toBe(2);

      // key-B and key-C remain fully available
      expect(await rl.checkLimit("key-B")).toBe(true);
      expect(await rl.getCurrentRpm("key-B")).toBe(0);
      expect(await rl.checkLimit("key-C")).toBe(true);
      expect(await rl.getCurrentRpm("key-C")).toBe(0);

      // Usage on key-B
      await rl.increment("key-B", 500n);
      expect(await rl.getCurrentRpm("key-B")).toBe(1);
      expect(await rl.getAccumulatedCost("key-B")).toBe(500n);
      expect(await rl.getAccumulatedCost("key-A")).toBe(200n);

      // Reset key-A without affecting key-B
      await rl.reset("key-A");
      expect(await rl.checkLimit("key-A")).toBe(true);
      expect(await rl.getCurrentRpm("key-A")).toBe(0);
      expect(await rl.getCurrentRpm("key-B")).toBe(1);
    });
  });

  describe("8. Same-Millisecond Batch Aggregation", () => {
    it("aggregates multiple requests occurring in the exact same millisecond", async () => {
      const rl = new RateLimiter(storage, { timeProvider });

      // 3 requests with exact same timestamp
      await rl.increment(undefined, 100n);
      await rl.increment(undefined, 200n);
      await rl.increment(undefined, 300n);

      const data = await rl.getData();
      // Should be merged into 1 entry to optimize DO storage footprint
      expect(data.entries.length).toBe(1);
      expect(data.entries[0]?.count).toBe(3);
      expect(data.entries[0]?.costMicrodollars).toBe("600");
      expect(data.totalCostMicrodollars).toBe("600");
      expect(await rl.getCurrentRpm()).toBe(3);
      expect(await rl.getAccumulatedCost()).toBe(600n);
    });
  });

  describe("9. Metrics Snapshot (getMetrics)", () => {
    it("produces complete RateLimiterMetrics snapshot", async () => {
      const rl = new RateLimiter(storage, {
        rpmLimit: 10,
        rpdLimit: 100,
        timeProvider,
      });

      await rl.increment("key-1", 1000n);
      await rl.increment("key-1", 2000n);

      const metrics = await rl.getMetrics("key-1");
      expect(metrics.rpm).toBe(2);
      expect(metrics.rpd).toBe(2);
      expect(metrics.costAccumulatedMicrodollars).toBe(3000n);
      expect(metrics.remainingRpm).toBe(8);
      expect(metrics.remainingRpd).toBe(98);
      expect(metrics.isRateLimited).toBe(false);
      expect(metrics.retryAfterSeconds).toBe(0);
    });
  });

  describe("10. Type Guards & Data Validation", () => {
    it("validates RateLimitEntry with isRateLimitEntry", () => {
      expect(
        isRateLimitEntry({ timestamp: 12345, count: 1, costMicrodollars: "100" })
      ).toBe(true);
      expect(isRateLimitEntry(null)).toBe(false);
      expect(isRateLimitEntry({ timestamp: "bad", count: 1, costMicrodollars: "100" })).toBe(
        false
      );
      expect(isRateLimitEntry({ timestamp: 12345, count: "one", costMicrodollars: "100" })).toBe(
        false
      );
      expect(isRateLimitEntry({ timestamp: 12345, count: 1, costMicrodollars: 100 })).toBe(
        false
      );
    });

    it("validates RateLimiterData with isRateLimiterData", () => {
      const valid = createDefaultRateLimiterData();
      expect(isRateLimiterData(valid)).toBe(true);

      expect(isRateLimiterData(null)).toBe(false);
      expect(isRateLimiterData({ ...valid, entries: "invalid" })).toBe(false);
      expect(isRateLimiterData({ ...valid, totalCostMicrodollars: 100 })).toBe(false);
    });

    it("gracefully recovers to default clean state if storage data is corrupted", async () => {
      storage.store.set("rl:corrupted-key", { corrupted: true });

      const rl = new RateLimiter(storage, { keyId: "corrupted-key", timeProvider });
      const data = await rl.getData();

      expect(data.entries).toEqual([]);
      expect(data.totalCostMicrodollars).toBe("0");
      expect(await rl.checkLimit()).toBe(true);
    });
  });
});
