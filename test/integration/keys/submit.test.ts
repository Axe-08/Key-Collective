/**
 * Key Collective — POST /api/keys end to end (WP-3.6, v1 1.5)
 *
 * Invariants Tested:
 * 1. Happy paths: PRIVATE Groq and COMMUNITY Gemini → 201 with api_keys, project_hash_registry
 *    (with provider) and K1/K2 attestations carrying IP and UA; COMMUNITY is OBSERVATION for 24 h;
 *    the key is pushed to the owner's KeyPoolDO.
 * 2. Every gate answers its own code.
 * 3. Atomicity: a failing attestation insert leaves no api_keys row.
 * 4. A failed KeyPoolDO push → 201 sync "pending", and the owner's pool picks the key up on load.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { KeyPoolDO, type DurableObjectStateLike } from "../../../src/durable_objects/key_pool/key_pool_do";
import { createSession, createUser } from "../../helpers/world";

interface Scenario {
  turnstile: boolean;
  /** GCP probe answer: a project number, an HTTP status with no project, or "network". */
  project: string | number;
  /** Proof-of-life status for both providers. */
  life: number;
}

let scenario: Scenario;
const pushed: Array<{ tenant: string; key: { id: string; poolType: string } }> = [];

beforeEach(() => {
  scenario = { turnstile: true, project: `${Math.floor(Math.random() * 1e12)}`, life: 200 };
  pushed.length = 0;
});

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  const json = { headers: { "content-type": "application/json" } };
  fetchMock
    .get("https://challenges.cloudflare.com")
    .intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
    .reply(200, () => JSON.stringify({ success: scenario.turnstile, "error-codes": scenario.turnstile ? [] : ["invalid-input-response"] }), json)
    .persist();
  const google = fetchMock.get("https://generativelanguage.googleapis.com");
  google
    .intercept({ path: /^\/v1beta\/models\/invalid-model/, method: "GET" })
    .reply(
      () =>
        typeof scenario.project === "number"
          ? { statusCode: scenario.project, data: JSON.stringify({ error: { code: scenario.project } }), responseOptions: json }
          : {
              statusCode: 400,
              data: JSON.stringify({
                error: {
                  details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", metadata: { consumer: `projects/${scenario.project}` } }],
                },
              }),
              responseOptions: json,
            }
    )
    .persist();
  google
    .intercept({ path: /:generateContent$/, method: "POST" })
    .reply(() => ({ statusCode: scenario.life, data: "{}", responseOptions: json }))
    .persist();
  fetchMock
    .get("https://api.groq.com")
    .intercept({ path: "/openai/v1/chat/completions", method: "POST" })
    .reply(() => ({ statusCode: scenario.life, data: "{}", responseOptions: json }))
    .persist();
});

/** A KEY_POOL namespace that records pushes (or fails them). */
function keyPool(failing = false) {
  return {
    idFromName: (name: string) => name,
    get: (tenant: string) => ({
      fetch: async (_url: string, init?: RequestInit) => {
        if (failing) throw new Error("KeyPoolDO unreachable");
        pushed.push({ tenant, key: JSON.parse(String(init?.body)).key });
        return Response.json({ ok: true });
      },
    }),
  };
}

function rateLimiter(allowed: boolean) {
  return {
    idFromName: (name: string) => name,
    get: () => ({ fetch: async () => new Response(null, { status: allowed ? 200 : 429 }) }),
  };
}

const googleKey = () => `AIza${crypto.randomUUID().replace(/-/g, "")}abc`;
const groqKey = () => `gsk_${crypto.randomUUID().replace(/-/g, "")}`;

