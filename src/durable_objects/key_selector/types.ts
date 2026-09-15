/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * KeySelector Types & Interfaces
 */

import { RoutingStrategy } from "../../types/config";
import { KeyStatus } from "../../types/models";
import type {
  CircuitBreaker,
  CircuitBreakerState,
  DurableObjectStorageLike,
} from "../circuit_breaker";
import type { RateLimiter } from "../rate_limiter";

/**
 * Common interface satisfied by both APIKey and EncryptedKey.
 * Allows KeySelector to operate generically across storage representations.
 */
export interface SelectableKey {
  id: string;
  provider: string;
  tenantId?: string;
  label?: string;
  priority?: number;
  status?: KeyStatus | string;
  rpmLimit?: number;
  rpdLimit?: number;
  circuitOpenUntil?: string | null;
  lastUsedAt?: string | number | null;
}

/**
 * Key selection strategy modes.
 */
export type KeySelectionStrategy =
  | "round-robin"
  | "least-used"
  | "load-balanced"
  | "priority"
  | "random"
  | RoutingStrategy;

/**
 * Options for configuring a KeySelector instance.
 */
export interface KeySelectorOptions<TKey extends SelectableKey = SelectableKey> {
  /** Optional tenant identifier for scoping and error reporting */
  tenantId?: string;
  /** Initial pool of keys */
  keys?: TKey[];
  /** Circuit breaker instance for health checks */
  circuitBreaker?: CircuitBreaker;
  /** Rate limiter instance for sliding window capacity checks */
  rateLimiter?: RateLimiter;
  /** Default selection strategy (defaults to "round-robin") */
  defaultStrategy?: KeySelectionStrategy;
  /** Optional DO transactional storage for persisting round-robin pointers */
  storage?: DurableObjectStorageLike;
  /** Prefix for storage keys in DO storage (defaults to "ks:") */
  storageKeyPrefix?: string;
  /** Injectable time provider for deterministic testing (defaults to Date.now) */
  timeProvider?: () => number;
}

/**
 * Options passed to selectKey() invocations.
 */
export interface SelectKeyOptions<TKey extends SelectableKey = SelectableKey> {
  /** Selection strategy override for this call */
  strategy?: KeySelectionStrategy;
  /** Estimated cost in microdollars to verify financial budget capacity */
  costMicrodollars?: bigint;
  /** Whether to throw KeyExhaustedError if no healthy keys are available (defaults to true) */
  throwOnExhausted?: boolean;
  /** Whether to fallback to any available healthy provider if preferred is exhausted */
  fallbackToAnyProvider?: boolean;
  /** Explicit candidate keys to select from, bypassing internal pool */
  candidateKeys?: TKey[];
}

/**
 * Detailed triage item for an individual key.
 */
export interface KeyTriageItem<TKey extends SelectableKey = SelectableKey> {
  key: TKey;
  healthy: boolean;
  reason?:
    | "healthy"
    | "disabled"
    | "invalid"
    | "exhausted"
    | "circuit_breaker_open"
    | "rate_limit_exceeded"
    | "budget_exceeded";
  retryAfterSeconds?: number;
  circuitOpenUntil?: string | null;
  circuitBreakerState?: CircuitBreakerState;
  currentRpm?: number;
  remainingRpm?: number;
}

/**
 * Comprehensive key triage result returned by triageKeys().
 */
export interface KeyTriageResult<TKey extends SelectableKey = SelectableKey> {
  provider?: string;
  totalKeys: number;
  healthyKeys: TKey[];
  unhealthyKeys: KeyTriageItem<TKey>[];
  rateLimitedKeys: KeyTriageItem<TKey>[];
  circuitBrokenKeys: KeyTriageItem<TKey>[];
  disabledKeys: KeyTriageItem<TKey>[];
  minRetryAfterSeconds: number;
}

/**
 * Capacity summary for a provider or the entire tenant pool.
 */
export interface CapacitySummary {
  provider?: string;
  totalKeys: number;
  healthyKeys: number;
  totalRpmLimit: number;
  currentRpm: number;
  remainingRpm: number;
  utilizationPercent: number;
}

/**
 * Type guard for SelectableKey.
 */
export function isSelectableKey(value: unknown): value is SelectableKey {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.provider === "string" &&
    candidate.id.trim().length > 0 &&
    candidate.provider.trim().length > 0
  );
}
