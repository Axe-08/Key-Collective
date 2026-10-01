/**
 * @file s3_admin_auth.test.ts
 * Security regression suite: hardened admin authentication (WP-0.3 / T-0.3.1).
 *
 * Verifies the zero-knowledge admin.* gate no longer accepts:
 *  - a raw users.id value as a bearer "token" (no more direct users-table token lookup),
 *  - KC_MASTER_KEY as a credential anywhere (it is an encryption secret only),
 *  - ?token= / ?admin_token= query-string admin auth,
 *  - the ADMIN_TOKEN break-glass header when an Origin header is present (CSRF-style abuse).
 * And that a genuine admin session (D1 auth_tokens record for a users.role='admin' user,
 * or the break-glass header with no Origin) is still accepted.
 */

import { describe, expect, it } from "vitest";
import { env as testEnv } from "cloudflare:test";
import { createSession, createUser } from "../../helpers/world";
import worker from "../../../src/worker/index";
import { hashToken } from "../../../src/crypto";
import type { WorkerEnv } from "../../../src/worker/auth/index";

const ADMIN_TOKEN = "break-glass-admin-token-xyz-12345";

interface MockTokenRow {
  id: string;
  hash_sha256: string;
  tenant_id: string;
  expires_at: string | null;
}

interface MockUserRow {
  id: string;
  email: string | null;
  tier: string | null;
  role: string | null;
  is_quarantined: number;
}

