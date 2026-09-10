/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: DOStorageAdapter (Hot State Durable Object Storage)
 *
 * Conforms to LLD 2.2 & Invariants (GEMINI.md):
 * - TypeScript (strict mode, no `any`).
 * - Per-Tenant DO Isolation: Isolated storage instance per tenant DO.
 * - Fixed-Point Microdollars: All costs in int64/bigint microdollars (1 USD = 1,000,000 µ$). Zero floating-point math.
 * - DO Transactional Storage for Hot State: Circuit breaker and RPM counters sync atomically via ctx.storage.transaction().
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOStorageAdapter, StoredMetrics } from "./do";
import { InvalidKeyError } from "../errors/key_errors";

/**
 * In-memory Mock of Cloudflare DurableObjectStorage supporting atomic transactions and rollbacks.
 */
class MockDurableObjectStorage {
  public store = new Map<string, unknown>();
  public transactionCalls = 0;
  public putCalls: Array<{ key: string; value: unknown }> = [];
  public getCalls: string[] = [];

  async get<T = unknown>(key: string): Promise<T | undefined> {
    this.getCalls.push(key);
    const value = this.store.get(key);
    if (value === undefined) {
      return undefined;
    }
    // Deep clone to simulate serialization boundary
    return structuredClone(value) as T;
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.putCalls.push({ key, value });
    this.store.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  /**
   * Simulates Cloudflare Durable Objects transactional isolation and rollback.
   */
  async transaction<T>(
    closure: (txn: DurableObjectTransaction) => Promise<T>
  ): Promise<T> {
    this.transactionCalls++;
    const snapshot = new Map<string, unknown>(this.store);

    const transactionalTxn = {
      get: async <U = unknown>(key: string): Promise<U | undefined> => {
        return this.get<U>(key);
      },
      put: async <U = unknown>(key: string, value: U): Promise<void> => {
        return this.put<U>(key, value);
      },
      delete: async (key: string): Promise<boolean> => {
        return this.delete(key);
      },
      rollback: (): void => {
        this.store = new Map<string, unknown>(snapshot);
      },
    } as unknown as DurableObjectTransaction;

    try {
      return await closure(transactionalTxn);
    } catch (err) {
      // Roll back store to snapshot state on error
      this.store = snapshot;
      throw err;
    }
  }
}

describe("DOStorageAdapter", () => {
  let mockStorage: MockDurableObjectStorage;
  let adapter: DOStorageAdapter;

  beforeEach(() => {
    mockStorage = new MockDurableObjectStorage();
    adapter = new DOStorageAdapter(
      mockStorage as unknown as DurableObjectStorage
    );
  });

  describe("1. Initial State & Querying (getMetrics)", () => {
    it("returns undefined for an unrecorded key", async () => {
      const metrics = await adapter.getMetrics("key-unknown");
      expect(metrics).toBeUndefined();
    });

    it("rejects empty or whitespace key IDs", async () => {
      await expect(adapter.getMetrics("")).rejects.toThrow(InvalidKeyError);
      await expect(adapter.getMetrics("   ")).rejects.toThrow(InvalidKeyError);
    });

    it("correctly deserializes metrics with bigint cost", async () => {
      await mockStorage.put("metrics:k1", {
        rpm: 42,
        circuitBreakerTripped: true,
        costAccumulatedMicrodollars: "1500000",
      });

      const metrics = await adapter.getMetrics("k1");
      expect(metrics).toEqual({
        rpm: 42,
        circuitBreakerTripped: true,
        costAccumulatedMicrodollars: 1_500_000n,
      });
    });
  });

  describe("2. RPM Tracking (incrementRPM)", () => {
    it("increments RPM starting from 0 to 1 for a new key", async () => {
      await adapter.incrementRPM("key-1");

      const metrics = await adapter.getMetrics("key-1");
      expect(metrics).toBeDefined();
      expect(metrics?.rpm).toBe(1);
      expect(metrics?.circuitBreakerTripped).toBe(false);
      expect(metrics?.costAccumulatedMicrodollars).toBe(0n);
      expect(mockStorage.transactionCalls).toBe(1);
    });

    it("increments RPM sequentially across multiple requests", async () => {
      await adapter.incrementRPM("key-1");
      await adapter.incrementRPM("key-1");
      await adapter.incrementRPM("key-1");

      const metrics = await adapter.getMetrics("key-1");
      expect(metrics?.rpm).toBe(3);
      expect(mockStorage.transactionCalls).toBe(3);
    });

    it("preserves existing circuit breaker and cost when incrementing RPM", async () => {
      await adapter.addCost("key-1", 500_000n);
      await adapter.updateCircuitBreaker("key-1", true);

      await adapter.incrementRPM("key-1");

      const metrics = await adapter.getMetrics("key-1");
      expect(metrics?.rpm).toBe(1);
      expect(metrics?.circuitBreakerTripped).toBe(true);
      expect(metrics?.costAccumulatedMicrodollars).toBe(500_000n);
    });

    it("rejects empty key IDs when incrementing RPM", async () => {
      await expect(adapter.incrementRPM("")).rejects.toThrow(InvalidKeyError);
    });
  });

  describe("3. Circuit Breaker State (updateCircuitBreaker)", () => {
    it("trips the circuit breaker for a key", async () => {
      await adapter.updateCircuitBreaker("key-1", true);

      const metrics = await adapter.getMetrics("key-1");
      expect(metrics?.circuitBreakerTripped).toBe(true);
      expect(metrics?.rpm).toBe(0);
      expect(metrics?.costAccumulatedMicrodollars).toBe(0n);
      expect(mockStorage.transactionCalls).toBe(1);
    });

    it("resets the circuit breaker when tripped is false", async () => {
      await adapter.updateCircuitBreaker("key-1", true);
      let metrics = await adapter.getMetrics("key-1");
      expect(metrics?.circuitBreakerTripped).toBe(true);

      await adapter.updateCircuitBreaker("key-1", false);
      metrics = await adapter.getMetrics("key-1");
      expect(metrics?.circuitBreakerTripped).toBe(false);
    });

    it("preserves existing RPM and cost when updating circuit breaker", async () => {
      await adapter.incrementRPM("key-1");
      await adapter.incrementRPM("key-1");
      await adapter.addCost("key-1", 250_000n);

      await adapter.updateCircuitBreaker("key-1", true);

      const metrics = await adapter.getMetrics("key-1");
      expect(metrics?.rpm).toBe(2);
      expect(metrics?.circuitBreakerTripped).toBe(true);
      expect(metrics?.costAccumulatedMicrodollars).toBe(250_000n);
    });

    it("rejects empty key IDs when updating circuit breaker", async () => {
      await expect(adapter.updateCircuitBreaker("", true)).rejects.toThrow(InvalidKeyError);
    });
  });

  describe("4. Cost Accumulation (addCost - Fixed-Point Microdollars)", () => {
    it("accumulates cost in int64 microdollars starting from 0", async () => {
      await adapter.addCost("key-1", 1_000_000n); // $1.00

      const metrics = await adapter.getMetrics("key-1");
      expect(metrics?.costAccumulatedMicrodollars).toBe(1_000_000n);
      expect(metrics?.rpm).toBe(0);
      expect(metrics?.circuitBreakerTripped).toBe(false);
      expect(mockStorage.transactionCalls).toBe(1);
    });

    it("accumulates costs across multiple requests with zero float precision loss", async () => {
      await adapter.addCost("key-1", 123_456n);
      await adapter.addCost("key-1", 876_544n);
      await adapter.addCost("key-1", 1_000_000_000_000n); // Large int64 amount

      const metrics = await adapter.getMetrics("key-1");
      expect(metrics?.costAccumulatedMicrodollars).toBe(1_000_001_000_000n);
    });

    it("rejects negative cost values", async () => {
      await expect(adapter.addCost("key-1", -1n)).rejects.toThrow(
        "Cost in microdollars cannot be negative"
      );
    });

    it("rejects empty key IDs when adding cost", async () => {
      await expect(adapter.addCost("", 100n)).rejects.toThrow(InvalidKeyError);
    });
  });

  describe("5. Interleaved Lifecycle & Multi-Key Isolation", () => {
    it("handles interleaved mutations on a single key correctly", async () => {
      await adapter.incrementRPM("key-prod");
      await adapter.addCost("key-prod", 750_000n);
      await adapter.incrementRPM("key-prod");
      await adapter.updateCircuitBreaker("key-prod", true);
      await adapter.addCost("key-prod", 250_000n);

      const metrics = await adapter.getMetrics("key-prod");
      expect(metrics).toEqual({
        rpm: 2,
        circuitBreakerTripped: true,
        costAccumulatedMicrodollars: 1_000_000n,
      });
    });

    it("strictly isolates metrics between different key IDs", async () => {
      await adapter.incrementRPM("key-openai");
      await adapter.addCost("key-openai", 500_000n);

      await adapter.incrementRPM("key-anthropic");
      await adapter.incrementRPM("key-anthropic");
      await adapter.updateCircuitBreaker("key-anthropic", true);
      await adapter.addCost("key-anthropic", 2_000_000n);

      const openAiMetrics = await adapter.getMetrics("key-openai");
      const anthropicMetrics = await adapter.getMetrics("key-anthropic");

      expect(openAiMetrics).toEqual({
        rpm: 1,
        circuitBreakerTripped: false,
        costAccumulatedMicrodollars: 500_000n,
      });

      expect(anthropicMetrics).toEqual({
        rpm: 2,
        circuitBreakerTripped: true,
        costAccumulatedMicrodollars: 2_000_000n,
      });
    });
  });

  describe("6. Transaction Atomicity & Rollback Guarantees", () => {
    it("ensures ctx.storage.transaction() is invoked for all mutating operations", async () => {
      expect(mockStorage.transactionCalls).toBe(0);

      await adapter.incrementRPM("k");
      expect(mockStorage.transactionCalls).toBe(1);

      await adapter.updateCircuitBreaker("k", true);
      expect(mockStorage.transactionCalls).toBe(2);

      await adapter.addCost("k", 100n);
      expect(mockStorage.transactionCalls).toBe(3);

      // getMetrics does not mutate and does not need a transaction
      await adapter.getMetrics("k");
      expect(mockStorage.transactionCalls).toBe(3);
    });

    it("rolls back hot state mutations when transaction closure fails", async () => {
      // Initialize with baseline data
      await adapter.incrementRPM("k-rollback");
      await adapter.addCost("k-rollback", 100_000n);

      const baseline = await adapter.getMetrics("k-rollback");
      expect(baseline?.rpm).toBe(1);
      expect(baseline?.costAccumulatedMicrodollars).toBe(100_000n);

      // Mock storage.put to fail once during next transaction
      const originalPut = mockStorage.put.bind(mockStorage);
      let shouldFail = true;
      mockStorage.put = async (key: string, value: unknown) => {
        if (shouldFail && key === "metrics:k-rollback") {
          throw new Error("Durable Object storage I/O simulation failure");
        }
        return originalPut(key, value);
      };

      // Attempt incrementRPM which should fail and rollback
      await expect(adapter.incrementRPM("k-rollback")).rejects.toThrow(
        "Durable Object storage I/O simulation failure"
      );

      // Verify that the state was rolled back to baseline
      shouldFail = false;
      mockStorage.put = originalPut;

      const afterFailedTxn = await adapter.getMetrics("k-rollback");
      expect(afterFailedTxn?.rpm).toBe(1);
      expect(afterFailedTxn?.costAccumulatedMicrodollars).toBe(100_000n);
    });
  });

  describe("7. Storage Fallback (When storage.transaction is not available)", () => {
    it("falls back gracefully to direct storage calls if storage.transaction is undefined", async () => {
      const basicStore = new Map<string, unknown>();
      const simpleStorage = {
        get: async <T>(key: string) => basicStore.get(key) as T | undefined,
        put: async <T>(key: string, value: T) => {
          basicStore.set(key, value);
        },
      } as unknown as DurableObjectStorage;

      const fallbackAdapter = new DOStorageAdapter(simpleStorage);

      await fallbackAdapter.incrementRPM("simple-key");
      await fallbackAdapter.updateCircuitBreaker("simple-key", true);
      await fallbackAdapter.addCost("simple-key", 250_000n);

      const metrics = await fallbackAdapter.getMetrics("simple-key");
      expect(metrics).toEqual({
        rpm: 1,
        circuitBreakerTripped: true,
        costAccumulatedMicrodollars: 250_000n,
      });
    });
  });
});
