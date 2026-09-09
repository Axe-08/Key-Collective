/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * RateLimiter Sliding-Window Counters for Cloudflare Durable Objects
 *
 * Conforms to LLD 3.2:
 * - Counters: Sliding-window for RPM (Requests Per Minute) and RPD (Requests Per Day).
 * - Storage: Updates and syncs request counts in DO storage (survives DO eviction).
 * - Contract: checkLimit(costMicrodollars), increment(costMicrodollars).
 * - Multi-key isolation: Supports per-key and pooled limit tracking within tenant DO.
 *
 * Invariants (GEMINI.md):
 * - Strict TypeScript (strict mode, no `any`).
 * - Per-Tenant DO Isolation: Zero cross-tenant state.
 * - Fixed-Point Microdollars: All costs in `int64` / `bigint` microdollars (1 USD = 1,000,000 µ$). Zero floating-point math.
 * - DO Transactional Storage for Hot State: In-memory sliding counters sync to `this.ctx.storage`.
 */

import {
  DEFAULT_RETRY_AFTER_SECONDS,
  DEFAULT_RPD_LIMIT,
  DEFAULT_RPM_LIMIT,
  DEFAULT_WINDOW_SIZE_SECONDS,
} from "../constants/limits";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "../errors/key_errors";
import { RateLimitConfig } from "../types/config";
import type { DurableObjectStorageLike } from "./circuit_breaker";

export type { DurableObjectStorageLike } from "./circuit_breaker";

/**
 * Milliseconds in one standard 24-hour day window.
 */
export const ONE_DAY_MS = 86_400_000 as const;

/**
 * Seconds in one standard 24-hour day window.
 */
export const ONE_DAY_SECONDS = 86_400 as const;

/**
 * Individual timestamped counter entry in the sliding window.
 * Stores costMicrodollars as string to guarantee safe JSON serialization in DO storage.
 */
export interface RateLimitEntry {
  timestamp: number;
  count: number;
  costMicrodollars: string;
}

/**
 * Hot state persisted in DO transactional storage and cached in memory.
 */
export interface RateLimiterData {
  entries: RateLimitEntry[];
  totalCostMicrodollars: string;
  lastRequestTime: number | null;
}

/**
 * Configuration options for the RateLimiter instance.
 */
export interface RateLimiterOptions {
  /** Optional tenant identifier for error attribution */
  tenantId?: string;
  /** Optional default key identifier (defaults to "default") */
  keyId?: string;
  /** Maximum requests per minute (defaults to 60) */
  rpmLimit?: number;
  /** Maximum requests per day (defaults to 1500) */
  rpdLimit?: number;
  /** Sliding window duration in seconds for RPM (defaults to 60) */
  windowSizeSeconds?: number;
  /** Daily window duration in seconds for RPD (defaults to 86,400) */
  dayWindowSeconds?: number;
  /** Optional spending ceiling in fixed-point microdollars */
  maxBudgetMicrodollars?: bigint;
  /** Storage key prefix in DO storage (defaults to "rl:") */
  storageKeyPrefix?: string;
  /** Injectable time provider for deterministic testing (defaults to Date.now) */
  timeProvider?: () => number;
}

/**
 * Structured diagnostic result from a detailed rate limit check.
 */
export interface RateLimitCheckResult {
  allowed: boolean;
  currentRpm: number;
  rpmLimit: number;
  currentRpd: number;
  rpdLimit: number;
  costAccumulatedMicrodollars: bigint;
  maxBudgetMicrodollars?: bigint;
  retryAfterSeconds: number;
  reason?: "rpm_limit_exceeded" | "rpd_limit_exceeded" | "budget_exceeded";
}

/**
 * Comprehensive metrics snapshot for a key or tenant pool.
 */
export interface RateLimiterMetrics {
  rpm: number;
  rpd: number;
  costAccumulatedMicrodollars: bigint;
  remainingRpm: number;
  remainingRpd: number;
  isRateLimited: boolean;
  retryAfterSeconds: number;
}

/**
 * Factory for initial rate limiter data.
 */
export function createDefaultRateLimiterData(): RateLimiterData {
  return {
    entries: [],
    totalCostMicrodollars: "0",
    lastRequestTime: null,
  };
}

/**
 * Type guard for RateLimitEntry.
 */
export function isRateLimitEntry(value: unknown): value is RateLimitEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.timestamp === "number" &&
    typeof candidate.count === "number" &&
    typeof candidate.costMicrodollars === "string"
  );
}

