/**
 * Key Collective — session identity and trust score truth (WP-F.5, QA-02, QA-03, QA-09)
 *
 * Invariants Tested:
 * 0. GET /api/session for a Google-only user lists providers ["google"], no GitHub id or
 *    username, and sybil_score null (no 95 fallback).
 * 1. GET /api/session for a GitHub-linked user lists both providers, the GitHub subject and
 *    username from user_identities, and the stored sybil_score.
 * 2. Google sign-in stores sybil_score NULL for a new Google-only user.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { createSession, createUser } from "../../helpers/world";
import { installGoogleJwks, signGoogleIdToken } from "../../helpers/google_jwt";

const workerEnv = { ...env, TENANT_QUOTA: undefined } as unknown as WorkerEnv;

function call(url: string, init: RequestInit = {}): Promise<Response> {
  return defaultMainWorker.fetch(new Request(url, init), workerEnv);
}

interface SessionBody {
  user: {
    id: string;
    providers: string[];
    github_id: string | null;
    github_username: string | null;
    sybil_score: number | null;
  };
}

async function readSession(userId: string): Promise<SessionBody> {
  const { cookie } = await createSession({ id: userId });
  const res = await call("https://console.test/api/session", { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as SessionBody;
}

beforeAll(installGoogleJwks);

describe("GET /api/session identity", () => {
  it("[0] a Google-only user has no GitHub identity and no trust score", async () => {
    const user = await createUser();
    await env.DB.prepare("UPDATE users SET sybil_score = NULL WHERE id = ?").bind(user.id).run();

    const body = await readSession(user.id);

    expect(body.user).toMatchObject({
      id: user.id,
      providers: ["google"],
      github_id: null,
      github_username: null,
      sybil_score: null,
    });
  });

  it("[0b] a Google-only user with a legacy stored score still reports null", async () => {
    const user = await createUser();
    await env.DB.prepare("UPDATE users SET sybil_score = 95 WHERE id = ?").bind(user.id).run();

    const body = await readSession(user.id);

    expect(body.user.sybil_score).toBeNull();
  });

  it("[1] a GitHub-linked user gets the GitHub subject, username and real score", async () => {
    const user = await createUser({ github: true, eligible: true });
    await env.DB.prepare("UPDATE users SET sybil_score = 73 WHERE id = ?").bind(user.id).run();
    const gh = await env.DB.prepare("SELECT subject, username FROM user_identities WHERE user_id = ? AND provider = 'github'")
      .bind(user.id)
      .first<{ subject: string; username: string }>();

    const body = await readSession(user.id);

    expect([...body.user.providers].sort()).toEqual(["github", "google"]);
    expect(body.user.github_id).toBe(gh?.subject);
    expect(body.user.github_username).toBe(gh?.username);
    expect(body.user.sybil_score).toBe(73);
  });
});

describe("Google sign-in trust score", () => {
  it("[2] a new Google-only user is stored with sybil_score NULL", async () => {
    const sub = `sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

    const res = await call("https://console.test/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: await signGoogleIdToken(sub) }),
    });

    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT sybil_score FROM users WHERE id = ?")
      .bind(`usr_goog_${sub}`)
      .first<{ sybil_score: number | null }>();
    expect(row).not.toBeNull();
    expect(row?.sybil_score).toBeNull();
  });
});
