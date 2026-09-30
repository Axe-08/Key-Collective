import { beforeEach, describe, expect, it } from "vitest";
import {
  RateLimiterDO,
  RateLimiterStorageLike,
  RateLimiterStateLike,
} from "../../src/durable_objects/rate_limiter_do";

/**
 * In-memory Mock DurableObjectStorage for RateLimiterDO tests.
 */
class MockDOStorage implements RateLimiterStorageLike {
  private store = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const val = this.store.get(key);
    if (val === undefined) return undefined;
    // Return structured clone to prevent shared references
    return JSON.parse(JSON.stringify(val)) as T;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.store.set(key, JSON.parse(JSON.stringify(value)));
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }
}

class MockDOState implements RateLimiterStateLike {
  constructor(public storage: RateLimiterStorageLike = new MockDOStorage()) {}
}

describe("RateLimiterDO", () => {
  let mockStorage: MockDOStorage;
  let mockState: MockDOState;
  let currentTime: number;
  const timeProvider = () => currentTime;

  beforeEach(() => {
    mockStorage = new MockDOStorage();
    mockState = new MockDOState(mockStorage);
    currentTime = 1_000_000_000; // Baseline timestamp in ms
  });

  describe("RPC checkLimit", () => {
    it("allows up to 5 requests per hour and rejects subsequent requests", async () => {
      const limiter = new RateLimiterDO(mockState, {}, { timeProvider });
      const oneHourMs = 3_600_000;

      // Request 1
      const res1 = await limiter.checkLimit(5, oneHourMs);
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(4);
      expect(res1.resetAt).toBe(currentTime + oneHourMs);

      // Advance time slightly (e.g. 10 seconds)
      currentTime += 10_000;

      // Request 2
      const res2 = await limiter.checkLimit(5, oneHourMs);
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(3);
      expect(res2.resetAt).toBe(1_000_000_000 + oneHourMs);

      // Advance time
      currentTime += 10_000;

      // Request 3
      const res3 = await limiter.checkLimit(5, oneHourMs);
      expect(res3.allowed).toBe(true);
      expect(res3.remaining).toBe(2);

      // Advance time
      currentTime += 10_000;

      // Request 4
      const res4 = await limiter.checkLimit(5, oneHourMs);
      expect(res4.allowed).toBe(true);
      expect(res4.remaining).toBe(1);

      // Advance time
      currentTime += 10_000;

      // Request 5 (Last allowed)
      const res5 = await limiter.checkLimit(5, oneHourMs);
      expect(res5.allowed).toBe(true);
      expect(res5.remaining).toBe(0);

      // Request 6 (Rejected: limit of 5 exceeded)
      const res6 = await limiter.checkLimit(5, oneHourMs);
      expect(res6.allowed).toBe(false);
      expect(res6.remaining).toBe(0);
      expect(res6.resetAt).toBe(1_000_000_000 + oneHourMs);

      // Request 7 (Still rejected)
      const res7 = await limiter.checkLimit(5, oneHourMs);
      expect(res7.allowed).toBe(false);
      expect(res7.remaining).toBe(0);
    });

    it("allows new requests once the oldest timestamp slides out of the window", async () => {
      const limiter = new RateLimiterDO(mockState, {}, { timeProvider });
      const oneHourMs = 3_600_000;
      const t0 = currentTime;

      // Send 5 requests spaced 1 second apart
      for (let i = 0; i < 5; i++) {
        const res = await limiter.checkLimit(5, oneHourMs);
        expect(res.allowed).toBe(true);
        currentTime += 1_000;
      }

      // 6th request is rejected
      const rejected = await limiter.checkLimit(5, oneHourMs);
      expect(rejected.allowed).toBe(false);

      // Advance time so that only request 0 has expired (> 1 hour after t0)
      currentTime = t0 + oneHourMs + 1;

      // Should now be allowed because request 0 slid out of the window
      const allowedAfterSlide = await limiter.checkLimit(5, oneHourMs);
      expect(allowedAfterSlide.allowed).toBe(true);
      expect(allowedAfterSlide.remaining).toBe(0);

      // Next immediate request is rejected again
      const rejectedAgain = await limiter.checkLimit(5, oneHourMs);
      expect(rejectedAgain.allowed).toBe(false);
    });

    it("persists sliding window state across DO evictions in transactional storage", async () => {
      const limiter1 = new RateLimiterDO(mockState, {}, { timeProvider });
      const oneHourMs = 3_600_000;

      // Send 3 requests on first DO instance
      await limiter1.checkLimit(5, oneHourMs);
      await limiter1.checkLimit(5, oneHourMs);
      const res3 = await limiter1.checkLimit(5, oneHourMs);
      expect(res3.allowed).toBe(true);
      expect(res3.remaining).toBe(2);

      // Simulate DO restart/eviction with same storage
      const limiter2 = new RateLimiterDO(new MockDOState(mockStorage), {}, { timeProvider });

      const res4 = await limiter2.checkLimit(5, oneHourMs);
      expect(res4.allowed).toBe(true);
      expect(res4.remaining).toBe(1);

      const res5 = await limiter2.checkLimit(5, oneHourMs);
      expect(res5.allowed).toBe(true);
      expect(res5.remaining).toBe(0);

      const res6 = await limiter2.checkLimit(5, oneHourMs);
      expect(res6.allowed).toBe(false);
      expect(res6.remaining).toBe(0);
    });

    it("respects custom limit and windowMs parameters", async () => {
      const limiter = new RateLimiterDO(mockState, {}, { timeProvider });
      const limit = 2;
      const windowMs = 5_000;

      const r1 = await limiter.checkLimit(limit, windowMs);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(1);

      const r2 = await limiter.checkLimit(limit, windowMs);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(0);

      const r3 = await limiter.checkLimit(limit, windowMs);
      expect(r3.allowed).toBe(false);
      expect(r3.remaining).toBe(0);

      // Advance past windowMs
      currentTime += 5_001;

      const r4 = await limiter.checkLimit(limit, windowMs);
      expect(r4.allowed).toBe(true);
    });
  });

  describe("HTTP fetch handler", () => {
    it("returns HTTP 200 when within limit and 429 when limit exceeded", async () => {
      const limiter = new RateLimiterDO(mockState, {}, { timeProvider });

      // First 5 requests return 200
      for (let i = 0; i < 5; i++) {
        const req = new Request("https://abuse-limiter.internal/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 5, windowMs: 3_600_000 }),
        });
        const res = await limiter.fetch(req);
        expect(res.status).toBe(200);
        expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
        expect(res.headers.get("X-RateLimit-Remaining")).toBe(String(4 - i));

        const body = (await res.json()) as { allowed: boolean; remaining: number };
        expect(body.allowed).toBe(true);
        expect(body.remaining).toBe(4 - i);
      }

      // 6th request returns 429
      const req6 = new Request("https://abuse-limiter.internal/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 5, windowMs: 3_600_000 }),
      });
      const res6 = await limiter.fetch(req6);
      expect(res6.status).toBe(429);
      expect(res6.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(res6.headers.get("Retry-After")).toBeDefined();

      const body6 = (await res6.json()) as { allowed: boolean; remaining: number; resetAt: number };
      expect(body6.allowed).toBe(false);
      expect(body6.remaining).toBe(0);
      expect(body6.resetAt).toBeGreaterThan(currentTime);
    });

    it("parses query parameters in GET requests", async () => {
      const limiter = new RateLimiterDO(mockState, {}, { timeProvider });

      const req1 = new Request("https://abuse-limiter.internal/?limit=1&windowMs=60000", {
        method: "GET",
      });
      const res1 = await limiter.fetch(req1);
      expect(res1.status).toBe(200);

      const req2 = new Request("https://abuse-limiter.internal/?limit=1&windowMs=60000", {
        method: "GET",
      });
      const res2 = await limiter.fetch(req2);
      expect(res2.status).toBe(429);
    });
  });
});
