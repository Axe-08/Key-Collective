/**
 * Key Collective v4 — S2 Verified Google Sign-In Token Minting Tests
 *
 * Invariants Tested:
 * 1. POST /api/auth/sync-session is gone: returns 404 and mints no auth_tokens row.
 * 2. POST /api/auth/google rejects unsigned, wrong-audience, wrong-issuer, expired,
 *    and unverified-email JWTs with 401.
 * 3. A valid JWT for an ACTIVE user signs in as tenant `usr_goog_<sub>` (session cookie, no bearer
 *    token: RA-01); any `id` field in the request body is ignored.
 * 4. Signing in again as an existing user does not change their stored tier.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import { installGoogleJwks, signGoogleIdToken } from "../../helpers/google_jwt";
import type { WorkerEnv } from "../../../src/worker/auth/index";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    KC_MASTER_KEY?: string;
    FIREBASE_PROJECT_ID?: string;
  }
}

const testEnv: WorkerEnv = {
  ...env,
  TENANT_QUOTA: undefined,
};

const PROJECT_ID = "key-collective-568f8";

interface AuthResponseBody {
  success: boolean;
  user: { id: string; email: string; tier: string };
  token?: string;
}

interface ErrorBody {
  error: { message: string; code: string; statusCode: number };
}

beforeAll(installGoogleJwks);

async function signValidToken(
  overrides: Record<string, unknown> = {},
  claimOverrides: { sub?: string; email?: string; email_verified?: boolean } = {}
): Promise<string> {
  const sub = claimOverrides.sub ?? `sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const email = claimOverrides.email ?? `${sub}@example.test`;
  const { aud, ...claims } = overrides;
  return signGoogleIdToken(
    sub,
    email,
    { email_verified: claimOverrides.email_verified ?? true, ...claims },
    aud === undefined ? {} : { audience: String(aud) }
  );
}

/** Google sign-in for a user who has already given registration consent. */
async function activeSignIn(sub: string, email: string, body: Record<string, unknown> = {}): Promise<Response> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, tier, role, registration_status, created_at) VALUES (?, ?, 'builder', 'user', 'ACTIVE', CURRENT_TIMESTAMP)"
  ).bind(`usr_goog_${sub}`, email).run();
  return defaultMainWorker.fetch(
    new Request("https://console.test/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: await signValidToken({}, { sub, email }), ...body }),
    }),
    testEnv
  );
}

describe("S2 Security: Verified Google Sign-In Token Minting", () => {
  it("POST /api/auth/sync-session returns 404 and mints no auth_tokens row", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) as count FROM auth_tokens").first<{ count: number }>();

    const req = new Request("https://console.test/api/auth/sync-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "admin" }),
    });

    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(404);

    const after = await env.DB.prepare("SELECT COUNT(*) as count FROM auth_tokens").first<{ count: number }>();
    expect(after?.count).toBe(before?.count);
  });

  it("rejects an unsigned JWT with 401", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "unsigned_sub",
        email: "unsigned@example.test",
        email_verified: true,
        iss: `https://securetoken.google.com/${PROJECT_ID}`,
        aud: PROJECT_ID,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString("base64url");
    const unsignedToken = `${header}.${payload}.`;

    const req = new Request("https://console.test/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: unsignedToken }),
    });

    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.statusCode).toBe(401);
  });

  it("rejects a JWT with the wrong audience with 401", async () => {
    const token = await signValidToken({ aud: "wrong-project" });
    const req = new Request("https://console.test/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(401);
  });

  it("rejects a JWT with the wrong issuer with 401", async () => {
    const token = await signGoogleIdToken("wrong_iss_sub", "wrongiss@example.test", { email_verified: true }, {
      issuer: "https://securetoken.google.com/some-other-project",
    });

    const req = new Request("https://console.test/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(401);
  });

  it("rejects an expired JWT with 401", async () => {
    const token = await signGoogleIdToken("expired_sub", "expired@example.test", { email_verified: true }, {
      expiresIn: Math.floor(Date.now() / 1000) - 3600,
    });

    const req = new Request("https://console.test/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(401);
  });

  it("rejects a JWT with email_verified: false with 401", async () => {
    const token = await signValidToken({}, { email_verified: false });
    const req = new Request("https://console.test/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(401);
  });

  it("signs in as tenant usr_goog_<sub> from a valid JWT with a session and no bearer token, ignoring a spoofed id field", async () => {
    const sub = `valid_sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const email = `${sub}@example.test`;

    const res = await activeSignIn(sub, email, { id: "admin" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthResponseBody;
    expect(body.success).toBe(true);
    expect(body.user.id).toBe(`usr_goog_${sub}`);
    expect(body.user.id).not.toBe("admin");
    expect(body.user.email).toBe(email);
    expect(body.user.tier).toBe("builder");
    expect(body.token).toBeUndefined();
    expect(res.headers.get("set-cookie") ?? "").toContain("kc_session=");

    const userRow = await env.DB.prepare("SELECT id, tier FROM users WHERE id = ?")
      .bind(`usr_goog_${sub}`)
      .first<{ id: string; tier: string }>();
    expect(userRow?.id).toBe(`usr_goog_${sub}`);
    expect(userRow?.tier).toBe("builder");
  });

  it("does not change an existing user's tier when they sign in again", async () => {
    const sub = `repeat_sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const email = `${sub}@example.test`;
    const tenantId = `usr_goog_${sub}`;

    // First sign-in as an ACTIVE user with tier = 'builder'.
    const firstRes = await activeSignIn(sub, email);
    expect(firstRes.status).toBe(200);

    // Manually promote the user to a privileged tier, simulating an admin
    // action taken after signup.
    await env.DB.prepare("UPDATE users SET tier = ? WHERE id = ?")
      .bind("admin", tenantId)
      .run();

    // Second sign-in with a fresh, validly-signed token for the same subject
    // must not reset the tier back to 'builder'.
    const secondRes = await activeSignIn(sub, email);
    expect(secondRes.status).toBe(200);
    const secondBody = (await secondRes.json()) as AuthResponseBody;
    expect(secondBody.user.tier).toBe("admin");

    const userRow = await env.DB.prepare("SELECT tier FROM users WHERE id = ?")
      .bind(tenantId)
      .first<{ tier: string }>();
    expect(userRow?.tier).toBe("admin");
  });
});
