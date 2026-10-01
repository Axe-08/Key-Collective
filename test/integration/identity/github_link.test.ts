/**
 * Key Collective — GitHub link flow (WP-3.3, T-3.3.2)
 *
 * Invariants Tested:
 * 1. /start needs a session and redirects to GitHub with state + S256 code_challenge and a
 *    signed, HttpOnly, 10-minute kc_oauth cookie.
 * 2. Callback with a wrong state, a tampered cookie or an expired cookie → 400 each.
 * 3. A GitHub id already linked to another user → 409.
 * 4. Sybil bands: < 40 refused (no identity); 40–64 linked, community_eligible = 0; >= 65 eligible.
 * 5. The callback redirect carries no token and the response has no postMessage.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { signOAuthCookie } from "../../../src/auth/github/link_flow";
import { createSession, createUser } from "../../helpers/world";

const workerEnv = { ...env, TENANT_QUOTA: undefined, KEY_POOL: undefined } as unknown as WorkerEnv;
const DAY = 24 * 60 * 60 * 1000;

interface Profile {
  id: number;
  verified: boolean;
  ageDays: number;
  repos: number;
  contributions: number;
}

const mature = (id: number): Profile => ({ id, verified: true, ageDays: 400, repos: 4, contributions: 50 });

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get("https://challenges.cloudflare.com")
    .intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
    .reply(200, JSON.stringify({ success: true, "error-codes": [] }), { headers: { "content-type": "application/json" } })
    .persist();
  installGithub();
});

// GitHub answers for whichever profile the running test set; persistent interceptors, so a
// callback that stops early (400) leaves nothing queued for the next test.
let current: Profile = mature(0);

function installGithub(): void {
  const jsonHeaders = { headers: { "content-type": "application/json" } };
  fetchMock
    .get("https://github.com")
    .intercept({ path: "/login/oauth/access_token", method: "POST" })
    .reply(200, () => JSON.stringify({ access_token: `gho_${current.id}` }), jsonHeaders)
    .persist();
  const api = fetchMock.get("https://api.github.com");
  api
    .intercept({ path: "/user", method: "GET" })
    .reply(
      200,
      () =>
        JSON.stringify({
          id: current.id,
          login: `octo${current.id}`,
          created_at: new Date(Date.now() - current.ageDays * DAY).toISOString(),
          public_repos: current.repos,
        }),
      jsonHeaders
    )
    .persist();
  api
    .intercept({ path: "/user/emails", method: "GET" })
    .reply(200, () => JSON.stringify([{ email: `octo${current.id}@example.com`, primary: true, verified: current.verified }]), jsonHeaders)
    .persist();
  api
    .intercept({ path: "/graphql", method: "POST" })
    .reply(
      200,
      () => JSON.stringify({ data: { viewer: { contributionsCollection: { contributionCalendar: { totalContributions: current.contributions } } } } }),
      jsonHeaders
    )
    .persist();
}

const randomIp = () => `198.${10 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 250)}.7`;

function get(path: string, headers: Record<string, string>): Promise<Response> {
  return defaultMainWorker.fetch(new Request(`https://console.test${path}`, { headers, redirect: "manual" }), workerEnv);
}

/** Runs /start, then the callback with GitHub answering `profile`. */
async function link(user: { id: string }, profile: Profile, tamper?: (state: string, cookie: string) => [string, string]) {
  const { cookie: session } = await createSession(user);
  const start = await get("/api/auth/github/start?turnstile=tok", { cookie: session });
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
  const oauth = (start.headers.get("set-cookie") ?? "").match(/kc_oauth=([^;]+)/)?.[1] ?? "";
  const [s, c] = tamper ? tamper(state, oauth) : [state, oauth];
  current = profile;
  return get(`/api/auth/github/callback?code=abc&state=${encodeURIComponent(s)}`, {
    cookie: `${session}; kc_oauth=${c}`,
    "cf-connecting-ip": randomIp(),
  });
}

async function githubIdentity(userId: string) {
  return env.DB.prepare("SELECT subject FROM user_identities WHERE user_id = ? AND provider = 'github'")
    .bind(userId)
    .first<{ subject: string }>();
}

async function eligibility(userId: string) {
  return (
    await env.DB.prepare("SELECT community_eligible FROM users WHERE id = ?").bind(userId).first<{ community_eligible: number }>()
  )?.community_eligible;
}

describe("GitHub link: start", () => {
  it("redirects to GitHub with state, PKCE and a signed 10-minute kc_oauth cookie", async () => {
    const { cookie } = await createSession(await createUser());

    const res = await get("/api/auth/github/start", { cookie });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBeTruthy();
    expect(res.headers.get("set-cookie")).toMatch(/kc_oauth=[^;]+\.[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/api\/auth\/github; Max-Age=600/);
  });

  it("needs a session", async () => {
    expect((await get("/api/auth/github/start", {})).status).toBe(401);
  });
});

describe("GitHub link: callback", () => {
  it("rejects a wrong state, a tampered cookie and an expired cookie with 400", async () => {
    const user = await createUser();
    const expired = await signOAuthCookie("test-signing", {
      state: "s",
      verifier: "v",
      userId: user.id,
      exp: Date.now() - 1000,
      turnstile: "tok",
    });

    const wrongState = await link(user, mature(1001), (_s, c) => ["not-the-state", c]);
    const tampered = await link(user, mature(1002), (s, c) => [s, `${c.slice(0, -2)}xx`]);
    const old = await link(user, mature(1003), () => ["s", expired]);

    expect([wrongState.status, tampered.status, old.status]).toEqual([400, 400, 400]);
    expect(await githubIdentity(user.id)).toBeNull();
  });

  it("refuses a GitHub id already linked to another user with 409", async () => {
    const first = await createUser();
    const second = await createUser();
    await link(first, mature(2001));

    const res = await link(second, mature(2001));

    expect(res.status).toBe(409);
    expect(await githubIdentity(second.id)).toBeNull();
  });

  it("score < 40 → refused, nothing linked", async () => {
    const user = await createUser();

    const res = await link(user, { id: 3001, verified: false, ageDays: 0, repos: 0, contributions: 0 });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://console.test/settings?github=refused");
    expect(await githubIdentity(user.id)).toBeNull();
  });

  it("score 40–64 → linked, not community eligible", async () => {
    const user = await createUser();

    const res = await link(user, { id: 3002, verified: false, ageDays: 5, repos: 2, contributions: 30 });

    expect(res.headers.get("location")).toBe("https://console.test/settings?github=linked");
    expect((await githubIdentity(user.id))?.subject).toBe("3002");
    expect(await eligibility(user.id)).toBe(0);
  });

  it("score >= 65 with every gate → linked and community eligible", async () => {
    const user = await createUser();

    const res = await link(user, mature(3003));

    expect(res.headers.get("location")).toBe("https://console.test/settings?github=linked");
    expect(await eligibility(user.id)).toBe(1);
  });

  it("puts no token in the redirect and no postMessage in the body", async () => {
    const res = await link(await createUser(), mature(4001));

    const location = res.headers.get("location") ?? "";
    expect(location).not.toMatch(/token|gho_|code=/i);
    expect(await res.text()).not.toContain("postMessage");
    expect(res.headers.get("set-cookie")).toContain("kc_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/github; Max-Age=0");
  });
});
