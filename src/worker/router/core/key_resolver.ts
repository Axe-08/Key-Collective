/**
 * Key Collective v2/v4 — Upstream Key Decryption & Resolution
 *
 * Resolves a key identifier (e.g. 'key_gemini_2') into the decrypted
 * plaintext API key for upstream provider execution.
 *
 * Enforces Invariants (GEMINI.md Constitution):
 * - No Plaintext Keys in D1 or Durable Objects.
 * - AES-256-GCM Decryption with 12-byte nonces via Web Crypto API.
 * - Strict tenant key derivation (deriveTenantKey) with fallback to master key.
 */

import { deriveTenantKey, decrypt, type KeyInput } from "../../../crypto/encryption/index";
import { decryptKey } from "../../../durable_objects/crypto";
import type { WorkerEnv } from "../../auth/index";

// In-memory cache for decrypted API keys to avoid repetitive D1 / crypto operations
const decryptedKeyCache = new Map<string, { key: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function clearDecryptedKeyCache(): void {
  decryptedKeyCache.clear();
}

/**
 * Resolves an API key string, decrypting it if it represents a key ID from KeyPool / D1.
 *
 * @param keyIdOrPlaintext The key ID (e.g. 'key_gemini_2') or existing plaintext key.
 * @param provider Target provider (e.g. 'google', 'groq', 'openai').
 * @param tenantId The current tenant ID context.
 * @param env Cloudflare Worker environment bindings.
 * @param masterKey Optional master encryption key override.
 * @returns The plaintext API key for upstream HTTP authorization.
 */
export async function resolvePlaintextKey(
  keyIdOrPlaintext: string,
  provider: string,
  tenantId: string,
  env: WorkerEnv,
  masterKey?: KeyInput
): Promise<string> {
  if (!keyIdOrPlaintext || typeof keyIdOrPlaintext !== "string") {
    return keyIdOrPlaintext;
  }

  const trimmed = keyIdOrPlaintext.trim();

  // Fast-path: if it already looks like a raw upstream API key, return immediately
  if (
    trimmed.startsWith("AIza") || // Google Gemini
    trimmed.startsWith("gsk_") || // Groq
    trimmed.startsWith("sk-") ||  // OpenAI, DeepSeek, Anthropic
    (!trimmed.startsWith("key_") && trimmed.length > 30 && !trimmed.includes(" "))
  ) {
    return trimmed;
  }

  // Check in-memory cache
  const cached = decryptedKeyCache.get(trimmed);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }

  const resolvedMasterKey =
    masterKey ??
    (env.KC_MASTER_KEY ? String(env.KC_MASTER_KEY) : undefined);

  if (!resolvedMasterKey) {
    return trimmed;
  }

  // Look up key ciphertext in D1
  if (env.DB && typeof env.DB.prepare === "function") {
    try {
      const row = await env.DB.prepare(
        "SELECT encrypted_key_b64, nonce_b64, tenant_id, provider FROM api_keys WHERE id = ?"
      ).bind(trimmed).first<{
        encrypted_key_b64: string;
        nonce_b64: string;
        tenant_id: string;
        provider: string;
      }>();

      if (row && row.encrypted_key_b64 && row.nonce_b64) {
        // Attempt 1: deriveTenantKey using row.tenant_id
        if (row.tenant_id) {
          try {
            const tenantKey = await deriveTenantKey(
              resolvedMasterKey as string | Uint8Array,
              row.tenant_id
            );
            const decrypted = await decrypt(
              { ciphertext: row.encrypted_key_b64, nonce: row.nonce_b64 },
              tenantKey
            );
            if (decrypted && decrypted.trim().length > 0) {
              decryptedKeyCache.set(trimmed, {
                key: decrypted.trim(),
                expiresAt: Date.now() + CACHE_TTL_MS,
              });
              return decrypted.trim();
            }
          } catch {
            // Fall through
          }
        }

        // Attempt 2: deriveTenantKey using caller tenantId
        if (tenantId && tenantId !== row.tenant_id) {
          try {
            const callerKey = await deriveTenantKey(
              resolvedMasterKey as string | Uint8Array,
              tenantId
            );
            const decrypted = await decrypt(
              { ciphertext: row.encrypted_key_b64, nonce: row.nonce_b64 },
              callerKey
            );
            if (decrypted && decrypted.trim().length > 0) {
              decryptedKeyCache.set(trimmed, {
                key: decrypted.trim(),
                expiresAt: Date.now() + CACHE_TTL_MS,
              });
              return decrypted.trim();
            }
          } catch {
            // Fall through
          }
        }

        // Attempt 3: Direct master key decryption (decryptKey in durable_objects/crypto)
        try {
          const decrypted = await decryptKey(
            row.encrypted_key_b64,
            row.nonce_b64,
            resolvedMasterKey
          );
          if (decrypted && decrypted.trim().length > 0) {
            decryptedKeyCache.set(trimmed, {
              key: decrypted.trim(),
              expiresAt: Date.now() + CACHE_TTL_MS,
            });
            return decrypted.trim();
          }
        } catch {
          // Fall through
        }

        // Attempt 4: Default tenant derivation
        try {
          const defaultKey = await deriveTenantKey(
            resolvedMasterKey as string | Uint8Array,
            "default"
          );
          const decrypted = await decrypt(
            { ciphertext: row.encrypted_key_b64, nonce: row.nonce_b64 },
            defaultKey
          );
          if (decrypted && decrypted.trim().length > 0) {
            decryptedKeyCache.set(trimmed, {
              key: decrypted.trim(),
              expiresAt: Date.now() + CACHE_TTL_MS,
            });
            return decrypted.trim();
          }
        } catch {
          // Fall through
        }
      }
    } catch {
      // D1 query error, fall through to returning input
    }
  }

  return trimmed;
}
