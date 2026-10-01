/**
 * Key Collective — pool rights matrix (WP-3.3, T-3.3.3)
 *
 * poolRights(user, identities): privatePool needs a google identity; communityPool also needs a
 * github identity and community_eligible = 1; inactive or quarantined users get neither.
 *
 * Invariants Tested:
 * 1. The pure function, row by row.
 * 2. A Google-only user may add a PRIVATE key (201) but not a COMMUNITY key (403 github_link_required).
 * 3. An eligible Google+GitHub user may add a COMMUNITY key.
 * 4. Google-only → 403 github_link_required on /api/pool/telemetry and /api/pool/contribution;
 *    an eligible user → 200.
 * 5. Switching a key to COMMUNITY needs communityPool.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { poolRights } from "../../../src/auth/rights";
import { addProviderKey, createSession, createUser } from "../../helpers/world";

// No KEY_POOL / RATE_LIMITER: a key write would wake those DOs and break isolated storage.
const workerEnv = { ...env, TENANT_QUOTA: undefined, KEY_POOL: undefined, RATE_LIMITER: undefined } as unknown as WorkerEnv;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get("https://challenges.cloudflare.com")
    .intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
    .reply(200, JSON.stringify({ success: true, "error-codes": [] }), { headers: { "content-type": "application/json" } })
    .persist();
  // Proof of life for submitted Groq keys (WP-3.6).
  fetchMock
    .get("https://api.groq.com")
    .intercept({ path: "/openai/v1/chat/completions", method: "POST" })
    .reply(200, "{}")
    .persist();
});

async function asUser(user: { id: string }) {
  const { cookie, csrfToken } = await createSession(user);
  return (path: string, init: { method?: string; body?: unknown } = {}) =>
    defaultMainWorker.fetch(
      new Request(`https://console.test${path}`, {
        method: init.method ?? "GET",
        headers: {
          cookie,
          "x-kc-csrf": csrfToken,
          "x-turnstile-token": "tok",
          "content-type": "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
      workerEnv
    );
}

const groqKey = (pool_type: string) => ({
  provider: "groq",
  label: `${pool_type.toLowerCase()}-key`,
  key: `gsk_${crypto.randomUUID().replace(/-/g, "")}`,
  k1: true,
  k2: true,
  pool_type,
});

describe("poolRights", () => {
  const active = { registration_status: "ACTIVE", is_quarantined: 0, community_eligible: 1 };
  const google = { provider: "google" };
  const github = { provider: "github" };

  it("follows the section 2.3 matrix", () => {
    expect(poolRights(active, [google])).toEqual({ privatePool: true, communityPool: false });
    expect(poolRights(active, [google, github])).toEqual({ privatePool: true, communityPool: true });
    expect(poolRights({ ...active, community_eligible: 0 }, [google, github])).toEqual({ privatePool: true, communityPool: false });
    expect(poolRights(active, [github])).toEqual({ privatePool: false, communityPool: false });
    expect(poolRights({ ...active, registration_status: "PENDING_CONSENT" }, [google, github])).toEqual({
      privatePool: false,
      communityPool: false,
      reason: "inactive",
    });
    expect(poolRights({ ...active, is_quarantined: 1 }, [google, github])).toMatchObject({ communityPool: false, reason: "inactive" });
  });
});

describe("rights on console routes", () => {
  it("a Google-only user adds a PRIVATE key but not a COMMUNITY key", async () => {
    const call = await asUser(await createUser());

    const priv = await call("/api/keys", { method: "POST", body: groqKey("PRIVATE") });
    const comm = await call("/api/keys", { method: "POST", body: groqKey("COMMUNITY") });

    expect(priv.status).toBe(201);
    expect(comm.status).toBe(403);
    expect(await comm.json()).toEqual({ error: "github_link_required" });
  });

  it("an eligible Google+GitHub user adds a COMMUNITY key", async () => {
    const call = await asUser(await createUser({ github: true, eligible: true }));

    const res = await call("/api/keys", { method: "POST", body: groqKey("COMMUNITY") });

    expect(res.status).toBe(201);
  });

  it("linked but not eligible is still refused COMMUNITY", async () => {
    const call = await asUser(await createUser({ github: true, eligible: false }));

    const res = await call("/api/keys", { method: "POST", body: groqKey("COMMUNITY") });

    expect(res.status).toBe(403);
  });

  it("community pool views need communityPool", async () => {
    const googleOnly = await asUser(await createUser());
    const eligible = await asUser(await createUser({ github: true, eligible: true }));

    for (const path of ["/api/pool/telemetry", "/api/pool/contribution"]) {
      const denied = await googleOnly(path);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({ error: "github_link_required" });
      expect((await eligible(path)).status).toBe(200);
    }
  });

  it("switching a key to COMMUNITY needs communityPool", async () => {
    const user = await createUser();
    const key = await addProviderKey(user, { provider: "groq", pool: "PRIVATE", plaintext: "gsk_switch_probe_1234" });
    const call = await asUser(user);

    const res = await call(`/api/keys/${key.id}/pool-mode`, { method: "PATCH", body: { pool_type: "COMMUNITY" } });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "github_link_required" });
  });

  it("GET /api/session reports the caller's rights", async () => {
    const googleOnly = await asUser(await createUser());
    const eligible = await asUser(await createUser({ github: true, eligible: true }));

    expect(await (await googleOnly("/api/session")).json()).toMatchObject({ rights: { privatePool: true, communityPool: false } });
    expect(await (await eligible("/api/session")).json()).toMatchObject({ rights: { privatePool: true, communityPool: true } });
  });
});
