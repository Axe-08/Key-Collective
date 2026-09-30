/**
 * Key Collective v4 — S2 Verified Google Sign-In Token Minting Tests
 *
 * Invariants Tested:
 * 1. POST /api/auth/sync-session is gone: returns 404 and mints no auth_tokens row.
 * 2. POST /api/auth/google rejects unsigned, wrong-audience, wrong-issuer, expired,
 *    and unverified-email JWTs with 401.
 * 3. A valid JWT mints a token for tenant `usr_goog_<sub>`; any `id` field in the
 *    request body is ignored.
 * 4. Signing in again as an existing user does not change their stored tier.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { defaultMainWorker } from "../../../src/worker/index";
import { GOOGLE_JWKS_URL } from "../../../src/auth/google/verify_id_token";
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
const KID = "test-kid-1";

interface AuthResponseBody {
  success: boolean;
  user: { id: string; email: string; tier: string };
  token: string;
}

interface ErrorBody {
  error: { message: string; code: string; statusCode: number };
}

let privateKey: CryptoKey;

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  const { publicKey, privateKey: priv } = await generateKeyPair("RS256", {
    extractable: true,
  });
  privateKey = priv;

  const publicJwk = (await exportJWK(publicKey)) as JWK;
  publicJwk.kid = KID;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

  const jwksUrl = new URL(GOOGLE_JWKS_URL);
  fetchMock
    .get(jwksUrl.origin)
    .intercept({ path: jwksUrl.pathname, method: "GET" })
    .reply(200, JSON.stringify({ keys: [publicJwk] }), {
      headers: { "content-type": "application/json" },
    })
    .persist();
});

async function signValidToken(
  overrides: Record<string, unknown> = {},
  claimOverrides: { sub?: string; email?: string; email_verified?: boolean } = {}
): Promise<string> {
  const sub = claimOverrides.sub ?? `sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const email = claimOverrides.email ?? `${sub}@example.test`;
  const emailVerified = claimOverrides.email_verified ?? true;

  const builder = new SignJWT({
    email,
    email_verified: emailVerified,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(`https://securetoken.google.com/${PROJECT_ID}`)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h");

  if (!("aud" in overrides)) {
    builder.setAudience(PROJECT_ID);
  }

  return builder.sign(privateKey);
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
    const token = await new SignJWT({
      email: "wrongiss@example.test",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer("https://securetoken.google.com/some-other-project")
      .setAudience(PROJECT_ID)
      .setSubject("wrong_iss_sub")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const req = new Request("https://console.test/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(401);
  });

  it("rejects an expired JWT with 401", async () => {
    const token = await new SignJWT({
      email: "expired@example.test",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(`https://securetoken.google.com/${PROJECT_ID}`)
      .setAudience(PROJECT_ID)
      .setSubject("expired_sub")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);

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

  it("mints a token for tenant usr_goog_<sub> from a valid JWT, ignoring a spoofed id field", async () => {
    const sub = `valid_sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const email = `${sub}@example.test`;
    const token = await signValidToken({}, { sub, email });

    const req = new Request("https://console.test/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token, id: "admin" }),
    });

    const res = await defaultMainWorker.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthResponseBody;
    expect(body.success).toBe(true);
    expect(body.user.id).toBe(`usr_goog_${sub}`);
    expect(body.user.id).not.toBe("admin");
    expect(body.user.email).toBe(email);
    expect(body.user.tier).toBe("builder");
    expect(typeof body.token).toBe("string");

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

    // First sign-in creates the user with tier = 'builder'.
    const firstToken = await signValidToken({}, { sub, email });
    const firstReq = new Request("https://console.test/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: firstToken }),
    });
    const firstRes = await defaultMainWorker.fetch(firstReq, testEnv);
    expect(firstRes.status).toBe(200);

    // Manually promote the user to a privileged tier, simulating an admin
    // action taken after signup.
    await env.DB.prepare("UPDATE users SET tier = ? WHERE id = ?")
      .bind("admin", tenantId)
      .run();

    // Second sign-in with a fresh, validly-signed token for the same subject
    // must not reset the tier back to 'builder'.
    const secondToken = await signValidToken({}, { sub, email });
    const secondReq = new Request("https://console.test/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: secondToken }),
    });
    const secondRes = await defaultMainWorker.fetch(secondReq, testEnv);
    expect(secondRes.status).toBe(200);
    const secondBody = (await secondRes.json()) as AuthResponseBody;
    expect(secondBody.user.tier).toBe("admin");

    const userRow = await env.DB.prepare("SELECT tier FROM users WHERE id = ?")
      .bind(tenantId)
      .first<{ tier: string }>();
    expect(userRow?.tier).toBe("admin");
  });
});
