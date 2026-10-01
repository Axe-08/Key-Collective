/**
 * Key Collective — Anti-Cycling 60-Minute Tier Tests (WP-5.2 T-5.2.3 / FR-18)
 *
 * Verifies:
 * - When a contributor re-registers a key from a project that had a tombstone
 *   within the prior 24 hours, submission succeeds with api_keys.anti_cycling_until = now + 60 min.
 * - Another tenant attempting to register that tombstoned project is rejected (409 project_tombstoned).
 * - During the 60-minute window, TenantQuotaDO sets multiplier ceiling to 100 (1.00×).
 * - During the 60-minute window, TenantQuotaDO credit() accrues zero contribution bonus.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { createSession, createUser } from "../../helpers/world";
import { TenantQuotaDO, type DurableObjectStateLike } from "../../../src/quota/tenant/index";

let scenarioProject = "998877665544";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  const json = { headers: { "content-type": "application/json" } };
  fetchMock
    .get("https://challenges.cloudflare.com")
    .intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
    .reply(200, () => JSON.stringify({ success: true }), json)
    .persist();

  fetchMock
    .get("https://generativelanguage.googleapis.com")
    .intercept({ path: /^\/v1beta\/models\/invalid-model/, method: "GET" })
    .reply(
      400,
      () =>
        JSON.stringify({
          error: {
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                metadata: { consumer: `projects/${scenarioProject}` },
              },
            ],
          },
        }),
      json
    )
    .persist();

  fetchMock
    .get("https://generativelanguage.googleapis.com")
    .intercept({ path: /:generateContent$/, method: "POST" })
    .reply(200, "{}", json)
    .persist();
});

const googleKey = () => `AIza${crypto.randomUUID().replace(/-/g, "")}abc`;

function fakePool() {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async () => Response.json({ ok: true }),
    }),
  };
}

function fakeLimiter() {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async () => new Response(null, { status: 200 }),
    }),
  };
}

async function submitAs(user: { id: string }, body: Record<string, unknown>): Promise<Response> {
  const { cookie, csrfToken } = await createSession(user);
  const workerEnv = {
    ...env,
    TENANT_QUOTA: undefined,
    KEY_POOL: fakePool(),
    POOL_COORDINATOR: undefined,
    RATE_LIMITER: fakeLimiter(),
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

function createTestQuotaDO(tenantId: string): TenantQuotaDO {
  const map = new Map<string, unknown>();
  const storage = {
    get: async <T = unknown>(k: string) => map.get(k) as T | undefined,
    put: async <T = unknown>(k: string, v: T) => {
      map.set(k, JSON.parse(JSON.stringify(v)));
    },
    delete: async (k: string) => map.delete(k),
    deleteAll: async () => map.clear(),
    list: async <T = unknown>() => new Map<string, T>(),
  };
  const state: DurableObjectStateLike = {
    id: { toString: () => tenantId },
    storage,
  };
  return new TenantQuotaDO(state, env, { tenantId });
}

describe("Anti-Cycling 60-Minute Tier (WP-5.2 T-5.2.3 / FR-18)", () => {
  it("FR-18: re-registering project tombstoned in prior 24h sets anti_cycling_until, clamps multiplier to 100, and prevents credit accrual", async () => {
    const owner = await createUser({ github: true, eligible: true });
    const otherUser = await createUser({ github: true, eligible: true });

    scenarioProject = `proj-${Date.now()}`;

    // 1. First submission by owner
    const firstRes = await submitAs(owner, {
      provider: "google",
      key: googleKey(),
      k1: true,
      k2: true,
      pool_type: "COMMUNITY",
    });
    expect(firstRes.status).toBe(201);
    const { id: firstKeyId } = (await firstRes.json()) as { id: string };

    const firstRow = await env.DB.prepare(
      "SELECT provider_project_hash FROM api_keys WHERE id = ?"
    )
      .bind(firstKeyId)
      .first<{ provider_project_hash: string }>();
    const projectHash = firstRow!.provider_project_hash;

    // 2. Project gets tombstoned due to upstream revocation (simulate tombstone created 2 hours ago)
    const now = Date.now();
    await env.DB.prepare(
      "UPDATE project_hash_registry SET state = 'TOMBSTONED', tombstone_until = ?, updated_at = ? WHERE project_hash = ?"
    )
      .bind(now + 14 * 86_400_000, now - 2 * 3600_000, projectHash)
      .run();

    // 3. Different user attempting to submit this project is rejected (409 project_tombstoned)
    const otherRes = await submitAs(otherUser, {
      provider: "google",
      key: googleKey(),
      k1: true,
      k2: true,
      pool_type: "COMMUNITY",
    });
    expect(otherRes.status).toBe(409);
    expect(await otherRes.json()).toMatchObject({ error: "project_tombstoned" });

    // 4. Same owner re-submits a new key for their tombstoned project within 24h
    const reSubmitRes = await submitAs(owner, {
      provider: "google",
      key: googleKey(),
      k1: true,
      k2: true,
      pool_type: "COMMUNITY",
    });

    expect(reSubmitRes.status).toBe(201);
    const { id: newKeyId } = (await reSubmitRes.json()) as { id: string };

    // 5. Verify anti_cycling_until is set to ~ now + 60 min
    const newKeyRow = await env.DB.prepare(
      "SELECT anti_cycling_until FROM api_keys WHERE id = ?"
    )
      .bind(newKeyId)
      .first<{ anti_cycling_until: number | null }>();

    expect(newKeyRow?.anti_cycling_until).not.toBeNull();
    const antiCyclingUntil = newKeyRow!.anti_cycling_until!;
    expect(antiCyclingUntil).toBeGreaterThan(now + 50 * 60_000);
    expect(antiCyclingUntil).toBeLessThanOrEqual(now + 65 * 60_000);

    // 6. Verify TenantQuotaDO checks anti-cycling: multiplier is clamped to 100 (1.00x)
    const quotaDO = createTestQuotaDO(owner.id);
    const state = await quotaDO.getDebtStateAsync();
    expect(state.multiplierCeiling).toBe(100);

    // 7. Verify credit() during anti-cycling accrues zero contribution
    const initialContributed = BigInt(state.dailyContributedCu);
    await quotaDO.credit(50, "test-lease-anti-cycling", owner.id);
    const stateAfterCredit = await quotaDO.getDebtStateAsync();
    expect(BigInt(stateAfterCredit.dailyContributedCu)).toBe(initialContributed);
  });
});
