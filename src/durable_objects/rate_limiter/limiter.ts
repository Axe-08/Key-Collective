import {
  DEFAULT_RETRY_AFTER_SECONDS,
  DEFAULT_RPD_LIMIT,
  DEFAULT_RPM_LIMIT,
  DEFAULT_WINDOW_SIZE_SECONDS,
} from "../../constants/limits";
import {
  QuotaExceededError,
  RateLimitExceededError,
} from "../../errors/key_errors";
import type { RateLimitConfig } from "../../types/config";
import type {
  DurableObjectStorageLike,
  RateLimiterData,
  RateLimiterOptions,
  RateLimitCheckResult,
  RateLimiterMetrics,
} from "./types";
import { ONE_DAY_SECONDS } from "./types";
import { createDefaultRateLimiterData, isRateLimiterData } from "./data";
import {
  pruneExpiredEntries,
  calculateRpm,
  calculateRpd,
  calculateRpmRetryAfter,
  calculateRpdRetryAfter,
} from "./window";

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
  public readonly maxBudgetCu?: bigint;
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
    this.maxBudgetCu = opts?.maxBudgetCu;
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
   * Helper to normalize overloaded arguments (keyId and costCu).
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
   */
  private prune(data: RateLimiterData): boolean {
    return pruneExpiredEntries(data, this.now(), this.dayWindowMs);
  }

  /**
   * Persists rate limiter state to DO transactional storage.
   */
  private async persist(keyId: string, data: RateLimiterData): Promise<void> {
    const storageKey = this.getStorageKey(keyId);
    await this.storage.put<RateLimiterData>(storageKey, {
      entries: [...data.entries],
      totalCostCu: data.totalCostCu,
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
          totalCostCu: stored.totalCostCu,
          lastRequestTime: stored.lastRequestTime,
        };
      } else {
        data = createDefaultRateLimiterData();
      }
      this.memory.set(id, data);
    }

    this.prune(data);
    return data;
  }

  /**
   * Synchronous getter for in-memory data (does not await storage).
   */
  public getDataSync(keyId?: string): RateLimiterData | undefined {
    const id = this.resolveKeyId(keyId);
    const data = this.memory.get(id);
    if (data) {
      this.prune(data);
      return data;
    }
    return undefined;
  }

  /**
   * Evaluates rate limit status with comprehensive diagnostics.
   */
  public async checkLimitDetailed(
    keyId?: string,
    costCu = 0n,
    limits?: { rpmLimit?: number; rpdLimit?: number }
  ): Promise<RateLimitCheckResult> {
    const data = await this.getData(keyId);
    const now = this.now();
    const currentRpm = calculateRpm(data, now, this.windowSizeMs);
    const currentRpd = calculateRpd(data, now, this.dayWindowMs);
    const accumulatedCost = BigInt(data.totalCostCu);
    const effectiveRpmLimit = limits?.rpmLimit ?? this.rpmLimit;
    const effectiveRpdLimit = limits?.rpdLimit ?? this.rpdLimit;

    // 1. Check RPM limit
    if (currentRpm >= effectiveRpmLimit) {
      const retryAfterSeconds = calculateRpmRetryAfter(data, now, this.windowSizeMs);
      return {
        allowed: false,
        currentRpm,
        rpmLimit: effectiveRpmLimit,
        currentRpd,
        rpdLimit: effectiveRpdLimit,
        costAccumulatedCu: accumulatedCost,
        maxBudgetCu: this.maxBudgetCu,
        retryAfterSeconds,
        reason: "rpm_limit_exceeded",
      };
    }

    // 2. Check RPD quota limit
    if (currentRpd >= effectiveRpdLimit) {
      const retryAfterSeconds = calculateRpdRetryAfter(data, now, this.dayWindowMs);
      return {
        allowed: false,
        currentRpm,
        rpmLimit: effectiveRpmLimit,
        currentRpd,
        rpdLimit: effectiveRpdLimit,
        costAccumulatedCu: accumulatedCost,
        maxBudgetCu: this.maxBudgetCu,
        retryAfterSeconds,
        reason: "rpd_limit_exceeded",
      };
    }

    // 3. Check optional financial budget limit
    if (this.maxBudgetCu !== undefined) {
      if (accumulatedCost + costCu > this.maxBudgetCu) {
        return {
          allowed: false,
          currentRpm,
          rpmLimit: effectiveRpmLimit,
          currentRpd,
          rpdLimit: effectiveRpdLimit,
          costAccumulatedCu: accumulatedCost,
          maxBudgetCu: this.maxBudgetCu,
          retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
          reason: "budget_exceeded",
        };
      }
    }

    return {
      allowed: true,
      currentRpm,
      rpmLimit: effectiveRpmLimit,
      currentRpd,
      rpdLimit: effectiveRpdLimit,
      costAccumulatedCu: accumulatedCost,
      maxBudgetCu: this.maxBudgetCu,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Contract method: checkLimit(costCu) (LLD 3.2)
   */
  public async checkLimit(costCu?: bigint): Promise<boolean>;
  public async checkLimit(keyId?: string, costCu?: bigint): Promise<boolean>;
  public async checkLimit(arg1?: string | bigint, arg2?: bigint): Promise<boolean> {
    const { keyId, cost } = this.resolveArgs(arg1, arg2);
    const result = await this.checkLimitDetailed(keyId, cost);
    return result.allowed;
  }

  /**
   * Synchronous check from in-memory cache.
   */
  public checkLimitSync(costCu?: bigint): boolean;
  public checkLimitSync(
    keyId?: string,
    costCu?: bigint,
    limits?: { rpmLimit?: number; rpdLimit?: number }
  ): boolean;
  public checkLimitSync(
    arg1?: string | bigint,
    arg2?: bigint,
    limits?: { rpmLimit?: number; rpdLimit?: number }
  ): boolean {
    const { keyId, cost } = this.resolveArgs(arg1, arg2);
    const data = this.getDataSync(keyId);
    if (!data) {
      return true; // Not loaded yet, assume allowed
    }

    const effectiveRpmLimit = limits?.rpmLimit ?? this.rpmLimit;
    const effectiveRpdLimit = limits?.rpdLimit ?? this.rpdLimit;

    const now = this.now();
    const currentRpm = calculateRpm(data, now, this.windowSizeMs);
    if (currentRpm >= effectiveRpmLimit) {
      return false;
    }

    const currentRpd = calculateRpd(data, now, this.dayWindowMs);
    if (currentRpd >= effectiveRpdLimit) {
      return false;
    }

    if (this.maxBudgetCu !== undefined) {
      const accumulatedCost = BigInt(data.totalCostCu);
      if (accumulatedCost + cost > this.maxBudgetCu) {
        return false;
      }
    }

    return true;
  }

  /**
   * Contract method: increment(costCu) (LLD 3.2)
   */
  public async increment(costCu?: bigint): Promise<void>;
  public async increment(keyId?: string, costCu?: bigint): Promise<void>;
  public async increment(arg1?: string | bigint, arg2?: bigint): Promise<void> {
    const { keyId, cost } = this.resolveArgs(arg1, arg2);
    const id = this.resolveKeyId(keyId);
    const data = await this.getData(id);
    const currentTime = this.now();

    data.lastRequestTime = currentTime;

    // Accumulate total spend in fixed-point credit units
    const previousCost = BigInt(data.totalCostCu);
    data.totalCostCu = (previousCost + cost).toString();

    // Append or merge into existing entry if exact same millisecond
    const lastEntry = data.entries[data.entries.length - 1];
    if (lastEntry && lastEntry.timestamp === currentTime) {
      lastEntry.count += 1;
      const prevEntryCost = BigInt(lastEntry.costCu);
      lastEntry.costCu = (prevEntryCost + cost).toString();
    } else {
      data.entries.push({
        timestamp: currentTime,
        count: 1,
        costCu: cost.toString(),
      });
    }

    // Prune entries older than 24 hours
    this.prune(data);

    this.memory.set(id, data);
    await this.persist(id, data);
  }

  /**
   * Adds cost to a key's accumulated total without incrementing the request count.
   * Used during lease settlement when the request count was already incremented at lease acquisition.
   */
  public async recordCostOnly(keyId: string, costCu: bigint): Promise<void> {
    if (costCu <= 0n) return;
    const id = this.resolveKeyId(keyId);
    const data = await this.getData(id);
    const previousCost = BigInt(data.totalCostCu);
    data.totalCostCu = (previousCost + costCu).toString();
    const lastEntry = data.entries[data.entries.length - 1];
    if (lastEntry) {
      const prevEntryCost = BigInt(lastEntry.costCu);
      lastEntry.costCu = (prevEntryCost + costCu).toString();
    }
    this.memory.set(id, data);
    await this.persist(id, data);
  }

  /**
   * Asserts request is within limits; throws RateLimitExceededError or QuotaExceededError if not.
   */
  public async throwIfExceeded(
    keyId?: string,
    costCu = 0n
  ): Promise<void> {
    const result = await this.checkLimitDetailed(keyId, costCu);
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
            limit: result.maxBudgetCu,
            consumed: result.costAccumulatedCu,
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
    return calculateRpm(data, this.now(), this.windowSizeMs);
  }

  /**
   * Returns current RPD count for target key.
   */
  public async getCurrentRpd(keyId?: string): Promise<number> {
    const data = await this.getData(keyId);
    return calculateRpd(data, this.now(), this.dayWindowMs);
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
   * Returns accumulated cost in credit units.
   */
  public async getAccumulatedCost(keyId?: string): Promise<bigint> {
    const data = await this.getData(keyId);
    return BigInt(data.totalCostCu);
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
    const now = this.now();
    const rpm = calculateRpm(data, now, this.windowSizeMs);
    const rpd = calculateRpd(data, now, this.dayWindowMs);
    const cost = BigInt(data.totalCostCu);
    const remainingRpm = Math.max(0, this.rpmLimit - rpm);
    const remainingRpd = Math.max(0, this.rpdLimit - rpd);
    const isRateLimited = rpm >= this.rpmLimit || rpd >= this.rpdLimit;
    const retryAfter = isRateLimited
      ? rpm >= this.rpmLimit
        ? calculateRpmRetryAfter(data, now, this.windowSizeMs)
        : calculateRpdRetryAfter(data, now, this.dayWindowMs)
      : 0;

    return {
      rpm,
      rpd,
      costAccumulatedCu: cost,
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