function makeMockDb(tokens: MockTokenRow[], users: MockUserRow[]) {
  return {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (query.includes("FROM auth_tokens")) {
                const hash = args[0];
                const row = tokens.find((t) => t.hash_sha256 === hash);
                return (row as unknown as T) ?? null;
              }
              if (query.includes("FROM users")) {
                const id = args[0];
                const row = users.find((u) => u.id === id);
                return (row as unknown as T) ?? null;
              }
              return null;
            },
            async run() {
              return { success: true, meta: { changes: 0 } };
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

async function buildEnv(): Promise<{ env: WorkerEnv; adminUserId: string; adminAuthToken: string }> {
  const adminUserId = "usr_admin_001";
  const adminAuthToken = "kc_admin_session_token_abc123";
  const adminHash = await hashToken(adminAuthToken);

  const users: MockUserRow[] = [
    { id: adminUserId, email: "admin@keycollective.ai", tier: "max", role: "admin", is_quarantined: 0 },
  ];

  const tokens: MockTokenRow[] = [
    {
      id: "tok_admin_1",
      hash_sha256: adminHash,
      tenant_id: adminUserId,
      expires_at: null,
    },
  ];

  const db = makeMockDb(tokens, users);

  const env = {
    DB: db,
    ADMIN_TOKEN,
    KC_MASTER_KEY: "kc_master_key_super_secret_999",
  } as unknown as WorkerEnv;

  return { env, adminUserId, adminAuthToken };
}

describe("S3: Hardened admin authentication (T-0.3.1)", () => {
  it("returns 404 on admin.* when Bearer is an admin user's raw users.id (no direct users-table token lookup)", async () => {
    const { env, adminUserId } = await buildEnv();

    const req = new Request("https://admin.keycollective.ai/api/admin/surveillance", {
      headers: { authorization: `Bearer ${adminUserId}` },
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });

  it("returns 401 on /v1 and 404 on admin.* when Bearer is KC_MASTER_KEY", async () => {
    const { env } = await buildEnv();
    const masterKey = (env as unknown as { KC_MASTER_KEY: string }).KC_MASTER_KEY;

    const v1Req = new Request("https://api.keycollective.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${masterKey}`,
      },
      body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
    });
    const v1Res = await worker.fetch(v1Req, env);
    expect(v1Res.status).toBe(401);

    const adminReq = new Request("https://admin.keycollective.ai/api/admin/surveillance", {
      headers: { authorization: `Bearer ${masterKey}` },
    });
    const adminRes = await worker.fetch(adminReq, env);
    expect(adminRes.status).toBe(404);
  });

  it("returns 404 on admin.* for ?admin_token=<ADMIN_TOKEN> query param", async () => {
    const { env } = await buildEnv();

    const req = new Request(
      `https://admin.keycollective.ai/api/admin/surveillance?admin_token=${encodeURIComponent(ADMIN_TOKEN)}`
    );

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });

  it("returns 404 on admin.* for x-kc-admin-token break-glass header when Origin is present", async () => {
    const { env } = await buildEnv();

    const req = new Request("https://admin.keycollective.ai/api/admin/surveillance", {
      headers: {
        "x-kc-admin-token": ADMIN_TOKEN,
        origin: "https://evil.test",
      },
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });

  it("returns 200 on admin.* for a genuine admin session (valid auth_tokens record for a role='admin' user)", async () => {
    const { env, adminAuthToken } = await buildEnv();

    const req = new Request("https://admin.keycollective.ai/api/admin/surveillance", {
      headers: { authorization: `Bearer ${adminAuthToken}` },
    });

    const res = await worker.fetch(req, env);
    expect(res.status).not.toBe(404);
    expect(res.status).toBeLessThan(500);
  });

  it("returns 200 on admin.* for the break-glass header when no Origin header is present", async () => {
    const { env } = await buildEnv();

    const req = new Request("https://admin.keycollective.ai/api/admin/surveillance", {
      headers: { "x-kc-admin-token": ADMIN_TOKEN },
    });

    const res = await worker.fetch(req, env);
    expect(res.status).not.toBe(404);
    expect(res.status).toBeLessThan(500);
  });
});

describe("S3: kc_admin_session on admin.* (T-3.1.4)", () => {
  const ADMIN_EMAIL = "ops-admin@keycollective.test";

  function adminEnv(): WorkerEnv {
    return { ...(testEnv as unknown as WorkerEnv), ADMIN_EMAILS: `someone@else.test, ${ADMIN_EMAIL.toUpperCase()}` };
  }

  async function adminGet(cookie: string): Promise<number> {
    const req = new Request("https://admin.test/api/admin/surveillance", {
      headers: { cookie: cookie.replace("kc_session=", "kc_admin_session=") },
    });
    return (await worker.fetch(req, adminEnv())).status;
  }

  async function listedUser(role: string) {
    await testEnv.DB.prepare("DELETE FROM users WHERE email = ?").bind(ADMIN_EMAIL).run();
    return createUser({ email: ADMIN_EMAIL, role });
  }

  it("accepts an admin session for a role='admin' user listed in ADMIN_EMAILS", async () => {
    const user = await listedUser("admin");
    const { cookie } = await createSession(user, { kind: "admin" });

    const status = await adminGet(cookie);

    expect(status).not.toBe(404);
    expect(status).toBeLessThan(500);
  });

  it("denies (404) a role='admin' user whose email is not in ADMIN_EMAILS", async () => {
    const user = await createUser({ role: "admin" });
    const { cookie } = await createSession(user, { kind: "admin" });

    expect(await adminGet(cookie)).toBe(404);
  });

  it("denies (404) a listed email whose role is not admin", async () => {
    const user = await listedUser("user");
    const { cookie } = await createSession(user, { kind: "admin" });

    expect(await adminGet(cookie)).toBe(404);
  });

  it("denies (404) a console session, an expired session and a revoked session", async () => {
    const user = await listedUser("admin");
    const consoleSession = await createSession(user, { kind: "console" });
    const expired = await createSession(user, { kind: "admin", ttlSeconds: -60 });
    const revoked = await createSession(user, { kind: "admin" });
    await testEnv.DB.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND expires_at > datetime('now') AND kind = 'admin'")
      .bind(user.id)
      .run();

    expect(await adminGet(consoleSession.cookie)).toBe(404);
    expect(await adminGet(expired.cookie)).toBe(404);
    expect(await adminGet(revoked.cookie)).toBe(404);
  });
});
