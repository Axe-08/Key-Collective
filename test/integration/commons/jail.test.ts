/**
 * Key Collective — Quota Jail Enforcement (WP-5.12 T-5.12.3, AC-03)
 *
 * Verifies:
 * 1. AC-03 (`enforce` mode): Tenant with debt 101 and contributed_24h 100 (HARD_JAIL) whose own
 *    keys are exhausted receives HTTP 429 with the PRD Flow F `quota_jail` JSON body.
 * 2. In `enforce` mode, a HARD_JAIL tenant with an available own key is still served via ownOnly=true.
 * 3. In `observe` mode, the HARD_JAIL tenant with exhausted own keys is served from borrowed keys,
 *    the response carries `x-kc-commons-notice: quota_jail`, and one `would_deny` event for `jail`
 *    is recorded.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock, runInDurableObject } from "cloudflare:test";
import { PoolCoordinatorDO } from "../../../src/pool/coordinator_do";
import { TenantQuotaDO } from "../../../src/quota/tenant/tenant_do";
import {
  clearWouldDenyEventsForTest,
  getWouldDenyStats,
} from "../../../src/pool/enforcement";
import { MainWorker } from "../../../src/worker/gateway/main_worker";
import { clearDecryptedKeyCache } from "../../../src/worker/router/core/key_resolver";
import { addProviderKey, createApiKey, createUser } from "../../helpers/world";

function getCoordinatorStub(name: string): DurableObjectStub {
  return env.POOL_COORDINATOR.get(env.POOL_COORDINATOR.idFromName(name));
}

function getTenantQuotaStub(tenantId: string): DurableObjectStub {
  return env.TENANT_QUOTA.get(env.TENANT_QUOTA.idFromName(tenantId));
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  const googleOrigin = fetchMock.get("https://generativelanguage.googleapis.com");
  googleOrigin
    .intercept({ path: /.*/, method: "POST" })
    .reply(() => ({
      statusCode: 200,
      data: JSON.stringify({
        id: "chatcmpl-wp512-jail",
        object: "chat.completion",
        created: 1700000000,
        model: "gemini-3.5-flash",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Served ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      responseOptions: {
        headers: { "content-type": "application/json" },
      },
    }))
    .persist();
});

beforeEach(async () => {
  clearWouldDenyEventsForTest();
  clearDecryptedKeyCache();
  await env.DB.prepare("DELETE FROM cost_ledger").run();
  await env.DB.prepare("DELETE FROM api_keys").run();
});

afterEach(() => {
  clearDecryptedKeyCache();
});

