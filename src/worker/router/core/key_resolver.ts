/**
 * Key Collective v2/v4 — Upstream Key Decryption & Resolution (WP-4.4)
 *
 * Implements strict tenant key derivation and lazy HKDF migration (AC-07):
 * - Row is loaded from D1 by lease.keyId.
 * - Asserts row.tenant_id === lease.ownerTenantId (zero cross-tenant fallback).
 * - Decrypts with deriveTenantKey(master, row.tenant_id) only.
 * - Lazy HKDF migration: if hkdf_migrated=0, decrypts via legacy global key once,
 *   re-encrypts with tenant subkey, updates D1 (hkdf_migrated=1) atomically.
 * - Failure -> KeyDecryptionError, key marked QUARANTINED in D1, alert logged.
 * - Raw key fast-path and caller/default fallbacks are deleted.
 * - In-memory cache keyed by keyId:nonce with 5-minute TTL.
 * - evict(keyId) invalidates cached entries for a key.
 */

import { deriveTenantKey, decrypt, encrypt, type KeyInput } from "../../../crypto/encryption/index";
import { decryptKey } from "../../../durable_objects/crypto";
import { KeyDecryptionError } from "../../../errors/key_errors";
import type { WorkerEnv } from "../../auth/index";

export interface LeasedKeyTarget {
  keyId: string;
  ownerTenantId: string;
  provider?: string;
}

