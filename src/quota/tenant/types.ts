/**
 * Key Collective v3 — Multi-Project, Anti-Sybil & Tiered Developer Platform
 * TenantQuotaDO Types & Interfaces
 */

import { UserTier } from "../../contracts/v3_types";
import type { DurableObjectStorageLike } from "../../durable_objects/circuit_breaker";

export type { DurableObjectStorageLike } from "../../durable_objects/circuit_breaker";

/**
 * Minimal interface for Cloudflare DurableObjectState.
 */
export interface DurableObjectStateLike {
  readonly id: {
    toString(): string;
    readonly name?: string;
  };
  readonly storage: DurableObjectStorageLike;
  waitUntil?(promise: Promise<unknown>): void;
  blockConcurrencyWhile?<T>(callback: () => Promise<T>): Promise<T>;
}

/**
 * Base DurableObject class compliant with Cloudflare Workers runtime
 * and test environments without cloudflare:workers package imports.
 */
export class DurableObject {
  protected readonly ctx: DurableObjectStateLike;
  protected readonly env: unknown;

  constructor(
    ctx: DurableObjectState | DurableObjectStateLike,
    env?: unknown
  ) {
    this.ctx = ctx as DurableObjectStateLike;
    this.env = env;
  }
}

/**
 * Individual timestamped counter entry in the sliding window.
 * Serializes costMicrodollars as string for safe JSON storage in DO transactional storage.
 */
export interface QuotaEntry {
  readonly timestamp: number;
  readonly count: number;
  readonly costMicrodollars: string;
  readonly projectId?: string;
}

/**
 * Persisted snapshot of TenantQuotaDO in DO transactional storage.
 */
export interface TenantQuotaData {
  readonly tenantId: string;
  readonly tier: UserTier;
  readonly entries: QuotaEntry[];
  readonly totalCostMicrodollars: string;

  readonly communityDebtMicroCu?: string;
  readonly dailyContributedCu?: string;
  readonly trustedContributor?: boolean;
  readonly consecutiveDebtFreeDays?: number;
  readonly multiplierCeiling?: number;
  readonly lastUpdated: number;
}

/**
 * Request payload for consuming quota.
 */
export interface ConsumeQuotaRequest {
  readonly tenantId?: string;
  readonly projectId?: string;
  readonly tier?: UserTier;
  readonly projectMaxSubCap?: number | null;
  readonly costMicrodollars?: bigint | number | string;
  readonly count?: number;
  readonly checkOnly?: boolean;
}

/**
 * Structured diagnostic result from a quota consumption evaluation.
 */
export interface ConsumeQuotaResult {
  readonly allowed: boolean;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly tier: UserTier;
  readonly currentRpm: number;
  readonly rpmLimit: number;
  readonly currentRpd: number;
  readonly rpdLimit: number;
  readonly currentProjectRpm?: number;
  readonly projectRpmLimit?: number;
  readonly totalCostMicrodollars: string;

  readonly communityDebtMicroCu?: string;
  readonly dailyContributedCu?: string;
  readonly trustedContributor?: boolean;
  readonly consecutiveDebtFreeDays?: number;
  readonly multiplierCeiling?: number;
  readonly remainingRpm: number;
  readonly remainingRpd: number;
  readonly retryAfterSeconds?: number;
  readonly retry_after_seconds?: number;
  readonly error?: string;
  readonly errorCode?: string;
  readonly error_code?: string;
}

/**
 * Configuration options for TenantQuotaDO initialization or testing.
 */
export interface TenantQuotaDOOptions {
  /** Explicit tenant ID override */
  readonly tenantId?: string;
  /** Default tier override (defaults to 'builder') */
  readonly initialTier?: UserTier;
  /** Sliding window duration in milliseconds for RPM (defaults to 60,000) */
  readonly rpmWindowMs?: number;
  /** Daily window duration in milliseconds for RPD (defaults to 86,400,000) */
  readonly rpdWindowMs?: number;
  /** Injectable time provider for deterministic testing */
  readonly timeProvider?: () => number;
}

/**
 * Safely converts an unknown cost representation to a bigint in int64 microdollars.
 * Guarantees zero floating-point math.
 */
export function toMicrodollars(cost: unknown): bigint {
  if (typeof cost === "bigint") {
    return cost;
  }
  if (typeof cost === "number") {
    return BigInt(Math.trunc(cost));
  }
  if (typeof cost === "string") {
    const trimmed = cost.trim();
    if (trimmed.length === 0) {
      return 0n;
    }
    try {
      return BigInt(trimmed);
    } catch {
      return 0n;
    }
  }
  return 0n;
}
