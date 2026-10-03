/**
 * Key Collective — console sessions side by side with bearer tokens (WP-3.1, T-3.1.5)
 *
 * Invariants Tested:
 * 0. Google sign-in for a new user creates users + user_identities in PENDING_CONSENT and
 *    answers { next: "consent" } with a 15-minute kc_pending cookie.
 * 1. Google sign-in for an ACTIVE user sets kc_session (HttpOnly; Secure; SameSite=Lax; no Domain).
 * 2. A session cookie on a state-changing console request needs x-kc-csrf, else 403 csrf_required.
 * 3. The legacy bearer token still authenticates console /api/* and needs no CSRF header.
 * 4. A session cookie alone on api.* is 401.
 * 5. Logout revokes the session: the same cookie is then 401.
 * 6. GET /api/session returns the session's user and its CSRF token.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { lookupSession } from "../../../src/auth/session/store";
import { createApiKey, createSession, createUser } from "../../helpers/world";
import { installGoogleJwks, signGoogleIdToken } from "../../helpers/google_jwt";

const workerEnv = { ...env, TENANT_QUOTA: undefined } as unknown as WorkerEnv;

function call(url: string, init: RequestInit = {}): Promise<Response> {
  return defaultMainWorker.fetch(new Request(url, init), workerEnv);
}

function googleSignIn(idToken: string): Promise<Response> {
  return call("https://console.test/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
}

function cookieValue(res: Response, name: string): string | null {
  const header = res.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

const newSub = () => `sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

beforeAll(installGoogleJwks);

describe("console sessions", () => {
  it("[0] a new Google user is created PENDING_CONSENT and sent to consent with kc_pending", async () => {
    const sub = newSub();

    const res = await googleSignIn(await signGoogleIdToken(sub));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ next: "consent" });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/kc_pending=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=900/);
    expect(setCookie).not.toContain("kc_session=");
    const user = await env.DB.prepare("SELECT registration_status FROM users WHERE id = ?")
      .bind(`usr_goog_${sub}`)
      .first<{ registration_status: string }>();
    const identity = await env.DB.prepare("SELECT user_id FROM user_identities WHERE provider = 'google' AND subject = ?")
      .bind(sub)
      .first<{ user_id: string }>();
    expect(user?.registration_status).toBe("PENDING_CONSENT");
    expect(identity?.user_id).toBe(`usr_goog_${sub}`);
  });

  it("[1] an ACTIVE user gets a host-only kc_session cookie for a live session", async () => {
    const sub = newSub();
    await googleSignIn(await signGoogleIdToken(sub));
    await env.DB.prepare("UPDATE users SET registration_status = 'ACTIVE' WHERE id = ?").bind(`usr_goog_${sub}`).run();

    const res = await googleSignIn(await signGoogleIdToken(sub));

    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/kc_session=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=1209600/);
    expect(setCookie).not.toMatch(/domain/i);
    const token = cookieValue(res, "kc_session");
    expect(await lookupSession(env.DB, token ?? "")).toMatchObject({ userId: `usr_goog_${sub}`, kind: "console" });
  });

  it("[2] a session cookie needs x-kc-csrf on state-changing requests", async () => {
    const user = await createUser();
    const { cookie, csrfToken } = await createSession(user);
    const post = (headers: Record<string, string>) =>
      call("https://console.test/api/projects", {
        method: "POST",
        headers: { cookie, "content-type": "application/json", ...headers },
        body: JSON.stringify({ name: "csrf-probe" }),
      });

    const without = await post({});
    const wrong = await post({ "x-kc-csrf": "nope" });
    const right = await post({ "x-kc-csrf": csrfToken });

    expect(without.status).toBe(403);
    expect(await without.json()).toMatchObject({ error: "csrf_required" });
    expect(wrong.status).toBe(403);
    expect([401, 403]).not.toContain(right.status);
  });

  it("[2b] a session cookie needs no CSRF header for reads", async () => {
    const user = await createUser();
    const { cookie } = await createSession(user);

    const res = await call("https://console.test/api/keys", { headers: { cookie } });

    expect(res.status).toBe(200);
  });

  it("[3] a bearer token is rejected with 401 on console /api/* (sessions only, WP-7.2)", async () => {
    const user = await createUser();
    const bearer = await createApiKey(user);

    const read = await call("https://console.test/api/keys", { headers: { authorization: `Bearer ${bearer}` } });
    const write = await call("https://console.test/api/projects", {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "bearer-probe" }),
    });

    expect(read.status).toBe(401);
    expect(write.status).toBe(401);
  });

  it("[4] api.* ignores the session cookie", async () => {
    const user = await createUser();
    const { cookie } = await createSession(user);

    const res = await call("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "hi" }] }),
    });

    expect(res.status).toBe(401);
  });

  it("[5] logout revokes the session and clears the cookie", async () => {
    const user = await createUser();
    const { cookie, csrfToken } = await createSession(user);

    const out = await call("https://console.test/api/auth/logout", {
      method: "POST",
      headers: { cookie, "x-kc-csrf": csrfToken },
    });
    const after = await call("https://console.test/api/keys", { headers: { cookie } });

    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("kc_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
    expect(after.status).toBe(401);
  });

  it("[6] GET /api/session returns the user and the session's CSRF token", async () => {
    const user = await createUser();
    const { cookie, csrfToken } = await createSession(user);

    const res = await call("https://console.test/api/session", { headers: { cookie } });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, user: { id: user.id, email: user.email }, csrfToken });
  });

  it("[7] signing in mints no bearer token: no auth_tokens row and no token in the body (RA-01)", async () => {
    const sub = newSub();
    await googleSignIn(await signGoogleIdToken(sub));
    await env.DB.prepare("UPDATE users SET registration_status = 'ACTIVE' WHERE id = ?").bind(`usr_goog_${sub}`).run();

    const first = await googleSignIn(await signGoogleIdToken(sub));
    const second = await googleSignIn(await signGoogleIdToken(sub));

    for (const res of [first, second]) {
      expect(res.status).toBe(200);
      expect(await res.json()).not.toHaveProperty("token");
    }
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_tokens WHERE tenant_id = ?")
      .bind(`usr_goog_${sub}`)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });
});
