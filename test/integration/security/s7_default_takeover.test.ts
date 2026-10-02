/**
 * Key Collective v4 — S7 Default-Tenant Takeover Security Tests (WP-0.7 / T-0.7.1)
 *
 * Invariants Tested:
 * 1. A key still owned by the reserved 'default' tenant cannot be pool-mode-toggled
 *    or rotated by an arbitrary non-admin tenant (no more `OR tenant_id = 'default'`
 *    escape hatch in the ownership check).
 * 2. Those operations never assign/rewrite `tenant_id`.
 * 3. `runDefaultTakeoverForensics` detects rows whose tenant_id was already rewritten
 *    away from 'default' but whose ciphertext still only decrypts under the 'default'
 *    subkey (evidence of a prior takeover), reports them, and returns them to
 *    'sys_operator'; legitimate rows are left untouched.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { createUser, createSession } from "../../helpers/world";
import { deriveTenantKey, encrypt } from "../../../src/crypto/encryption";
import { runDefaultTakeoverForensics } from "../../../ops/s7_forensics";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    KC_MASTER_KEY?: string;
  }
}

const testEnv: WorkerEnv = { ...env, TENANT_QUOTA: undefined };
const MASTER_KEY =
  (env as unknown as { KC_MASTER_KEY?: string }).KC_MASTER_KEY ||
  "test-master-key-please-rotate";

async function seedDefaultOwnedKey(): Promise<string> {
  const plaintext = "kc_live_default_owned_secret";
  const defaultSubkey = await deriveTenantKey(MASTER_KEY, "default");
  const encrypted = await encrypt(plaintext, defaultSubkey);
  const keyId = "key_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await env.DB.prepare(
    "INSERT INTO api_keys (id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, key_prefix, key_suffix, pool_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
  )
    .bind(
      keyId,
      "default",
      "operator-key",
      "google",
      encrypted.ciphertextB64,
      encrypted.nonceB64,
      plaintext.slice(0, 4),
      plaintext.slice(-4),
      "PRIVATE",
      "HEALTHY"
    )
    .run();
  return keyId;
}

describe("S7 Security: default-tenant takeover removed from key ops (T-0.7.1)", () => {
  it("blocks a non-admin tenant from pool-mode-toggling or rotating a 'default'-owned key, and leaves tenant_id unchanged", async () => {
    const keyId = await seedDefaultOwnedKey();

    const attacker = await createUser();
    const { cookie: cookieAttacker, csrfToken: csrfAttacker } = await createSession(attacker);

    const poolReq = new Request(
      `https://console.test/api/keys/${keyId}/pool-mode`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: cookieAttacker,
          "x-kc-csrf": csrfAttacker,
        },
        body: JSON.stringify({ pool_type: "PRIVATE" }),
      }
    );
    const poolRes = await defaultMainWorker.fetch(poolReq, testEnv);
    expect(poolRes.status).toBe(404);

    const rotateReq = new Request(
      `https://console.test/api/keys/${keyId}/rotate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieAttacker,
          "x-kc-csrf": csrfAttacker,
        },
        body: JSON.stringify({ new_key: "sk-new-secret-123" }),
      }
    );
    const rotateRes = await defaultMainWorker.fetch(rotateReq, testEnv);
    expect(rotateRes.status).toBe(404);

    const row = await env.DB.prepare(
      "SELECT tenant_id FROM api_keys WHERE id = ?"
    )
      .bind(keyId)
      .first<{ tenant_id: string }>();
    expect(row?.tenant_id).toBe("default");
  });
});

describe("S7 Forensics: runDefaultTakeoverForensics (OP-0.11)", () => {
  it("detects a row claimed from 'default', reports it, and reassigns it to sys_operator, leaving legitimate rows untouched", async () => {
    const claimedKeyId = "key_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const claimedTenantId = "usr_gh_user";
    const defaultSubkey = await deriveTenantKey(MASTER_KEY, "default");
    const claimedEncrypted = await encrypt("kc_live_claimed_secret", defaultSubkey);
    await env.DB.prepare(
      "INSERT INTO api_keys (id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, key_prefix, key_suffix, pool_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
    )
      .bind(
        claimedKeyId,
        claimedTenantId,
        "claimed-key",
        "google",
        claimedEncrypted.ciphertextB64,
        claimedEncrypted.nonceB64,
        "kc_l",
        "cret",
        "PRIVATE",
        "HEALTHY"
      )
      .run();

    const legitUser = await createUser({ email: "legit@example.test" });
    const legitKeyId = "key_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const legitSubkey = await deriveTenantKey(MASTER_KEY, legitUser.id);
    const legitEncrypted = await encrypt("kc_live_legit_secret", legitSubkey);
    await env.DB.prepare(
      "INSERT INTO api_keys (id, tenant_id, label, provider, encrypted_key_b64, nonce_b64, key_prefix, key_suffix, pool_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
    )
      .bind(
        legitKeyId,
        legitUser.id,
        "legit-key",
        "google",
        legitEncrypted.ciphertextB64,
        legitEncrypted.nonceB64,
        "kc_l",
        "cret",
        "PRIVATE",
        "HEALTHY"
      )
      .run();

    const claimed = await runDefaultTakeoverForensics(env.DB, MASTER_KEY);

    expect(claimed.some((r) => r.id === claimedKeyId && r.tenant_id === claimedTenantId)).toBe(true);
    expect(claimed.some((r) => r.id === legitKeyId)).toBe(false);

    const claimedRow = await env.DB.prepare(
      "SELECT tenant_id FROM api_keys WHERE id = ?"
    )
      .bind(claimedKeyId)
      .first<{ tenant_id: string }>();
    expect(claimedRow?.tenant_id).toBe("sys_operator");

    const legitRow = await env.DB.prepare(
      "SELECT tenant_id FROM api_keys WHERE id = ?"
    )
      .bind(legitKeyId)
      .first<{ tenant_id: string }>();
    expect(legitRow?.tenant_id).toBe(legitUser.id);
  });
});
