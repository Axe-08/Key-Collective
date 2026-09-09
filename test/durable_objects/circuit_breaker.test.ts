/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: CircuitBreaker State Machine & DO Storage Persistence (T-01)
 *
 * Invariants & Standards:
 * - Strict TypeScript: No `any`, strict mode.
 * - Conforms to LLD 3.1:
 *   - State machine: CLOSED -> OPEN -> HALF_OPEN -> CLOSED / OPEN.
 *   - DO Transactional Storage: survives eviction.
 *   - Contract: trip(), reset(), canExecute().
 *   - Result recording: recordResult(keyId, success), recordSuccess, recordFailure.
 * - Zero floating-point math.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SECONDS,
  DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
  DEFAULT_CIRCUIT_BREAKER_TRIPPING_STATUS_CODES,
} from "../../src/constants/limits";
import {
  CircuitBreaker,
  DurableObjectStorageLike,
  CircuitBreakerData,
  createDefaultCircuitBreakerData,
  isCircuitBreakerData,
  isCircuitBreakerState,
} from "../../src/durable_objects/circuit_breaker";
import { CircuitBreakerTrippedError } from "../../src/errors/routing_errors";

/**
 * Mock implementation of Cloudflare DurableObjectStorage.
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

  async list<T = unknown>(_options?: unknown): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [k, v] of this.store.entries()) {
      result.set(k, v as T);
    }
    return result;
  }
}

describe("CircuitBreaker (T-01)", () => {
  let storage: MockDurableObjectStorage;
  let currentTime: number;
  const timeProvider = () => currentTime;

  beforeEach(() => {
    storage = new MockDurableObjectStorage();
    currentTime = 1_000_000;
  });

  describe("1. Initial State & Defaults", () => {
    it("initializes with default closed state and allows execution", async () => {
      const cb = new CircuitBreaker(storage, { timeProvider });

      expect(await cb.canExecute()).toBe(true);
      expect(await cb.getState()).toBe("CLOSED");
      expect(cb.canExecuteSync()).toBe(true);
      expect(cb.getStateSync()).toBe("CLOSED");

      const data = await cb.getData();
      expect(data.state).toBe("CLOSED");
      expect(data.consecutiveFailures).toBe(0);
      expect(data.consecutiveSuccesses).toBe(0);
      expect(data.openedAt).toBeNull();
      expect(data.lastFailureTime).toBeNull();
      expect(data.lastSuccessTime).toBeNull();
    });

    it("respects default constants when no options are provided", () => {
      const cb = new CircuitBreaker(storage);
      expect(cb.failureThreshold).toBe(DEFAULT_CIRCUIT_BREAKER_THRESHOLD);
      expect(cb.cooldownSeconds).toBe(DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SECONDS);
      expect(cb.trippingStatusCodes).toEqual(DEFAULT_CIRCUIT_BREAKER_TRIPPING_STATUS_CODES);
    });

    it("accepts custom threshold and cooldown options", () => {
      const cb = new CircuitBreaker(storage, {
        failureThreshold: 5,
        cooldownSeconds: 30,
        halfOpenSuccessThreshold: 2,
        trippingStatusCodes: [500, 503],
      });
      expect(cb.failureThreshold).toBe(5);
      expect(cb.cooldownSeconds).toBe(30);
      expect(cb.cooldownMs).toBe(30000);
      expect(cb.halfOpenSuccessThreshold).toBe(2);
      expect(cb.trippingStatusCodes).toEqual([500, 503]);
    });
  });

  describe("2. CLOSED State Behavior", () => {
    it("resets consecutive failures upon success", async () => {
      const cb = new CircuitBreaker(storage, { timeProvider });

      await cb.recordFailure();
      await cb.recordFailure();
      expect((await cb.getData()).consecutiveFailures).toBe(2);
      expect(await cb.getState()).toBe("CLOSED");

      await cb.recordSuccess();
      const data = await cb.getData();
      expect(data.consecutiveFailures).toBe(0);
      expect(data.lastSuccessTime).toBe(currentTime);
      expect(data.state).toBe("CLOSED");
    });

    it("trips to OPEN when failures reach failureThreshold (3 consecutive)", async () => {
      const cb = new CircuitBreaker(storage, { timeProvider });

      // Failure 1
      await cb.recordFailure();
      expect(await cb.getState()).toBe("CLOSED");
      expect(await cb.canExecute()).toBe(true);

      // Failure 2
      await cb.recordFailure();
      expect(await cb.getState()).toBe("CLOSED");
      expect(await cb.canExecute()).toBe(true);

      // Failure 3 -> Trips
      currentTime += 100;
      await cb.recordFailure();
      expect(await cb.getState()).toBe("OPEN");
      expect(await cb.canExecute()).toBe(false);

      const data = await cb.getData();
      expect(data.state).toBe("OPEN");
      expect(data.consecutiveFailures).toBe(3);
      expect(data.openedAt).toBe(currentTime);
    });

    it("resets failure counter if success occurs between failures", async () => {
      const cb = new CircuitBreaker(storage, { failureThreshold: 3, timeProvider });

      await cb.recordFailure();
      await cb.recordFailure();
      expect((await cb.getData()).consecutiveFailures).toBe(2);

      await cb.recordSuccess();
      expect((await cb.getData()).consecutiveFailures).toBe(0);

      await cb.recordFailure();
      expect((await cb.getData()).consecutiveFailures).toBe(1);
      expect(await cb.getState()).toBe("CLOSED");
    });
  });

  describe("3. OPEN State & Cooldown Transitions", () => {
    it("rejects execution while within cooldown period", async () => {
      const cb = new CircuitBreaker(storage, { cooldownSeconds: 60, timeProvider });
      await cb.trip();

      expect(await cb.getState()).toBe("OPEN");
      expect(await cb.canExecute()).toBe(false);
      expect(cb.canExecuteSync()).toBe(false);

      // Advance time by 30 seconds (still within cooldown)
      currentTime += 30_000;
      expect(await cb.getState()).toBe("OPEN");
      expect(await cb.canExecute()).toBe(false);
      expect(await cb.getRetryAfterSeconds()).toBe(30);
      expect(await cb.getCircuitOpenUntil()).toBe(new Date(1_000_000 + 60_000).toISOString());
    });

    it("transitions automatically to HALF_OPEN after cooldown expires", async () => {
      const cb = new CircuitBreaker(storage, { cooldownSeconds: 60, timeProvider });
      await cb.trip();

      // Advance time past cooldown
      currentTime += 60_001;

      expect(await cb.getState()).toBe("HALF_OPEN");
      expect(await cb.canExecute()).toBe(true);
      expect(cb.canExecuteSync()).toBe(true);
      expect(await cb.getCircuitOpenUntil()).toBeNull();
      expect(await cb.getRetryAfterSeconds()).toBe(0);
    });

    it("throws CircuitBreakerTrippedError via throwIfOpen when OPEN", async () => {
      const cb = new CircuitBreaker(storage, { keyId: "key-openai-1", cooldownSeconds: 60, timeProvider });
      await cb.trip();

      await expect(cb.throwIfOpen()).rejects.toThrow(CircuitBreakerTrippedError);

      try {
        await cb.throwIfOpen();
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitBreakerTrippedError);
        const cbErr = err as CircuitBreakerTrippedError;
        expect(cbErr.statusCode).toBe(503);
        expect(cbErr.provider).toBe("key-openai-1");
        expect(cbErr.retryAfterSeconds).toBe(60);
      }
    });
  });

  describe("4. HALF_OPEN State Behavior", () => {
    it("recovers to CLOSED upon successful probe", async () => {
      const cb = new CircuitBreaker(storage, {
        cooldownSeconds: 60,
        halfOpenSuccessThreshold: 1,
        timeProvider,
      });

      await cb.trip();
      currentTime += 60_000; // Enter HALF_OPEN
      expect(await cb.getState()).toBe("HALF_OPEN");

      // Successful probe request
      await cb.recordResult(true);

      expect(await cb.getState()).toBe("CLOSED");
      expect(await cb.canExecute()).toBe(true);

      const data = await cb.getData();
      expect(data.consecutiveFailures).toBe(0);
      expect(data.consecutiveSuccesses).toBe(0);
      expect(data.openedAt).toBeNull();
    });

    it("requires multiple successful probes when halfOpenSuccessThreshold > 1", async () => {
      const cb = new CircuitBreaker(storage, {
        cooldownSeconds: 60,
        halfOpenSuccessThreshold: 2,
        timeProvider,
      });

      await cb.trip();
      currentTime += 60_000;
      expect(await cb.getState()).toBe("HALF_OPEN");

      // Probe 1 success
      await cb.recordSuccess();
      expect(await cb.getState()).toBe("HALF_OPEN");
      expect((await cb.getData()).consecutiveSuccesses).toBe(1);

      // Probe 2 success -> Closes
      await cb.recordSuccess();
      expect(await cb.getState()).toBe("CLOSED");
      expect((await cb.getData()).consecutiveSuccesses).toBe(0);
    });

    it("trips immediately back to OPEN if probe request fails", async () => {
      const cb = new CircuitBreaker(storage, {
        cooldownSeconds: 60,
        timeProvider,
      });

      await cb.trip();
      currentTime += 60_000;
      expect(await cb.getState()).toBe("HALF_OPEN");

      // Probe fails
      currentTime += 500;
      await cb.recordResult(false);

      expect(await cb.getState()).toBe("OPEN");
      expect(await cb.canExecute()).toBe(false);

      const data = await cb.getData();
      expect(data.openedAt).toBe(currentTime); // New cooldown started
      expect(data.consecutiveSuccesses).toBe(0);

      // Needs another 60 seconds of cooldown
      currentTime += 30_000;
      expect(await cb.canExecute()).toBe(false);
      currentTime += 30_001;
      expect(await cb.canExecute()).toBe(true);
      expect(await cb.getState()).toBe("HALF_OPEN");
    });
  });

  describe("5. Contract: trip() and reset()", () => {
    it("trip() forces state to OPEN from any state", async () => {
      const cb = new CircuitBreaker(storage, { timeProvider });

      expect(await cb.getState()).toBe("CLOSED");
      await cb.trip();
      expect(await cb.getState()).toBe("OPEN");
      expect(await cb.canExecute()).toBe(false);

      // Trip again refreshes openedAt
      currentTime += 10_000;
      await cb.trip();
      expect((await cb.getData()).openedAt).toBe(currentTime);
    });

    it("reset() forces state to CLOSED and resets all counters", async () => {
      const cb = new CircuitBreaker(storage, { timeProvider });
      await cb.trip();
      expect(await cb.getState()).toBe("OPEN");

      await cb.reset();
      expect(await cb.getState()).toBe("CLOSED");
      expect(await cb.canExecute()).toBe(true);

      const data = await cb.getData();
      expect(data.consecutiveFailures).toBe(0);
      expect(data.consecutiveSuccesses).toBe(0);
      expect(data.openedAt).toBeNull();
    });
  });

  describe("6. DO Transactional Storage Persistence & Eviction Survival (Invariant)", () => {
    it("persists state to storage on each state mutation", async () => {
      const cb = new CircuitBreaker(storage, { keyId: "key-gemini", timeProvider });

      await cb.trip();
      const storageKey = cb.getStorageKey();
      const rawStored = storage.store.get(storageKey) as CircuitBreakerData;

      expect(rawStored).toBeDefined();
      expect(rawStored.state).toBe("OPEN");
      expect(rawStored.openedAt).toBe(currentTime);
    });

    it("survives DO instance eviction and restores state correctly from storage", async () => {
      const cb1 = new CircuitBreaker(storage, { keyId: "key-1", cooldownSeconds: 60, timeProvider });

      // Key-1 records 2 failures
      await cb1.recordFailure();
      await cb1.recordFailure();
      expect((await cb1.getData()).consecutiveFailures).toBe(2);

      // Simulate DO instance eviction by clearing memory cache
      cb1.clearMemoryCache();

      // Create new breaker instance against the same DO storage (simulates DO resurrect)
      const cb2 = new CircuitBreaker(storage, { keyId: "key-1", cooldownSeconds: 60, timeProvider });
      const dataAfterEviction = await cb2.getData();

      expect(dataAfterEviction.consecutiveFailures).toBe(2);
      expect(dataAfterEviction.state).toBe("CLOSED");

      // One more failure trips the circuit
      await cb2.recordFailure();
      expect(await cb2.getState()).toBe("OPEN");

      // Simulate eviction while in OPEN state
      cb2.clearMemoryCache();

      // Time advances past cooldown while DO was sleeping/evicted
      currentTime += 65_000;

      const cb3 = new CircuitBreaker(storage, { keyId: "key-1", cooldownSeconds: 60, timeProvider });
      expect(await cb3.getState()).toBe("HALF_OPEN");
      expect(await cb3.canExecute()).toBe(true);
    });
  });

  describe("7. Multi-Key Isolation within Single Durable Object", () => {
    it("isolates circuit state across distinct key IDs", async () => {
      const cb = new CircuitBreaker(storage, { timeProvider });

      // Trip key-a
      await cb.trip("key-a");

      expect(await cb.canExecute("key-a")).toBe(false);
      expect(await cb.getState("key-a")).toBe("OPEN");

      // key-b and key-c remain healthy
      expect(await cb.canExecute("key-b")).toBe(true);
      expect(await cb.getState("key-b")).toBe("CLOSED");
      expect(await cb.canExecute("key-c")).toBe(true);
      expect(await cb.getState("key-c")).toBe("CLOSED");

      // Record failures on key-b
      await cb.recordResult("key-b", false);
      await cb.recordResult("key-b", false);
      await cb.recordResult("key-b", false);

      expect(await cb.getState("key-b")).toBe("OPEN");
      expect(await cb.getState("key-c")).toBe("CLOSED");

      // Reset key-a without affecting key-b
      await cb.reset("key-a");
      expect(await cb.getState("key-a")).toBe("CLOSED");
      expect(await cb.getState("key-b")).toBe("OPEN");
    });
  });

  describe("8. HTTP Status Code Handling (recordStatusCode)", () => {
    it("treats tripping HTTP status codes (429, 500, 502, 503, 504) as failures", async () => {
      const cb = new CircuitBreaker(storage, { failureThreshold: 3, timeProvider });

      await cb.recordStatusCode(429); // failure 1
      await cb.recordStatusCode(503); // failure 2
      expect(await cb.getState()).toBe("CLOSED");

      await cb.recordStatusCode(502); // failure 3 -> trips
      expect(await cb.getState()).toBe("OPEN");
    });

    it("treats 2xx status codes as successes and resets failures", async () => {
      const cb = new CircuitBreaker(storage, { failureThreshold: 3, timeProvider });

      await cb.recordStatusCode(500);
      await cb.recordStatusCode(500);
      expect((await cb.getData()).consecutiveFailures).toBe(2);

      await cb.recordStatusCode(200);
      expect((await cb.getData()).consecutiveFailures).toBe(0);
      expect(await cb.getState()).toBe("CLOSED");
    });

    it("ignores non-tripping non-success codes like 400 Bad Request", async () => {
      const cb = new CircuitBreaker(storage, { failureThreshold: 3, timeProvider });

      await cb.recordStatusCode(400);
      await cb.recordStatusCode(401);
      await cb.recordStatusCode(404);

      expect((await cb.getData()).consecutiveFailures).toBe(0);
      expect(await cb.getState()).toBe("CLOSED");
    });
  });

  describe("9. Type Guards & Data Sanitization", () => {
    it("validates circuit breaker state with isCircuitBreakerState", () => {
      expect(isCircuitBreakerState("CLOSED")).toBe(true);
      expect(isCircuitBreakerState("OPEN")).toBe(true);
      expect(isCircuitBreakerState("HALF_OPEN")).toBe(true);
      expect(isCircuitBreakerState("UNKNOWN")).toBe(false);
      expect(isCircuitBreakerState(123)).toBe(false);
      expect(isCircuitBreakerState(null)).toBe(false);
    });

    it("validates circuit breaker data with isCircuitBreakerData", () => {
      const valid = createDefaultCircuitBreakerData();
      expect(isCircuitBreakerData(valid)).toBe(true);

      expect(isCircuitBreakerData({ ...valid, state: "INVALID" })).toBe(false);
      expect(isCircuitBreakerData({ ...valid, consecutiveFailures: "three" })).toBe(false);
      expect(isCircuitBreakerData(null)).toBe(false);
      expect(isCircuitBreakerData("string")).toBe(false);
    });

    it("gracefully recovers to default CLOSED if storage data is corrupted", async () => {
      const storageKey = "cb:corrupted-key";
      storage.store.set(storageKey, { invalid: "garbage_data" });

      const cb = new CircuitBreaker(storage, { keyId: "corrupted-key", timeProvider });
      const data = await cb.getData();

      expect(data.state).toBe("CLOSED");
      expect(data.consecutiveFailures).toBe(0);
      expect(await cb.canExecute()).toBe(true);
    });
  });
});