/**
 * Type guard for RateLimiterData.
 */
export function isRateLimiterData(value: unknown): value is RateLimiterData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.entries) &&
    candidate.entries.every(isRateLimitEntry) &&
    typeof candidate.totalCostMicrodollars === "string" &&
    (candidate.lastRequestTime === null || typeof candidate.lastRequestTime === "number")
  );
}

/**
 * RateLimiter implementation with DO transactional storage persistence.
 * Tracks sliding-window RPM and RPD counters with zero floating-point math.
 */
export class RateLimiter {
  private readonly storage: DurableObjectStorageLike;
  public readonly tenantId?: string;
  private readonly defaultKeyId: string;
  public readonly rpmLimit: number;
  public readonly rpdLimit: number;
  public readonly windowSizeSeconds: number;
  public readonly windowSizeMs: number;
  public readonly dayWindowSeconds: number;
  public readonly dayWindowMs: number;
  public readonly maxBudgetMicrodollars?: bigint;
  private readonly storageKeyPrefix: string;
  private readonly timeProvider: () => number;

  /**
   * In-memory cache of rate limiter data per keyId.
   * Synced to `storage` on every mutation to survive DO instance eviction.
   */
  private readonly memory = new Map<string, RateLimiterData>();

  constructor(
    storage: DurableObjectStorageLike,
    options?: RateLimiterOptions | Partial<RateLimitConfig>
  ) {
    this.storage = storage;
    const opts = options as RateLimiterOptions | undefined;
    const configOpts = options as Partial<RateLimitConfig> | undefined;

    this.tenantId = opts?.tenantId;
    this.defaultKeyId = opts?.keyId ?? "default";
    this.rpmLimit =
      opts?.rpmLimit ?? configOpts?.defaultRpmLimit ?? DEFAULT_RPM_LIMIT;
    this.rpdLimit =
      opts?.rpdLimit ?? configOpts?.defaultRpdLimit ?? DEFAULT_RPD_LIMIT;
    this.windowSizeSeconds =
      opts?.windowSizeSeconds ??
      configOpts?.windowSizeSeconds ??
      DEFAULT_WINDOW_SIZE_SECONDS;
    this.windowSizeMs = this.windowSizeSeconds * 1000;
    this.dayWindowSeconds = opts?.dayWindowSeconds ?? ONE_DAY_SECONDS;
    this.dayWindowMs = this.dayWindowSeconds * 1000;
    this.maxBudgetMicrodollars = opts?.maxBudgetMicrodollars;
    this.storageKeyPrefix = opts?.storageKeyPrefix ?? "rl:";
    this.timeProvider = opts?.timeProvider ?? (() => Date.now());
  }

  /**
   * Returns current timestamp in milliseconds.
   */
  private now(): number {
    return this.timeProvider();
  }

  /**
   * Resolves storage key for a specific keyId.
   */
  public getStorageKey(keyId?: string): string {
    const id = keyId ?? this.defaultKeyId;
    return `${this.storageKeyPrefix}${id}`;
  }

  /**
   * Resolves keyId fallback.
   */
  private resolveKeyId(keyId?: string): string {
    return keyId ?? this.defaultKeyId;
  }

  /**
   * Helper to normalize overloaded arguments (keyId and costMicrodollars).
   */
  private resolveArgs(
    arg1?: string | bigint,
    arg2?: bigint
  ): { keyId?: string; cost: bigint } {
    let keyId: string | undefined;
    let cost = 0n;

    if (typeof arg1 === "string") {
      keyId = arg1;
      cost = arg2 ?? 0n;
    } else if (typeof arg1 === "bigint") {
      keyId = undefined;
      cost = arg1;
    } else if (typeof arg2 === "bigint") {
      keyId = undefined;
      cost = arg2;
    }

    return { keyId, cost };
  }

  /**
   * Prunes entries older than the day window (24 hours).
   * Returns true if any entries were removed.
   */
  private pruneExpiredEntries(data: RateLimiterData): boolean {
    const cutoff = this.now() - this.dayWindowMs;
    const originalLength = data.entries.length;
    data.entries = data.entries.filter((entry) => entry.timestamp > cutoff);
    return data.entries.length !== originalLength;
  }

  /**
   * Persists rate limiter state to DO transactional storage.
   */
  private async persist(keyId: string, data: RateLimiterData): Promise<void> {
    const storageKey = this.getStorageKey(keyId);
    await this.storage.put<RateLimiterData>(storageKey, {
      entries: [...data.entries],
      totalCostMicrodollars: data.totalCostMicrodollars,
      lastRequestTime: data.lastRequestTime,
    });
  }

