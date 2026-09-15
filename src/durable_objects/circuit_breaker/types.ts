/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Circuit Breaker Subsystem: Types and Data Contracts
 *
 * Invariants (GEMINI.md Constitution):
 * - Strict TypeScript (no `any`).
 * - DO Transactional Storage for Hot State.
 * - Zero floating-point math.
 */

import type { CircuitBreakerConfig } from "../../types/config";

/**
 * Circuit breaker states conforming to standard state machine specification.
 */
export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export const CIRCUIT_BREAKER_STATES: readonly CircuitBreakerState[] = [
  "CLOSED",
  "OPEN",
  "HALF_OPEN",
] as const;

/**
 * Hot state persisted in DO transactional storage and cached in memory.
 */
export interface CircuitBreakerData {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  openedAt: number | null;
}

/**
 * Configuration options for the CircuitBreaker instance.
 */
export interface CircuitBreakerOptions {
  /** Optional key identifier if bound to a specific provider key */
  keyId?: string;
  /** Consecutive failures before tripping to OPEN (defaults to 3) */
  failureThreshold?: number;
  /** Cooldown duration in seconds before testing HALF_OPEN (defaults to 60s) */
  cooldownSeconds?: number;
  /** Successful probe requests in HALF_OPEN to close the circuit (defaults to 1) */
  halfOpenSuccessThreshold?: number;
  /** Upstream HTTP status codes considered failures (defaults to [429, 500, 502, 503, 504]) */
  trippingStatusCodes?: readonly number[] | number[];
  /** Storage key prefix in DO storage (defaults to "cb:") */
  storageKeyPrefix?: string;
  /** Injectable time provider for deterministic testing (defaults to Date.now) */
  timeProvider?: () => number;
}

/**
 * Minimal storage contract required by CircuitBreaker.
 * Satisfied natively by Cloudflare Workers DurableObjectStorage.
 */
export interface DurableObjectStorageLike {
  get<T = unknown>(
    key: string,
    options?: DurableObjectGetOptions
  ): Promise<T | undefined>;
  get<T = unknown>(
    keys: string[],
    options?: DurableObjectGetOptions
  ): Promise<Map<string, T>>;
  put<T>(
    key: string,
    value: T,
    options?: DurableObjectPutOptions
  ): Promise<void>;
  put<T>(
    entries: Record<string, T>,
    options?: DurableObjectPutOptions
  ): Promise<void>;
  delete?(
    key: string,
    options?: DurableObjectPutOptions
  ): Promise<boolean>;
  delete?(
    keys: string[],
    options?: DurableObjectPutOptions
  ): Promise<number>;
  deleteAll?(options?: DurableObjectPutOptions): Promise<void>;
  list?<T = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, T>>;
}

/**
 * Default initial circuit breaker data.
 */
export function createDefaultCircuitBreakerData(): CircuitBreakerData {
  return {
    state: "CLOSED",
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastFailureTime: null,
    lastSuccessTime: null,
    openedAt: null,
  };
}

/**
 * Type guard for CircuitBreakerState.
 */
export function isCircuitBreakerState(value: unknown): value is CircuitBreakerState {
  return (
    typeof value === "string" &&
    (CIRCUIT_BREAKER_STATES as readonly string[]).includes(value)
  );
}

/**
 * Type guard for CircuitBreakerData.
 */
export function isCircuitBreakerData(value: unknown): value is CircuitBreakerData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isCircuitBreakerState(candidate.state) &&
    typeof candidate.consecutiveFailures === "number" &&
    typeof candidate.consecutiveSuccesses === "number" &&
    (candidate.lastFailureTime === null || typeof candidate.lastFailureTime === "number") &&
    (candidate.lastSuccessTime === null || typeof candidate.lastSuccessTime === "number") &&
    (candidate.openedAt === null || typeof candidate.openedAt === "number")
  );
}