async function submitAs(
  user: { id: string },
  body: Record<string, unknown>,
  opts: { pool?: ReturnType<typeof keyPool>; limiter?: ReturnType<typeof rateLimiter> } = {}
): Promise<Response> {
  const { cookie, csrfToken } = await createSession(user);
  const workerEnv = {
    ...env,
    TENANT_QUOTA: undefined,
    KEY_POOL: opts.pool ?? keyPool(),
    RATE_LIMITER: opts.limiter ?? rateLimiter(true),
  } as unknown as WorkerEnv;
  return defaultMainWorker.fetch(
    new Request("https://console.test/api/keys", {
      method: "POST",
      headers: {
        cookie,
        "x-kc-csrf": csrfToken,
        "x-turnstile-token": "tok",
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.50",
        "user-agent": "submit-test/1.0",
      },
      body: JSON.stringify(body),
    }),
    workerEnv
  );
}

const valid = (overrides: Record<string, unknown> = {}) => ({ provider: "groq", key: groqKey(), label: "mine", k1: true, k2: true, ...overrides });

async function keyRow(id: string) {
  return env.DB.prepare("SELECT * FROM api_keys WHERE id = ?").bind(id).first<Record<string, unknown>>();
}

describe("POST /api/keys happy paths", () => {
  it("PRIVATE Groq: 201, row, two attestations with IP/UA, pushed to the owner's pool", async () => {
    const user = await createUser();
    const plaintext = groqKey();

    const res = await submitAs(user, valid({ key: plaintext }));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; sync: string };
    expect(body.sync).toBe("ok");
    expect(JSON.stringify(body)).not.toContain(plaintext);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plaintext));
    const expectedHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(await keyRow(body.id)).toMatchObject({
      tenant_id: user.id,
      provider: "groq",
      pool_type: "PRIVATE",
      status: "HEALTHY",
      key_hash: expectedHash,
    });
    const consents = await env.DB.prepare("SELECT checkbox_id, ip_address, user_agent FROM consent_attestations WHERE key_id = ? ORDER BY checkbox_id")
      .bind(body.id)
      .all();
    expect(consents.results).toEqual([
      { checkbox_id: "K1", ip_address: "203.0.113.50", user_agent: "submit-test/1.0" },
      { checkbox_id: "K2", ip_address: "203.0.113.50", user_agent: "submit-test/1.0" },
    ]);
    expect(pushed).toEqual([{ tenant: user.id, key: expect.objectContaining({ id: body.id, poolType: "PRIVATE" }) }]);
  });

  it("COMMUNITY Gemini: registry row with provider, OBSERVATION for 24 h", async () => {
    const user = await createUser({ github: true, eligible: true });
    const before = Date.now();

    const res = await submitAs(user, valid({ provider: "google", key: googleKey(), pool_type: "COMMUNITY" }));

    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const row = await keyRow(id);
    expect(row).toMatchObject({ pool_type: "COMMUNITY", community_routing_status: "OBSERVATION" });
    expect(Number(row?.observation_until) - before).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 5000);
    const registry = await env.DB.prepare("SELECT provider, state, tenant_id FROM project_hash_registry WHERE project_hash = ?")
      .bind(row?.provider_project_hash)
      .first();
    expect(registry).toEqual({ provider: "google", state: "ACTIVE", tenant_id: user.id });
  });
});

