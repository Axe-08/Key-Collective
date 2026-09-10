/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * KeyPool — Per-Tenant Stateful Durable Object Pool
 *
 * Conforms to TASK-DOP-01 & LLD 3.4:
 * - Implements KeyPoolContract (getKey, recordUsage, recordResult) and DurableObject.
 * - Enforces Strict Per-Tenant DO Isolation (GEMINI.md Invariant):
 *   Each KeyPool instance owns exactly one tenant pool.
 *   Cross-tenant access triggers TenantIsolationError (HTTP 403).
 * - Fixed-Point Microdollars: All costs in int64/bigint microdollars (1 USD = 1,000,000 µ$). Zero floating-point math.
 * - No Plaintext Keys: Operates solely on EncryptedKey records (AES-256-GCM ciphertext + 12-byte nonce).
 * - DO Transactional Storage for Hot State: In-memory keys, circuit breaker, and RPM counters sync to this.ctx.storage.
 * - Non-Blocking Telemetry: Streams metrics to Cloudflare Workers Analytics Engine without blocking hot path.
 * - Full HTTP fetch RPC interface for Worker-to-DO routing.
 */

import {
  EncryptedKey,
  KeyMetrics,
} from "../contracts/key_pool";
import {
  DurableObjectStateLike,
  DurableObjectStorageLike,
  KeyPoolDO,
  KeyPoolDOEnv,
  KeyPoolDOOptions,
  isEncryptedKey,
} from "./key_pool_do";

/**
 * KeyPoolContract exact interface specification.
 */
export interface KeyPoolContract {
  getKey(provider: string): Promise<string>;
  recordUsage(keyId: string, costMicrodollars: bigint): Promise<void>;
  recordResult(keyId: string, success: boolean): Promise<void>;
}

/**
 * KeyPool — Stateful Per-Tenant Durable Object.
 * Implements KeyPoolContract and sets up this.ctx.storage access.
 */
export class KeyPool extends KeyPoolDO implements KeyPoolContract {
  public override readonly ctx: DurableObjectStateLike;

  constructor(
    ctx: DurableObjectState | DurableObjectStateLike,
    env?: KeyPoolDOEnv,
    options?: KeyPoolDOOptions
  ) {
    super(ctx, env, options);
    this.ctx = ctx as DurableObjectStateLike;
  }

  /**
   * Direct accessor for Durable Object transactional storage (this.ctx.storage).
   */
  public get storage(): DurableObjectStorageLike {
    return this.ctx.storage;
  }
}

// Re-export KeyPool as KeyPoolDO for drop-in compatibility
export { KeyPool as KeyPoolDO };

// Re-export contract types and supporting types
export type {
  EncryptedKey,
  KeyMetrics,
  KeyPoolDOEnv,
  KeyPoolDOOptions,
  DurableObjectStateLike,
  DurableObjectStorageLike,
};
export { isEncryptedKey };