  /**
   * Loads rate limiter data from memory cache or DO storage.
   */
  public async getData(keyId?: string): Promise<RateLimiterData> {
    const id = this.resolveKeyId(keyId);
    let data = this.memory.get(id);

    if (!data) {
      const storageKey = this.getStorageKey(id);
      const stored = await this.storage.get<RateLimiterData>(storageKey);

      if (stored && isRateLimiterData(stored)) {
        data = {
          entries: [...stored.entries],
          totalCostMicrodollars: stored.totalCostMicrodollars,
          lastRequestTime: stored.lastRequestTime,
        };
      } else {
        data = createDefaultRateLimiterData();
      }
      this.memory.set(id, data);
    }

    this.pruneExpiredEntries(data);
    return data;
  }

  /**
   * Synchronous getter for in-memory data (does not await storage).
   */
  public getDataSync(keyId?: string): RateLimiterData | undefined {
    const id = this.resolveKeyId(keyId);
    const data = this.memory.get(id);
    if (data) {
      this.pruneExpiredEntries(data);
      return data;
    }
    return undefined;
  }

  /**
   * Calculates current RPM from in-memory entries within sliding window.
   */
  private calculateRpm(data: RateLimiterData): number {
    const cutoff = this.now() - this.windowSizeMs;
    let count = 0;
    for (let i = data.entries.length - 1; i >= 0; i--) {
      const entry = data.entries[i];
      if (entry && entry.timestamp > cutoff) {
        count += entry.count;
      } else {
        break; // Entries are appended chronologically
      }
    }
    return count;
  }

  /**
   * Calculates current RPD from in-memory entries within daily window.
   */
  private calculateRpd(data: RateLimiterData): number {
    const cutoff = this.now() - this.dayWindowMs;
    let count = 0;
    for (let i = 0; i < data.entries.length; i++) {
      const entry = data.entries[i];
      if (entry && entry.timestamp > cutoff) {
        count += entry.count;
      }
    }
    return count;
  }

  /**
   * Calculates seconds until the oldest request in the current RPM window slides out.
   */
  private calculateRpmRetryAfter(data: RateLimiterData): number {
    const cutoff = this.now() - this.windowSizeMs;
    // Find the oldest entry still inside the RPM window
    for (let i = 0; i < data.entries.length; i++) {
      const entry = data.entries[i];
      if (entry && entry.timestamp > cutoff) {
        const remainingMs = entry.timestamp + this.windowSizeMs - this.now();
        return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 1;
      }
    }
    return DEFAULT_RETRY_AFTER_SECONDS;
  }

  /**
   * Calculates seconds until the oldest request in the daily window slides out.
   */
  private calculateRpdRetryAfter(data: RateLimiterData): number {
    const cutoff = this.now() - this.dayWindowMs;
    for (let i = 0; i < data.entries.length; i++) {
      const entry = data.entries[i];
      if (entry && entry.timestamp > cutoff) {
        const remainingMs = entry.timestamp + this.dayWindowMs - this.now();
        return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 1;
      }
    }
    return DEFAULT_RETRY_AFTER_SECONDS;
  }

