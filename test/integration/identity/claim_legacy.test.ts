/**
 * Key Collective — legacy GitHub-only account claim (WP-3.5, D-10, D-27)
 *
 * Invariants Tested:
 * 1. A caller whose linked GitHub id matches gh_<id> / usr_gh_<id> claims it: the keys move to
 *    the caller, decrypt under the caller's subkey with the same key_hash, the legacy user is
 *    SUSPENDED and a legacy_claim audit row is written.
 * 2. A caller whose GitHub id does not match → 404, nothing changes.
 * 3. Claiming twice is a no-op the second time.
 * 4. GET /api/session lists claimable legacy accounts until they are claimed.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { decrypt, deriveTenantKey } from "../../../src/crypto/encryption";
import { addProviderKey, createSession, createUser } from "../../helpers/world";

const workerEnv = { ...env, TENANT_QUOTA: undefined, KEY_POOL: undefined } as unknown as WorkerEnv;
const MASTER = (env as unknown as { KC_MASTER_KEY: string }).KC_MASTER_KEY;

async function legacyUser(id: string) {
  await env.DB.prepare(
    "INSERT INTO users (id, email, tier, role, registration_status) VALUES (?, ?, 'builder', 'user', 'ACTIVE')"
  ).bind(id, `${id}@users.noreply.github.com`).run();
  return { id };
}

async function callerLinkedTo(githubId: string) {
  const user = await createUser();
  await env.DB.prepare("INSERT INTO user_identities (user_id, provider, subject) VALUES (?, 'github', ?)").bind(user.id, githubId).run();
  return user;
}

async function claim(user: { id: string }): Promise<Response> {
  const { cookie, csrfToken } = await createSession(user);
  return defaultMainWorker.fetch(
    new Request("https://console.test/api/auth/claim-legacy", { method: "POST", headers: { cookie, "x-kc-csrf": csrfToken } }),
    workerEnv
  );
}

async function sessionOf(user: { id: string }) {
  const { cookie } = await createSession(user);
  const res = await defaultMainWorker.fetch(new Request("https://console.test/api/session", { headers: { cookie } }), workerEnv);
  return (await res.json()) as { claimable_legacy_accounts?: string[] };
}

describe("POST /api/auth/claim-legacy", () => {
  it("moves a matching legacy account's keys to the caller and suspends it", async () => {
    const legacy = await legacyUser("gh_123");
    const k1 = await addProviderKey(legacy, { provider: "groq", pool: "PRIVATE", plaintext: "gsk_legacy_secret_one_0001" });
    const k2 = await addProviderKey(legacy, { provider: "google", pool: "PRIVATE", plaintext: "AIza_legacy_secret_two_0002" });
    await env.DB.prepare("UPDATE api_keys SET key_hash = 'hash-' || id WHERE tenant_id = ?").bind(legacy.id).run();
    const caller = await callerLinkedTo("123");
    expect((await sessionOf(caller)).claimable_legacy_accounts).toEqual(["gh_123"]);

    const res = await claim(caller);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claimed_keys: 2 });
    const subkey = await deriveTenantKey(MASTER, caller.id);
    for (const [key, plaintext] of [
      [k1, "gsk_legacy_secret_one_0001"],
      [k2, "AIza_legacy_secret_two_0002"],
    ] as const) {
      const row = await env.DB.prepare("SELECT tenant_id, encrypted_key_b64, nonce_b64, key_hash FROM api_keys WHERE id = ?")
        .bind(key.id)
        .first<{ tenant_id: string; encrypted_key_b64: string; nonce_b64: string; key_hash: string }>();
      expect(row?.tenant_id).toBe(caller.id);
      expect(row?.key_hash).toBe(`hash-${key.id}`);
      expect(await decrypt(row!.encrypted_key_b64, subkey, row!.nonce_b64)).toBe(plaintext);
    }
    const status = await env.DB.prepare("SELECT registration_status FROM users WHERE id = ?").bind(legacy.id).first<{ registration_status: string }>();
    expect(status?.registration_status).toBe("SUSPENDED");
    const audit = await env.DB.prepare("SELECT admin_user_id, target FROM admin_audit_logs WHERE action = 'legacy_claim'").all();
    expect(audit.results).toEqual([{ admin_user_id: caller.id, target: "gh_123" }]);
    expect((await sessionOf(caller)).claimable_legacy_accounts ?? []).toEqual([]);
  });

  it("also claims the usr_gh_<id> form", async () => {
    const legacy = await legacyUser("usr_gh_456");
    await addProviderKey(legacy, { provider: "groq", pool: "PRIVATE", plaintext: "gsk_usr_gh_form_key_0003" });
    const caller = await callerLinkedTo("456");

    const res = await claim(caller);

    expect(await res.json()).toMatchObject({ claimed_keys: 1 });
  });

  it("answers 404 and changes nothing when the GitHub id does not match", async () => {
    const legacy = await legacyUser("gh_777");
    const key = await addProviderKey(legacy, { provider: "groq", pool: "PRIVATE", plaintext: "gsk_not_yours_key_0004" });
    const caller = await callerLinkedTo("778");

    const res = await claim(caller);

    expect(res.status).toBe(404);
    const row = await env.DB.prepare("SELECT tenant_id FROM api_keys WHERE id = ?").bind(key.id).first<{ tenant_id: string }>();
    expect(row?.tenant_id).toBe("gh_777");
    const status = await env.DB.prepare("SELECT registration_status FROM users WHERE id = 'gh_777'").first<{ registration_status: string }>();
    expect(status?.registration_status).toBe("ACTIVE");
  });

  it("answers 404 to a caller with no linked GitHub account", async () => {
    await legacyUser("gh_888");

    expect((await claim(await createUser())).status).toBe(404);
  });

  it("is a no-op the second time", async () => {
    const legacy = await legacyUser("gh_999");
    await addProviderKey(legacy, { provider: "groq", pool: "PRIVATE", plaintext: "gsk_claim_twice_key_0005" });
    const caller = await callerLinkedTo("999");

    await claim(caller);
    const second = await claim(caller);

    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ claimed_keys: 0 });
    const audits = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action = 'legacy_claim' AND target = 'gh_999'").first<{ n: number }>();
    expect(audits?.n).toBe(1);
  });
});