describe("Quota jail enforcement (WP-5.12 T-5.12.3)", () => {
  it("AC-03: debt 101, contributed 100, own keys exhausted -> 429 quota_jail PRD Flow F body in enforce mode", async () => {
    const borrower = await createUser({ github: true, eligible: true });
    const lender = await createUser({ github: true, eligible: true });
    const borrowerToken = await createApiKey(borrower);

    // Borrower has an own community key so eye_for_eye is satisfied, but it is in COOLDOWN (exhausted)
    const borrowerKey = await addProviderKey(borrower, {
      provider: "google",
      pool: "COMMUNITY",
      plaintext: "AIzaSyJailBorrowerOwnExhaustedKey0001",
      rpmLimit: 500,
      rpdLimit: 1000,
    });
    const lenderKey = await addProviderKey(lender, {
      provider: "google",
      pool: "COMMUNITY",
      plaintext: "AIzaSyJailLenderAvailableCommKey00002",
      rpmLimit: 500,
      rpdLimit: 1000,
    });

    const googleStub = getCoordinatorStub("pool:google");
    await runInDurableObject(googleStub, async (coord: PoolCoordinatorDO) => {
      coord.setEnvForTest({ COMMONS_ENFORCEMENT: "enforce" });
      await coord.upsertKey({
        keyId: borrowerKey.id,
        owner: borrower.id,
        provider: "google",
        status: "COOLDOWN",
        cooldownUntil: Date.now() + 600_000,
        rpmLimit: 500,
        rpdLimit: 1000,
      });
      await coord.upsertKey({
        keyId: lenderKey.id,
        owner: lender.id,
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 1000,
      });
    });

    // Seed borrower standing: contributed 100 CU in trailing 24h, then accrued 101 CU debt -> HARD_JAIL
    const quotaStub = getTenantQuotaStub(borrower.id);
    await runInDurableObject(quotaStub, async (quota: TenantQuotaDO) => {
      await quota.credit(100n, "lease_contrib_100", borrower.id);
      await quota.accrueDebt(101n, "lease_debt_101", borrower.id);
      const standing = await quota.standing(borrower.id);
      expect(standing.jailStatus).toBe("HARD_JAIL");
      expect(standing.communityDebtCu).toBe("101");
      expect(standing.contributedCu24h).toBe("100");
      expect(standing.multiplierPct).toBe(100);
    });

    const worker = new MainWorker();
    const req = new Request("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${borrowerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.5-flash",
        messages: [{ role: "user", content: "Test AC-03 quota jail" }],
        stream: false,
      }),
    });

    const res = await worker.fetch(req, {
      ...env,
      COMMONS_ENFORCEMENT: "enforce",
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as {
      error: {
        type: string;
        code: string;
        message: string;
        community_debt_cu: number;
        contributed_cu_24h: number;
        multiplier: string;
        recovery: { debt_decay: string; estimated_days: number };
      };
    };

    expect(body).toEqual({
      error: {
        type: "quota_jail",
        code: "quota_jail",
        message: "Community debt limit reached. Only your own keys are available.",
        community_debt_cu: 101,
        contributed_cu_24h: 100,
        multiplier: "1.00x",
        recovery: {
          debt_decay: "20% per day at 00:00 UTC",
          estimated_days: 1,
        },
      },
    });
  });

  it("HARD_JAIL tenant with an available own key is still served via ownOnly=true in enforce mode", async () => {
    const borrower = await createUser({ github: true, eligible: true });
    const borrowerToken = await createApiKey(borrower);

    const ownKey = await addProviderKey(borrower, {
      provider: "google",
      pool: "COMMUNITY",
      plaintext: "AIzaSyJailBorrowerOwnAvailableKey0003",
      rpmLimit: 500,
      rpdLimit: 1000,
    });

    const googleStub = getCoordinatorStub("pool:google");
    await runInDurableObject(googleStub, async (coord: PoolCoordinatorDO) => {
      coord.setEnvForTest({ COMMONS_ENFORCEMENT: "enforce" });
      await coord.upsertKey({
        keyId: ownKey.id,
        owner: borrower.id,
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 1000,
      });
    });

    const quotaStub = getTenantQuotaStub(borrower.id);
    await runInDurableObject(quotaStub, async (quota: TenantQuotaDO) => {
      await quota.credit(100n, "lease_own_contrib_100", borrower.id);
      await quota.accrueDebt(150n, "lease_own_debt_150", borrower.id);
    });

    const worker = new MainWorker();
    const req = new Request("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${borrowerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.5-flash",
        messages: [{ role: "user", content: "Own key should still work in jail" }],
        stream: false,
      }),
    });

    const res = await worker.fetch(req, {
      ...env,
      COMMONS_ENFORCEMENT: "enforce",
    });

    expect(res.status).toBe(200);
  });

  it("in observe mode serves HARD_JAIL tenant from borrowed keys with x-kc-commons-notice: quota_jail and records one would_deny for jail", async () => {
    const borrower = await createUser({ github: true, eligible: true });
    const lender = await createUser({ github: true, eligible: true });
    const borrowerToken = await createApiKey(borrower);

    const borrowerKey = await addProviderKey(borrower, {
      provider: "google",
      pool: "COMMUNITY",
      plaintext: "AIzaSyJailObserveBorrowerExhausted004",
      rpmLimit: 500,
      rpdLimit: 1000,
    });
    const lenderKey = await addProviderKey(lender, {
      provider: "google",
      pool: "COMMUNITY",
      plaintext: "AIzaSyJailObserveLenderAvailable00005",
      rpmLimit: 500,
      rpdLimit: 1000,
    });

    const googleStub = getCoordinatorStub("pool:google");
    await runInDurableObject(googleStub, async (coord: PoolCoordinatorDO) => {
      coord.setEnvForTest({ COMMONS_ENFORCEMENT: "observe" });
      await coord.upsertKey({
        keyId: borrowerKey.id,
        owner: borrower.id,
        provider: "google",
        status: "COOLDOWN",
        cooldownUntil: Date.now() + 600_000,
        rpmLimit: 500,
        rpdLimit: 1000,
      });
      await coord.upsertKey({
        keyId: lenderKey.id,
        owner: lender.id,
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 500,
        rpdLimit: 1000,
      });
    });

    const quotaStub = getTenantQuotaStub(borrower.id);
    await runInDurableObject(quotaStub, async (quota: TenantQuotaDO) => {
      await quota.credit(100n, "lease_obs_contrib_100", borrower.id);
      await quota.accrueDebt(101n, "lease_obs_debt_101", borrower.id);
    });

    clearWouldDenyEventsForTest();

    const worker = new MainWorker();
    const req = new Request("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${borrowerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.5-flash",
        messages: [{ role: "user", content: "Observe mode quota jail test" }],
        stream: false,
      }),
    });

    const res = await worker.fetch(req, {
      ...env,
      COMMONS_ENFORCEMENT: "observe",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-kc-commons-notice")).toBe("quota_jail");

    const stats = getWouldDenyStats(24);
    expect(stats.rules.jail).toBe(1);
    expect(stats.total).toBe(1);
  });
});
