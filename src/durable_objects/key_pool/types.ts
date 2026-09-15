/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * KeyPoolDO Types & Interfaces
 */

import { EncryptedKey } from "../../contracts/key_pool";
import { TelemetryContract } from "../../contracts/telemetry";
import { CircuitBreaker, DurableObjectStorageLike } from "../circuit_breaker";
import { KeySelector } from "../key_selector";
import { RateLimiter } from "../rate_limiter";

export type { DurableObjectStorageLike } from "../circuit_breaker";

/**
 * Environment bindings accessible inside KeyPoolDO.
 */
export interface KeyPoolDOEnv {
  KEY_POOL?: DurableObjectNamespace;
  DB?: D1Database;
  TELEMETRY?: AnalyticsEngineDataset;
  [key: string]: unknown;
}

/**
 * Configuration options for KeyPoolDO instantiation or testing.
 */
export interface KeyPoolDOOptions {
  /** Explicit tenant ID override */
  tenantId?: string;
  /** Initial pool of encrypted keys */
  keys?: EncryptedKey[];
  /** Optional injectable CircuitBreaker */
  circuitBreaker?: CircuitBreaker;
  /** Optional injectable RateLimiter */
  rateLimiter?: RateLimiter;
  /** Optional injectable KeySelector */
  keySelector?: KeySelector<EncryptedKey>;
  /** Optional injectable TelemetryContract */
  telemetryEmitter?: TelemetryContract;
  /** Injectable time provider for deterministic testing */
  timeProvider?: () => number;
}

/**
 * Minimal state required from Cloudflare DurableObjectState.
 */
export interface DurableObjectStateLike {
  readonly id: {
    toString(): string;
    readonly name?: string;
  };
  readonly storage: DurableObjectStorageLike;
  waitUntil(promise: Promise<unknown>): void;
  blockConcurrencyWhile?<T>(callback: () => Promise<T>): Promise<T>;
}

/**
 * Type guard for EncryptedKey.
 */
export function isEncryptedKey(value: unknown): value is EncryptedKey {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    typeof candidate.provider === "string" &&
    candidate.provider.trim().length > 0 &&
    typeof candidate.ciphertext === "string" &&
    candidate.ciphertext.trim().length > 0 &&
    typeof candidate.nonce === "string" &&
    candidate.nonce.trim().length > 0
  );
}