// In-memory cache for decrypted API keys: keyed by `${keyId}:${nonce}`
const decryptedKeyCache = new Map<string, { key: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Clears the entire decrypted key cache. Useful for test isolation.
 */
export function clearDecryptedKeyCache(): void {
  decryptedKeyCache.clear();
}

/**
 * Evicts all cached entries for a specific keyId.
 * Natural rotation invalidates via nonce change, but explicit mutation calls evict.
 */
export function evict(keyId: string): void {
  for (const k of decryptedKeyCache.keys()) {
    if (k === keyId || k.startsWith(`${keyId}:`)) {
      decryptedKeyCache.delete(k);
    }
  }
}

async function quarantineKey(env: WorkerEnv, keyId: string): Promise<void> {
  if (env.DB && typeof env.DB.prepare === "function") {
    try {
      await env.DB.prepare(
        "UPDATE api_keys SET status = 'QUARANTINED', status_changed_at = ? WHERE id = ? AND status != 'REVOKED'"
      )
        .bind(Date.now(), keyId)
        .run();
    } catch (err) {
      console.error(`Failed to quarantine key '${keyId}':`, err);
    }
  }
}

/**
 * Strictly resolves a leased API key, decrypting with the owner tenant's derived subkey.
 *
 * @param lease Leased key descriptor (keyId, ownerTenantId, provider)
 * @param env Cloudflare Worker environment bindings
 * @param masterKey Optional master encryption key override
 * @returns Plaintext API key string for upstream provider HTTP authorization
 * @throws KeyDecryptionError on AC-07 mismatch, decryption error, or missing row
 */
export async function resolveLeasedKey(
  lease: LeasedKeyTarget,
  env: WorkerEnv,
  masterKey?: KeyInput
): Promise<string> {
  if (!lease || !lease.keyId || !lease.ownerTenantId) {
    throw new KeyDecryptionError("Invalid lease: missing keyId or ownerTenantId");
  }

  const resolvedMasterKey: string | Uint8Array =
    typeof masterKey === "string" || masterKey instanceof Uint8Array
      ? masterKey
      : (env.KC_MASTER_KEY ? String(env.KC_MASTER_KEY) : undefined) ??
        (typeof process !== "undefined" && process.env
          ? process.env.KC_MASTER_KEY || process.env.MASTER_KEY
          : undefined) ??
        "";

  if (!resolvedMasterKey || (typeof resolvedMasterKey === "string" && resolvedMasterKey.trim().length === 0)) {
    throw new KeyDecryptionError("Master encryption key is not configured");
  }

  if (!env.DB || typeof env.DB.prepare !== "function") {
    throw new KeyDecryptionError("Database binding missing for key resolution");
  }

  const row = await env.DB.prepare(
    "SELECT id, tenant_id, provider, encrypted_key_b64, nonce_b64, hkdf_migrated, status FROM api_keys WHERE id = ?"
  )
    .bind(lease.keyId)
    .first<{
      id: string;
      tenant_id: string;
      provider: string;
      encrypted_key_b64: string;
      nonce_b64: string;
      hkdf_migrated: number | null;
      status: string;
    }>();

  if (!row) {
    throw new KeyDecryptionError(`Key '${lease.keyId}' not found in D1`, {
      keyId: lease.keyId,
    });
  }

  // AC-07 Invariant: Assert row.tenant_id matches lease.ownerTenantId strictly
  if (row.tenant_id !== lease.ownerTenantId) {
    console.error(
      `Security Alert (AC-07): Cross-tenant key access attempt. Key '${lease.keyId}' owned by '${row.tenant_id}', lease requested by '${lease.ownerTenantId}'`
    );
    await quarantineKey(env, lease.keyId);
    throw new KeyDecryptionError(
      `AC-07: Tenant isolation violation for key '${lease.keyId}'`,
      { keyId: lease.keyId, provider: lease.provider ?? row.provider }
    );
  }

  // Check in-memory cache by keyId:nonce
  const cacheKey = `${row.id}:${row.nonce_b64}`;
  const cached = decryptedKeyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }

  // Lazy HKDF migration if hkdf_migrated is 0 or null
  const isMigrated = row.hkdf_migrated === 1;

  if (!isMigrated) {
    let legacyPlaintext: string | undefined;

    // 1. Decrypt via legacy master key path
    try {
      legacyPlaintext = await decryptKey(
        row.encrypted_key_b64,
        row.nonce_b64,
        resolvedMasterKey
      );
    } catch {
      try {
        legacyPlaintext = await decrypt(
          { ciphertext: row.encrypted_key_b64, nonce: row.nonce_b64 },
          resolvedMasterKey
        );
      } catch {
        // Fallback: check if the row was already encrypted with tenant subkey
        try {
          const tenantKey = await deriveTenantKey(resolvedMasterKey, row.tenant_id);
          const trialPlaintext = await decrypt(
            { ciphertext: row.encrypted_key_b64, nonce: row.nonce_b64 },
            tenantKey
          );
          if (trialPlaintext && trialPlaintext.trim().length > 0) {
            await env.DB.prepare("UPDATE api_keys SET hkdf_migrated = 1 WHERE id = ?")
              .bind(row.id)
              .run();
            const clean = trialPlaintext.trim();
            decryptedKeyCache.set(cacheKey, {
              key: clean,
              expiresAt: Date.now() + CACHE_TTL_MS,
            });
            return clean;
          }
        } catch {
          // Both legacy and tenant decryption failed
        }
      }
    }

    if (!legacyPlaintext || legacyPlaintext.trim().length === 0) {
      console.error(`Security Alert: Decryption failed for legacy key '${lease.keyId}'`);
      await quarantineKey(env, lease.keyId);
      throw new KeyDecryptionError(
        `Decryption failed for key '${lease.keyId}': invalid ciphertext or corrupted nonce`,
        { keyId: lease.keyId, provider: lease.provider ?? row.provider }
      );
    }

    const cleanPlaintext = legacyPlaintext.trim();

    // 2. Re-encrypt with tenant subkey and update D1 hkdf_migrated = 1
    try {
      const tenantKey = await deriveTenantKey(resolvedMasterKey, row.tenant_id);
      const { ciphertextB64, nonceB64 } = await encrypt(cleanPlaintext, tenantKey);
      await env.DB.prepare(
        "UPDATE api_keys SET encrypted_key_b64 = ?, nonce_b64 = ?, hkdf_migrated = 1 WHERE id = ?"
      )
        .bind(ciphertextB64, nonceB64, row.id)
        .run();

      // Cache under new nonce
      decryptedKeyCache.set(`${row.id}:${nonceB64}`, {
        key: cleanPlaintext,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      return cleanPlaintext;
    } catch (migErr) {
      console.error(`Security Alert: Re-encryption failed for key '${lease.keyId}':`, migErr);
      await quarantineKey(env, lease.keyId);
      throw new KeyDecryptionError(
        `Failed to re-encrypt migrated key '${lease.keyId}'`,
        { keyId: lease.keyId, provider: lease.provider ?? row.provider }
      );
    }
  }

  // Already HKDF-migrated: decrypt strictly with deriveTenantKey(master, row.tenant_id)
  try {
    const tenantKey = await deriveTenantKey(resolvedMasterKey, row.tenant_id);
    const plaintext = await decrypt(
      { ciphertext: row.encrypted_key_b64, nonce: row.nonce_b64 },
      tenantKey
    );

    if (!plaintext || plaintext.trim().length === 0) {
      throw new Error("Decrypted key plaintext is empty");
    }

    const clean = plaintext.trim();
    decryptedKeyCache.set(cacheKey, {
      key: clean,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return clean;
  } catch (decryptErr) {
    console.error(`Security Alert: Decryption failed for key '${lease.keyId}':`, decryptErr);
    await quarantineKey(env, lease.keyId);
    throw new KeyDecryptionError(
      `Decryption failed for key '${lease.keyId}': invalid ciphertext or corrupted nonce`,
      { keyId: lease.keyId, provider: lease.provider ?? row.provider }
    );
  }
}

/**
 * Backward compatibility wrapper for resolveLeasedKey.
 */
export async function resolvePlaintextKey(
  keyIdOrPlaintext: string,
  provider: string,
  tenantId: string,
  env: WorkerEnv,
  masterKey?: KeyInput
): Promise<string> {
  return resolveLeasedKey(
    {
      keyId: keyIdOrPlaintext,
      ownerTenantId: tenantId,
      provider,
    },
    env,
    masterKey
  );
}
