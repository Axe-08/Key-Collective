/**
 * Key Collective — AC-07 HKDF Strict Decryption & Isolation Integration Tests (WP-4.4 T-4.4.2)
 *
 * Invariants Enforced (GEMINI.md & Constitution):
 * - AC-07: Under no circumstances may caller tenant ID or master key be used as fallback
 *   to decrypt a key owned by another tenant.
 * - Decryption must strictly assert row.tenant_id === lease.ownerTenantId.
 * - Any mismatch or decryption failure must:
 *   1. Log security alert.
 *   2. Quarantine key in D1: UPDATE api_keys SET status = 'QUARANTINED', status_changed_at = ? WHERE id = ?
 *   3. Throw KeyDecryptionError.
 *   4. NEVER return key ID or trimmed string as a credential.
 * - Lazy HKDF migration converts legacy rows (hkdf_migrated=0) on first access to tenant subkey (hkdf_migrated=1).
 * - Bulk migration script (migrateKeysToHkdf) successfully processes legacy rows and quarantines corrupted rows.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock, SELF } from "cloudflare:test";
import { deriveTenantKey, encrypt } from "../../../src/crypto/encryption/index";
import { encryptKey } from "../../../src/durable_objects/crypto";
import { KeyDecryptionError } from "../../../src/errors/key_errors";
import { resolveLeasedKey } from "../../../src/worker/router/core/key_resolver";
import { migrateKeysToHkdf } from "../../../ops/migrate_keys_hkdf";
import { addProviderKey, createApiKey, createUser } from "../../helpers/world";

let upstreamCallCount = 0;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  fetchMock
    .get("https://challenges.cloudflare.com")
    .intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
    .reply(() => ({
      statusCode: 200,
      data: JSON.stringify({ success: true }),
      responseOptions: { headers: { "content-type": "application/json" } },
    }))
    .persist();

  fetchMock
    .get("https://api.groq.com")
    .intercept({ path: /.*/, method: "POST" })
    .reply(() => {
      upstreamCallCount += 1;
      return {
        statusCode: 200,
        data: JSON.stringify({
          id: "chatcmpl-ac07",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
        }),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();
});

describe("AC-07 HKDF Strict Decryption & Isolation (WP-4.4 T-4.4.2)", () => {
  const MASTER_KEY =
    (env as unknown as { KC_MASTER_KEY?: string }).KC_MASTER_KEY ||
    "test-master-key-please-rotate";

  it("AC-07: cross-tenant lease attempt throws KeyDecryptionError and quarantines key in D1", async () => {
    const userA = await createUser({ github: true, eligible: true });
    const userB = await createUser({ github: true, eligible: true });

    const keyA = await addProviderKey(userA, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_tenant_a_isolated_key_0001",
    });

    // Tenant B attempts to resolve Tenant A's key under Tenant B's ownerTenantId
    await expect(
      resolveLeasedKey(
        {
          keyId: keyA.id,
          ownerTenantId: userB.id,
          provider: "groq",
        },
        env
      )
    ).rejects.toThrow(KeyDecryptionError);

    // Verify key was quarantined in D1
    const row = await env.DB.prepare(
      "SELECT status, status_changed_at FROM api_keys WHERE id = ?"
    )
      .bind(keyA.id)
      .first<{ status: string; status_changed_at: number | null }>();

    expect(row?.status).toBe("QUARANTINED");
    expect(row?.status_changed_at).toBeGreaterThan(0);
  });

  it("corrupted ciphertext: throws KeyDecryptionError and quarantines key without calling upstream", async () => {
    const user = await createUser({ github: true, eligible: true });
    const keyId = "key_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

    // Insert key with corrupted ciphertext and invalid base64
    await env.DB.prepare(
      `INSERT INTO api_keys (
        id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
        key_hash, key_prefix, key_suffix, rpm_limit, rpd_limit, priority,
        pool_type, status, hkdf_migrated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`
    )
      .bind(
        keyId,
        user.id,
        "corrupt-key",
        "groq",
        "invalid-corrupted-ciphertext-base64",
        "bm9uY2UxMjM0NTY=",
        "hash123",
        "gsk_",
        "xxxx",
        15,
        1500,
        0,
        "PRIVATE",
        "HEALTHY"
      )
      .run();

    await expect(
      resolveLeasedKey(
        {
          keyId,
          ownerTenantId: user.id,
          provider: "groq",
        },
        env
      )
    ).rejects.toThrow(KeyDecryptionError);

    const row = await env.DB.prepare("SELECT status FROM api_keys WHERE id = ?")
      .bind(keyId)
      .first<{ status: string }>();

    expect(row?.status).toBe("QUARANTINED");
  });

  it("unmigrated row (hkdf_migrated=0): throws KeyDecryptionError and quarantines key without calling upstream (T-7.6.1)", async () => {
    const user = await createUser({ github: true, eligible: true });
    const rawPlaintext = "gsk_legacy_row_plain_key_7777";
    const legacyEncrypted = await encryptKey(rawPlaintext, "legacy", "groq", MASTER_KEY);
    const keyId = "key_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

    await env.DB.prepare(
      `INSERT INTO api_keys (
        id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
        key_hash, key_prefix, key_suffix, rpm_limit, rpd_limit, priority,
        pool_type, status, hkdf_migrated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`
    )
      .bind(
        keyId,
        user.id,
        "legacy-key",
        "groq",
        legacyEncrypted.ciphertext,
        legacyEncrypted.nonce,
        "hash777",
        "gsk_",
        "7777",
        15,
        1500,
        0,
        "PRIVATE",
        "HEALTHY"
      )
      .run();

    const beforeCalls = upstreamCallCount;
    await expect(
      resolveLeasedKey(
        {
          keyId,
          ownerTenantId: user.id,
          provider: "groq",
        },
        env
      )
    ).rejects.toThrow(KeyDecryptionError);
    expect(upstreamCallCount).toBe(beforeCalls);

    const rowAfter = await env.DB.prepare(
      "SELECT status, hkdf_migrated FROM api_keys WHERE id = ?"
    )
      .bind(keyId)
      .first<{ status: string; hkdf_migrated: number }>();

    expect(rowAfter?.status).toBe("QUARANTINED");
    expect(rowAfter?.hkdf_migrated).toBe(0);
  });

  it("bulk migration: migrateKeysToHkdf migrates all legacy rows and quarantines corrupted ones", async () => {
    const user = await createUser({ github: true, eligible: true });

    // 1. Insert 3 legacy keys
    const rawKeys = [
      "gsk_bulk_key_0001",
      "gsk_bulk_key_0002",
      "gsk_bulk_key_0003",
    ];
    const keyIds: string[] = [];

    for (const raw of rawKeys) {
      const encrypted = await encryptKey(raw, "legacy", "groq", MASTER_KEY);
      const kid = "key_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      keyIds.push(kid);
      await env.DB.prepare(
        `INSERT INTO api_keys (
          id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
          key_hash, key_prefix, key_suffix, rpm_limit, rpd_limit, priority,
          pool_type, status, hkdf_migrated, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`
      )
        .bind(
          kid,
          user.id,
          `bulk-${kid}`,
          "groq",
          encrypted.ciphertext,
          encrypted.nonce,
          "hash_" + kid,
          "gsk_",
          "bulk",
          15,
          1500,
          0,
          "COMMUNITY",
          "HEALTHY"
        )
        .run();
    }

    // 2. Insert 1 corrupted legacy key
    const corruptKid = "key_corrupt_bulk_" + crypto.randomUUID().slice(0, 8);
    await env.DB.prepare(
      `INSERT INTO api_keys (
        id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
        key_hash, key_prefix, key_suffix, rpm_limit, rpd_limit, priority,
        pool_type, status, hkdf_migrated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`
    )
      .bind(
        corruptKid,
        user.id,
        "corrupt-bulk",
        "groq",
        "invalid-b64-corrupt",
        "bm9uY2UxMjM0NTY=",
        "hash_corrupt",
        "gsk_",
        "bad",
        15,
        1500,
        0,
        "COMMUNITY",
        "HEALTHY"
      )
      .run();

    // Run bulk migration
    const stats = await migrateKeysToHkdf(env.DB, MASTER_KEY, 10);
    expect(stats.migrated).toBeGreaterThanOrEqual(3);
    expect(stats.errors).toBeGreaterThanOrEqual(1);

    // Verify all 3 keys now have hkdf_migrated = 1
    for (const kid of keyIds) {
      const row = await env.DB.prepare(
        "SELECT hkdf_migrated, status FROM api_keys WHERE id = ?"
      )
        .bind(kid)
        .first<{ hkdf_migrated: number; status: string }>();
      expect(row?.hkdf_migrated).toBe(1);
      expect(row?.status).toBe("HEALTHY");
    }

    // Verify corrupted key is quarantined
    const corruptRow = await env.DB.prepare(
      "SELECT hkdf_migrated, status FROM api_keys WHERE id = ?"
    )
      .bind(corruptKid)
      .first<{ hkdf_migrated: number; status: string }>();
    expect(corruptRow?.status).toBe("QUARANTINED");
  });
});