  /**
   * Evaluates rate limit status with comprehensive diagnostics.
   */
  public async checkLimitDetailed(
    keyId?: string,
    costMicrodollars = 0n
  ): Promise<RateLimitCheckResult> {
    const data = await this.getData(keyId);
    const currentRpm = this.calculateRpm(data);
    const currentRpd = this.calculateRpd(data);
    const accumulatedCost = BigInt(data.totalCostMicrodollars);

    // 1. Check RPM limit
    if (currentRpm >= this.rpmLimit) {
      const retryAfterSeconds = this.calculateRpmRetryAfter(data);
      return {
        allowed: false,
        currentRpm,
        rpmLimit: this.rpmLimit,
        currentRpd,
        rpdLimit: this.rpdLimit,
        costAccumulatedMicrodollars: accumulatedCost,
        maxBudgetMicrodollars: this.maxBudgetMicrodollars,
        retryAfterSeconds,
        reason: "rpm_limit_exceeded",
      };
    }

    // 2. Check RPD quota limit
    if (currentRpd >= this.rpdLimit) {
      const retryAfterSeconds = this.calculateRpdRetryAfter(data);
      return {
        allowed: false,
        currentRpm,
        rpmLimit: this.rpmLimit,
        currentRpd,
        rpdLimit: this.rpdLimit,
        costAccumulatedMicrodollars: accumulatedCost,
        maxBudgetMicrodollars: this.maxBudgetMicrodollars,
        retryAfterSeconds,
        reason: "rpd_limit_exceeded",
      };
    }

    // 3. Check optional financial budget limit
    if (this.maxBudgetMicrodollars !== undefined) {
      if (accumulatedCost + costMicrodollars > this.maxBudgetMicrodollars) {
        return {
          allowed: false,
          currentRpm,
          rpmLimit: this.rpmLimit,
          currentRpd,
          rpdLimit: this.rpdLimit,
          costAccumulatedMicrodollars: accumulatedCost,
          maxBudgetMicrodollars: this.maxBudgetMicrodollars,
          retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
          reason: "budget_exceeded",
        };
      }
    }

    return {
      allowed: true,
      currentRpm,
      rpmLimit: this.rpmLimit,
      currentRpd,
      rpdLimit: this.rpdLimit,
      costAccumulatedMicrodollars: accumulatedCost,
      maxBudgetMicrodollars: this.maxBudgetMicrodollars,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Contract method: checkLimit(costMicrodollars) (LLD 3.2)
   * Determines if a request is permitted under RPM, RPD, and financial budget limits.
   *
   * Overloaded to accept:
   * - checkLimit(costMicrodollars?: bigint): Promise<boolean>
   * - checkLimit(keyId: string, costMicrodollars?: bigint): Promise<boolean>
   */
  public async checkLimit(costMicrodollars?: bigint): Promise<boolean>;
  public async checkLimit(keyId?: string, costMicrodollars?: bigint): Promise<boolean>;
  public async checkLimit(arg1?: string | bigint, arg2?: bigint): Promise<boolean> {
    const { keyId, cost } = this.resolveArgs(arg1, arg2);
    const result = await this.checkLimitDetailed(keyId, cost);
    return result.allowed;
  }

  /**
   * Synchronous check from in-memory cache (returns true if within limit, false if exceeded).
   */
  public checkLimitSync(costMicrodollars?: bigint): boolean;
  public checkLimitSync(keyId?: string, costMicrodollars?: bigint): boolean;
  public checkLimitSync(arg1?: string | bigint, arg2?: bigint): boolean {
    const { keyId, cost } = this.resolveArgs(arg1, arg2);
    const data = this.getDataSync(keyId);
    if (!data) {
      return true; // Not loaded yet, assume allowed
    }

    const currentRpm = this.calculateRpm(data);
    if (currentRpm >= this.rpmLimit) {
      return false;
    }

    const currentRpd = this.calculateRpd(data);
    if (currentRpd >= this.rpdLimit) {
      return false;
    }

    if (this.maxBudgetMicrodollars !== undefined) {
      const accumulatedCost = BigInt(data.totalCostMicrodollars);
      if (accumulatedCost + cost > this.maxBudgetMicrodollars) {
        return false;
      }
    }

    return true;
  }

  /**
   * Contract method: increment(costMicrodollars) (LLD 3.2)
   * Records request admission and cost, updating sliding window counters and DO storage.
   *
   * Overloaded to accept:
   * - increment(costMicrodollars?: bigint): Promise<void>
   * - increment(keyId: string, costMicrodollars?: bigint): Promise<void>
   */
  public async increment(costMicrodollars?: bigint): Promise<void>;
  public async increment(keyId?: string, costMicrodollars?: bigint): Promise<void>;
  public async increment(arg1?: string | bigint, arg2?: bigint): Promise<void> {
    const { keyId, cost } = this.resolveArgs(arg1, arg2);
    const id = this.resolveKeyId(keyId);
    const data = await this.getData(id);
    const currentTime = this.now();

    data.lastRequestTime = currentTime;

    // Accumulate total spend in fixed-point microdollars
    const previousCost = BigInt(data.totalCostMicrodollars);
    data.totalCostMicrodollars = (previousCost + cost).toString();

    // Append or merge into existing entry if exact same millisecond
    const lastEntry = data.entries[data.entries.length - 1];
    if (lastEntry && lastEntry.timestamp === currentTime) {
      lastEntry.count += 1;
      const prevEntryCost = BigInt(lastEntry.costMicrodollars);
      lastEntry.costMicrodollars = (prevEntryCost + cost).toString();
    } else {
      data.entries.push({
        timestamp: currentTime,
        count: 1,
        costMicrodollars: cost.toString(),
      });
    }

    // Prune entries older than 24 hours
    this.pruneExpiredEntries(data);

    this.memory.set(id, data);
    await this.persist(id, data);
  }

  /**
   * Asserts request is within limits; throws RateLimitExceededError or QuotaExceededError if not.
   */
  public async throwIfExceeded(
    keyId?: string,
    costMicrodollars = 0n
  ): Promise<void> {
    const result = await this.checkLimitDetailed(keyId, costMicrodollars);
    if (!result.allowed) {
      const id = this.resolveKeyId(keyId);

      if (result.reason === "rpm_limit_exceeded") {
        throw new RateLimitExceededError(
          `Rate limit exceeded for key '${id}': RPM limit reached (${result.currentRpm}/${result.rpmLimit})`,
          {
            tenantId: this.tenantId,
            keyId: id,
            rpmLimit: result.rpmLimit,
            currentRpm: result.currentRpm,
            retryAfterSeconds: result.retryAfterSeconds,
          }
        );
      }

      if (result.reason === "rpd_limit_exceeded") {
        throw new QuotaExceededError(
          `Daily quota exceeded for key '${id}': RPD limit reached (${result.currentRpd}/${result.rpdLimit})`,
          {
            tenantId: this.tenantId ?? "default",
            quotaType: "rpd",
            limit: result.rpdLimit,
            consumed: result.currentRpd,
          }
        );
      }

      if (result.reason === "budget_exceeded") {
        throw new QuotaExceededError(
          `Financial budget ceiling exceeded for key '${id}'`,
          {
            tenantId: this.tenantId ?? "default",
            quotaType: "spend_limit",
            limit: result.maxBudgetMicrodollars,
            consumed: result.costAccumulatedMicrodollars,
          }
        );
      }
    }
  }

  /**
   * Returns current RPM count for target key.
   */
  public async getCurrentRpm(keyId?: string): Promise<number> {
    const data = await this.getData(keyId);
    return this.calculateRpm(data);
  }

  /**
   * Returns current RPD count for target key.
   */
  public async getCurrentRpd(keyId?: string): Promise<number> {
    const data = await this.getData(keyId);
    return this.calculateRpd(data);
  }

  /**
   * Returns remaining RPM headroom.
   */
  public async getRemainingRpm(keyId?: string): Promise<number> {
    const current = await this.getCurrentRpm(keyId);
    return Math.max(0, this.rpmLimit - current);
  }

  /**
   * Returns remaining RPD headroom.
   */
  public async getRemainingRpd(keyId?: string): Promise<number> {
    const current = await this.getCurrentRpd(keyId);
    return Math.max(0, this.rpdLimit - current);
  }

  /**
   * Returns accumulated cost in microdollars.
   */
  public async getAccumulatedCost(keyId?: string): Promise<bigint> {
    const data = await this.getData(keyId);
    return BigInt(data.totalCostMicrodollars);
  }

  /**
   * Returns seconds to wait before retrying (0 if not rate limited).
   */
  public async getRetryAfterSeconds(keyId?: string): Promise<number> {
    const result = await this.checkLimitDetailed(keyId);
    return result.retryAfterSeconds;
  }

  /**
   * Returns comprehensive rate limiter metrics.
   */
  public async getMetrics(keyId?: string): Promise<RateLimiterMetrics> {
    const data = await this.getData(keyId);
    const rpm = this.calculateRpm(data);
    const rpd = this.calculateRpd(data);
    const cost = BigInt(data.totalCostMicrodollars);
    const remainingRpm = Math.max(0, this.rpmLimit - rpm);
    const remainingRpd = Math.max(0, this.rpdLimit - rpd);
    const isRateLimited = rpm >= this.rpmLimit || rpd >= this.rpdLimit;
    const retryAfter = isRateLimited
      ? rpm >= this.rpmLimit
        ? this.calculateRpmRetryAfter(data)
        : this.calculateRpdRetryAfter(data)
      : 0;

    return {
      rpm,
      rpd,
      costAccumulatedMicrodollars: cost,
      remainingRpm,
      remainingRpd,
      isRateLimited,
      retryAfterSeconds: retryAfter,
    };
  }

  /**
   * Resets rate limiter counters and persisted state for a key.
   */
  public async reset(keyId?: string): Promise<void> {
    const id = this.resolveKeyId(keyId);
    const data = createDefaultRateLimiterData();

    this.memory.set(id, data);
    await this.persist(id, data);
  }

  /**
   * Clears in-memory cache to simulate DO instance eviction.
   */
  public clearMemoryCache(): void {
    this.memory.clear();
  }
}
