/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Durable Objects Hot State Storage Adapter
 *
 * Conforms to LLD 2.2 & Invariants (GEMINI.md):
 * - TypeScript (strict mode, no `any`).
 * - DO Transactional Storage for Hot State: Abstract `this.ctx.storage` transactional
 *   interactions for hot state (circuit breaker, RPM counters, cost accumulation).
 * - Ensures atomic updates using `ctx.storage.transaction()`.
 * - Fixed-Point Microdollars: All costs in int64/bigint microdollars (1 USD = 1,000,000 µ$).
 *   Zero floating-point math for financials.
 */

import { KeyMetrics } from "../contracts/key_pool";
import { InvalidKeyError } from "../errors/key_errors";

/**
 * Storage prefix for key metrics records in Durable Object storage.
 */
const METRICS_KEY_PREFIX = "metrics:";

/**
 * Hot state metrics representation persisted in DO transactional storage.
 * Note: cost is serialized as string/bigint to ensure safe storage across all DO engines.
 */
export interface StoredMetrics {
  rpm: number;
  circuitBreakerTripped: boolean;
  costAccumulatedMicrodollars: string | bigint;
}

/**
 * DOStorageAdapter abstracts this.ctx.storage interactions for hot state.
 * Guarantees transactional atomicity for concurrent mutations.
 */
export class DOStorageAdapter {
  constructor(private storage: DurableObjectStorage) {}

  /**
   * Generates the storage key for a given keyId.
   */
  private getStorageKey(keyId: string): string {
    return `${METRICS_KEY_PREFIX}${keyId}`;
  }

  /**
   * Asserts that a keyId is valid (non-empty string).
   */
  private assertValidKeyId(keyId: string): void {
    if (!keyId || keyId.trim().length === 0) {
      throw new InvalidKeyError("Key ID cannot be empty");
    }
  }

  /**
   * Executes a callback within a DO storage transaction if available,
   * falling back gracefully to direct storage execution.
   */
  private async runTransaction<T>(
    closure: (txn: DurableObjectTransaction | DurableObjectStorage) => Promise<T>
  ): Promise<T> {
    if (typeof this.storage.transaction === "function") {
      return await this.storage.transaction(
        closure as (txn: DurableObjectTransaction) => Promise<T>
      );
    }
    return await closure(this.storage);
  }

  /**
   * Retrieves hot state metrics for a keyId.
   * Returns undefined if no metrics have been recorded yet.
   */
  async getMetrics(keyId: string): Promise<KeyMetrics | undefined> {
    this.assertValidKeyId(keyId);
    const storageKey = this.getStorageKey(keyId);
    const stored = await this.storage.get<StoredMetrics>(storageKey);

    if (!stored || typeof stored !== "object") {
      return undefined;
    }

    const rawCost = stored.costAccumulatedMicrodollars;
    const costAccumulatedMicrodollars =
      typeof rawCost === "bigint"
        ? rawCost
        : BigInt(rawCost ?? "0");

    return {
      rpm: typeof stored.rpm === "number" ? stored.rpm : 0,
      circuitBreakerTripped: Boolean(stored.circuitBreakerTripped),
      costAccumulatedMicrodollars,
    };
  }

  /**
   * Atomically increments the RPM (Requests Per Minute) counter for a key.
   */
  async incrementRPM(keyId: string): Promise<void> {
    this.assertValidKeyId(keyId);
    const storageKey = this.getStorageKey(keyId);

    await this.runTransaction(async (txn) => {
      const existing = await txn.get<StoredMetrics>(storageKey);
      const updated: StoredMetrics = {
        rpm: (existing?.rpm ?? 0) + 1,
        circuitBreakerTripped: Boolean(existing?.circuitBreakerTripped),
        costAccumulatedMicrodollars:
          existing?.costAccumulatedMicrodollars !== undefined
            ? existing.costAccumulatedMicrodollars
            : "0",
      };
      await txn.put(storageKey, updated);
    });
  }

  /**
   * Atomically updates the circuit breaker state (tripped boolean) for a key.
   */
  async updateCircuitBreaker(keyId: string, tripped: boolean): Promise<void> {
    this.assertValidKeyId(keyId);
    const storageKey = this.getStorageKey(keyId);

    await this.runTransaction(async (txn) => {
      const existing = await txn.get<StoredMetrics>(storageKey);
      const updated: StoredMetrics = {
        rpm: existing?.rpm ?? 0,
        circuitBreakerTripped: tripped,
        costAccumulatedMicrodollars:
          existing?.costAccumulatedMicrodollars !== undefined
            ? existing.costAccumulatedMicrodollars
            : "0",
      };
      await txn.put(storageKey, updated);
    });
  }

  /**
   * Atomically accumulates cost in fixed-point microdollars for a key.
   * Enforces zero floating-point math using bigint arithmetic.
   */
  async addCost(keyId: string, costMicrodollars: bigint): Promise<void> {
    this.assertValidKeyId(keyId);
    if (costMicrodollars < 0n) {
      throw new Error("Cost in microdollars cannot be negative");
    }

    const storageKey = this.getStorageKey(keyId);

    await this.runTransaction(async (txn) => {
      const existing = await txn.get<StoredMetrics>(storageKey);
      const currentCost =
        existing?.costAccumulatedMicrodollars !== undefined
          ? BigInt(existing.costAccumulatedMicrodollars)
          : 0n;

      const newCost = currentCost + costMicrodollars;

      const updated: StoredMetrics = {
        rpm: existing?.rpm ?? 0,
        circuitBreakerTripped: Boolean(existing?.circuitBreakerTripped),
        costAccumulatedMicrodollars: newCost.toString(),
      };
      await txn.put(storageKey, updated);
    });
  }
}