describe("POST /api/keys gates", () => {
  it("missing K2 → 400", async () => {
    const res = await submitAs(await createUser(), valid({ k2: false }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("bad Turnstile → 403", async () => {
    scenario.turnstile = false;
    const res = await submitAs(await createUser(), valid());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "turnstile_failed" });
  });

  it("Google-only user + COMMUNITY → 403 github_link_required", async () => {
    const res = await submitAs(await createUser(), valid({ pool_type: "COMMUNITY" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "github_link_required" });
  });

  it("malformed key or unsupported provider → 400", async () => {
    const user = await createUser();
    expect((await submitAs(user, valid({ key: "gsk_short" }))).status).toBe(400);
    expect((await submitAs(user, valid({ provider: "cerebras" }))).status).toBe(400);
  });

  it("duplicate plaintext → 409 key_already_registered", async () => {
    const key = groqKey();
    await submitAs(await createUser(), valid({ key }));

    const res = await submitAs(await createUser(), valid({ key }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "key_already_registered" });
  });

  it("same GCP project from another user → 409 (AC-04)", async () => {
    scenario.project = "424242424242";
    await submitAs(await createUser(), valid({ provider: "google", key: googleKey() }));

    const res = await submitAs(await createUser(), valid({ provider: "google", key: googleKey() }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "project_already_registered" });
  });

  it("tombstoned project → 409 project_tombstoned", async () => {
    scenario.project = "313131313131";
    const first = await submitAs(await createUser(), valid({ provider: "google", key: googleKey() }));
    const { id } = (await first.json()) as { id: string };
    const row = await keyRow(id);
    await env.DB.prepare("UPDATE project_hash_registry SET state = 'TOMBSTONED', tombstone_until = ? WHERE project_hash = ?")
      .bind(Date.now() + 86_400_000, row?.provider_project_hash)
      .run();

    const res = await submitAs(await createUser(), valid({ provider: "google", key: googleKey() }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "project_tombstoned" });
  });

  it("proof of life 429 → 400 key_no_quota; 401 → 400 key_invalid; 503 → 503", async () => {
    const user = await createUser();
    scenario.life = 429;
    expect(await (await submitAs(user, valid())).json()).toMatchObject({ error: "key_no_quota" });
    scenario.life = 401;
    expect(await (await submitAs(user, valid())).json()).toMatchObject({ error: "key_invalid" });
    scenario.life = 503;
    expect((await submitAs(user, valid())).status).toBe(503);
  });

  it("probe unavailable + COMMUNITY → 422 project_unverifiable; PRIVATE is still allowed", async () => {
    scenario.project = 429;
    const eligible = await createUser({ github: true, eligible: true });

    const community = await submitAs(eligible, valid({ provider: "google", key: googleKey(), pool_type: "COMMUNITY" }));
    const priv = await submitAs(eligible, valid({ provider: "google", key: googleKey() }));

    expect(community.status).toBe(422);
    expect(await community.json()).toMatchObject({ error: "project_unverifiable" });
    expect(priv.status).toBe(201);
  });

  it("more than 10 submissions a day → 429", async () => {
    const res = await submitAs(await createUser(), valid(), { limiter: rateLimiter(false) });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "rate_limited" });
  });
});

describe("POST /api/keys writes", () => {
  it("is atomic: a failing attestation insert leaves no api_keys row", async () => {
    const user = await createUser();
    await env.DB.prepare(
      "CREATE TRIGGER fail_key_consent BEFORE INSERT ON consent_attestations WHEN NEW.checkbox_id = 'K2' BEGIN SELECT RAISE(ABORT, 'forced'); END"
    ).run();

    const res = await submitAs(user, valid());

    expect(res.status).toBeGreaterThanOrEqual(500);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE tenant_id = ?").bind(user.id).first<{ n: number }>();
    expect(n?.n).toBe(0);
    await env.DB.prepare("DROP TRIGGER fail_key_consent").run();
  });

  it("a failed KeyPoolDO push → 201 sync pending; the owner's pool loads the key and clears the flag", async () => {
    const user = await createUser();

    const res = await submitAs(user, valid(), { pool: keyPool(true) });

    expect(res.status).toBe(201);
    const { id, sync } = (await res.json()) as { id: string; sync: string };
    expect(sync).toBe("pending");
    expect((await keyRow(id))?.sync_pending).toBe(1);

    const store = new Map<string, unknown>([["keys:placeholder", []]]);
    const storage = {
      get: async (k: string) => store.get(k),
      put: async (k: string, v: unknown) => void store.set(k, v),
      delete: async (k: string) => store.delete(k),
      deleteAll: async () => store.clear(),
      list: async () => new Map(store),
    };
    const state = { id: { name: user.id, toString: () => user.id }, storage, waitUntil: () => {} };
    const pool = new KeyPoolDO(state as unknown as DurableObjectStateLike, { DB: env.DB }, { tenantId: user.id });

    expect((await pool.getKeys()).map((k) => k.id)).toContain(id);
    expect((await keyRow(id))?.sync_pending).toBe(0);
  });
});
