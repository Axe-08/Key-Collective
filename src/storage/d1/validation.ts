/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * D1 Storage Subsystem: Input Validation Guards & Mappers
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - No Plaintext Keys: Mapping strictly handles ciphertext & nonces.
 * - Per-Tenant Isolation: Tenant IDs validated as non-empty strings.
 * - Fixed-Point Microdollars: Cost microdollars validated as non-negative bigint.
 */

import type { EncryptedKey } from "../../contracts/key_pool";
import type { RawApiKeyRow } from "./types";

export function assertValidTenantId(tenantId: unknown): asserts tenantId is string {
  if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw new Error("Tenant ID must be a non-empty string");
  }
}

export function assertValidMicrodollars(cost: bigint): void {
  if (typeof cost !== "bigint") {
    throw new Error("Cost must be a bigint representing microdollars (zero floating-point)");
  }
  if (cost < 0n) {
    throw new Error("Cost microdollars cannot be negative");
  }
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Cost microdollars exceeds maximum safe integer range");
  }
}

export function mapRowToEncryptedKey(row: RawApiKeyRow, fallbackTenantId: string): EncryptedKey {
  return {
    id: row.id,
    tenantId: row.tenantId ?? row.tenant_id ?? fallbackTenantId,
    provider: row.provider,
    ciphertext: row.ciphertext ?? row.encrypted_key_b64 ?? "",
    nonce: row.nonce ?? row.nonce_b64 ?? "",
  };
}
