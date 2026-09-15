/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * D1 Storage Subsystem: API Key Operations
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - No Plaintext Keys: Only AES-256-GCM encrypted ciphertext + 12-byte nonces persisted.
 * - Per-Tenant Isolation: Strictly scopes all key lookups and mutations by tenantId.
 */

import type { EncryptedKey } from "../../contracts/key_pool";
import type { RawApiKeyRow } from "./types";
import { assertValidTenantId, mapRowToEncryptedKey } from "./validation";

export async function getKeysForTenant(db: D1Database, tenantId: string): Promise<EncryptedKey[]> {
  assertValidTenantId(tenantId);

  const query = `
    SELECT
      id,
      tenant_id,
      label,
      provider,
      encrypted_key_b64,
      nonce_b64,
      rpm_limit,
      rpd_limit,
      priority,
      status,
      circuit_open_until,
      last_used_at
    FROM api_keys
    WHERE tenant_id = ?
    ORDER BY priority DESC, created_at ASC
  `;

  const result = await db.prepare(query).bind(tenantId.trim()).all<RawApiKeyRow>();
  const rows = result.results ?? [];

  return rows.map((row) => mapRowToEncryptedKey(row, tenantId.trim()));
}

export async function getKeyById(
  db: D1Database,
  tenantId: string,
  keyId: string
): Promise<EncryptedKey | null> {
  assertValidTenantId(tenantId);
  if (!keyId || keyId.trim().length === 0) {
    throw new Error("Key ID cannot be empty");
  }

  const query = `
    SELECT
      id,
      tenant_id,
      label,
      provider,
      encrypted_key_b64,
      nonce_b64,
      rpm_limit,
      rpd_limit,
      priority,
      status,
      circuit_open_until,
      last_used_at
    FROM api_keys
    WHERE tenant_id = ? AND id = ?
    LIMIT 1
  `;

  const row = await db.prepare(query).bind(tenantId.trim(), keyId.trim()).first<RawApiKeyRow>();
  if (!row) {
    return null;
  }

  return mapRowToEncryptedKey(row, tenantId.trim());
}

export async function saveEncryptedKey(db: D1Database, key: EncryptedKey): Promise<void> {
  if (!key || typeof key !== "object") {
    throw new Error("Invalid key payload");
  }
  assertValidTenantId(key.tenantId);

  if (!key.id || key.id.trim().length === 0) {
    throw new Error("Key ID cannot be empty");
  }
  if (!key.provider || key.provider.trim().length === 0) {
    throw new Error("Provider cannot be empty");
  }
  if (!key.ciphertext || key.ciphertext.trim().length === 0) {
    throw new Error("Ciphertext cannot be empty");
  }
  if (!key.nonce || key.nonce.trim().length === 0) {
    throw new Error("Nonce cannot be empty");
  }

  const label = `${key.provider} Key`;
  const keyPrefix = "enc_";
  const keySuffix = "...";
  const rpmLimit = 60;
  const rpdLimit = 1500;
  const priority = 0;
  const status = "Healthy";
  const circuitOpenUntil = null;
  const lastUsedAt = null;

  const query = `
    INSERT INTO api_keys (
      id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
      key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status,
      circuit_open_until, last_used_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      label = excluded.label,
      provider = excluded.provider,
      encrypted_key_b64 = excluded.encrypted_key_b64,
      nonce_b64 = excluded.nonce_b64,
      key_prefix = excluded.key_prefix,
      key_suffix = excluded.key_suffix,
      rpm_limit = excluded.rpm_limit,
      rpd_limit = excluded.rpd_limit,
      priority = excluded.priority,
      status = excluded.status,
      circuit_open_until = excluded.circuit_open_until,
      last_used_at = excluded.last_used_at
  `;

  await db
    .prepare(query)
    .bind(
      key.id.trim(),
      key.tenantId.trim(),
      label,
      key.provider.trim(),
      key.ciphertext.trim(),
      key.nonce.trim(),
      keyPrefix,
      keySuffix,
      rpmLimit,
      rpdLimit,
      priority,
      status,
      circuitOpenUntil,
      lastUsedAt
    )
    .run();
}

export async function deleteKey(db: D1Database, tenantId: string, keyId: string): Promise<void> {
  assertValidTenantId(tenantId);
  if (!keyId || keyId.trim().length === 0) {
    throw new Error("Key ID cannot be empty");
  }

  const query = `DELETE FROM api_keys WHERE tenant_id = ? AND id = ?`;
  await db.prepare(query).bind(tenantId.trim(), keyId.trim()).run();
}
