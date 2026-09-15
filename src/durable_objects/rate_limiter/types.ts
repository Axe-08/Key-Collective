import type { DurableObjectStorageLike } from "../circuit_breaker";

export type { DurableObjectStorageLike } from "../circuit_breaker";

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
