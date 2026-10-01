/**
 * Key Collective — Lease Integration Tests (WP-4.1, T-4.1.6)
 *
 * Covers the 8 specifications in WP-4.1:
 * 1. Order (AC-01 generalised): PRIVATE -> own COMMUNITY (no debt) -> borrowed COMMUNITY (debt accrues),
 *    asserted via `cost_ledger.borrowed` and `lender_tenant_id`.
 * 2. Global limit: U's COMMUNITY key `rpm_limit=2`; tenants A and B each send 2 requests in the same minute ->
 *    at most 2 are served by U's key and the rest go elsewhere or fail.
 * 3. Revocation visibility: revoke U's key via takedown -> the very next lease never returns it.
 * 4. Idempotency: calling `settle` twice with the same lease id changes counters and debt once.
 * 5. Concurrency: 50 parallel leases against a key with `rpm_limit=10` -> exactly 10 granted.
 * 6. `auto` for a tenant holding only a Groq key leases Groq directly without attempting Gemini.
 * 7. With `ROUTING_ENGINE=legacy`, routing works unchanged and the coordinator is never asked for a lease.
 * 8. D-21: A COMMUNITY key whose owner lacks `communityPool` is never returned by `lease(ownOnly=false)`.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock, SELF } from "cloudflare:test";
import { LeaseOrchestrator } from "../../../src/router/leases/orchestrator";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/types";
import { addProviderKey, createApiKey, createUser } from "../../helpers/world";

let scenario = "ok";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  fetchMock
    .get("https://challenges.cloudflare.com")
    .intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
    .reply(200, JSON.stringify({ success: true }), {
      headers: { "content-type": "application/json" },
    })
    .persist();

  fetchMock
    .get("https://api.groq.com")
    .intercept({ path: /\/openai\/v1\/chat\/completions/, method: "POST" })
    .reply(() => ({
      statusCode: 200,
      data: JSON.stringify({
        id: "chatcmpl-groq-lease-int",
        object: "chat.completion",
        created: 1700000000,
        model: "llama-3.3-70b-versatile",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Groq lease response" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
        },
      }),
      responseOptions: { headers: { "content-type": "application/json" } },
    }))
    .persist();

  fetchMock
    .get("https://generativelanguage.googleapis.com")
    .intercept({ path: /.*/, method: "POST" })
    .reply(() => {
      if (scenario === "err") {
        return { statusCode: 500, data: "err" };
      }
      return {
        statusCode: 200,
        data: JSON.stringify({
          id: "chatcmpl-gemini-lease-int",
          object: "chat.completion",
          created: 1700000000,
          model: "gemini-2.0-flash",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Gemini lease response" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 10,
            total_tokens: 30,
          },
        }),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();
});

function setClock(stub: unknown, ms: number): Promise<void> {
  return (stub as { setClockForTest(ms: number): Promise<void> }).setClockForTest(ms);
}

describe("Lease Integration Suite (WP-4.1 T-4.1.6)", () => {
  const t0 = Date.UTC(2030, 2, 10, 12, 0, 0);

  it("1. Order (AC-01): PRIVATE -> own COMMUNITY (no debt) -> borrowed COMMUNITY (debt accrues) recorded in cost_ledger", async () => {
    scenario = "ok";
    const tenantT = await createUser({ github: true, eligible: true });
    const tenantU = await createUser({ github: true, eligible: true });

    const privKeyT = await addProviderKey(tenantT, {
      provider: "google",
      pool: "PRIVATE",
      plaintext: "AIzaSyOrderTestPrivateKeyTenantT00000001",
      rpmLimit: 1,
      rpdLimit: 100,
    });
    const commKeyT = await addProviderKey(tenantT, {
      provider: "google",
      pool: "COMMUNITY",
      plaintext: "AIzaSyOrderTestCommKeyTenantT0000000002",
      rpmLimit: 1,
      rpdLimit: 100,
    });
    const commKeyU = await addProviderKey(tenantU, {
      provider: "google",
      pool: "COMMUNITY",
      plaintext: "AIzaSyOrderTestCommKeyTenantU0000000003",
      rpmLimit: 2,
      rpdLimit: 100,
    });

    const coord = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:google")
    ) as unknown as {
      upsertKey(input: {
        keyId: string;
        owner: string;
        provider: string;
        status: "ACTIVE";
        rpmLimit: number;
        rpdLimit: number;
      }): Promise<{ registered: boolean }>;
      removeKey(keyId: string): Promise<boolean>;
    };
    await setClock(coord, t0);
    await coord.upsertKey({
      keyId: commKeyT.id,
      owner: tenantT.id,
      provider: "google",
      status: "ACTIVE",
      rpmLimit: 1,
      rpdLimit: 100,
    });
    await coord.upsertKey({
      keyId: commKeyU.id,
      owner: tenantU.id,
      provider: "google",
      status: "ACTIVE",
      rpmLimit: 2,
      rpdLimit: 100,
    });

    const apiKeyT = await createApiKey(tenantT, { rpmLimit: 60 });

    const callChat = async (traceId: string) => {
      const res = await SELF.fetch("https://api.test/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKeyT}`,
          "content-type": "application/json",
          "x-kc-trace-id": traceId,
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Hi" }],
        }),
      });
      expect(res.status).toBe(200);
      await res.json();
    };

    const trace1 = `trace_order_1_${crypto.randomUUID().slice(0, 8)}`;
    const trace2 = `trace_order_2_${crypto.randomUUID().slice(0, 8)}`;
    const trace3 = `trace_order_3_${crypto.randomUUID().slice(0, 8)}`;

    await callChat(trace1);
    await callChat(trace2);
    await callChat(trace3);

    const row1 = await env.DB.prepare(
      "SELECT key_id, borrowed, lender_tenant_id FROM cost_ledger WHERE request_id = ?"
    )
      .bind(trace1)
      .first<{ key_id: string; borrowed: number; lender_tenant_id: string | null }>();
    const row2 = await env.DB.prepare(
      "SELECT key_id, borrowed, lender_tenant_id FROM cost_ledger WHERE request_id = ?"
    )
      .bind(trace2)
      .first<{ key_id: string; borrowed: number; lender_tenant_id: string | null }>();
    const row3 = await env.DB.prepare(
      "SELECT key_id, borrowed, lender_tenant_id FROM cost_ledger WHERE request_id = ?"
    )
      .bind(trace3)
      .first<{ key_id: string; borrowed: number; lender_tenant_id: string | null }>();

    expect(row1?.key_id).toBe(privKeyT.id);
    expect(row1?.borrowed).toBe(0);
    expect(row1?.lender_tenant_id).toBeNull();

    expect(row2?.key_id).toBe(commKeyT.id);
    expect(row2?.borrowed).toBe(0);
    expect(row2?.lender_tenant_id).toBeNull();

    expect(row3?.key_id).toBe(commKeyU.id);
    expect(row3?.borrowed).toBe(1);
    expect(row3?.lender_tenant_id).toBe(tenantU.id);

    await coord.removeKey(commKeyT.id);
    await coord.removeKey(commKeyU.id);
  });

  it("2. Global limit: U's COMMUNITY key rpm_limit=2 shared across tenants A and B grants at most 2 in the same minute", async () => {
    const tenantU = await createUser({ github: true, eligible: true });
    const tenantA = await createUser({ github: true, eligible: true });
    const tenantB = await createUser({ github: true, eligible: true });

    const commKeyU = await addProviderKey(tenantU, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_global_limit_key_u_rpm2_test_0001",
      rpmLimit: 2,
      rpdLimit: 100,
    });

    const coord = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:groq")
    ) as unknown as {
      upsertKey(input: {
        keyId: string;
        owner: string;
        provider: string;
        status: "ACTIVE";
        rpmLimit: number;
        rpdLimit: number;
      }): Promise<{ registered: boolean }>;
      removeKey(keyId: string): Promise<boolean>;
    };
    await setClock(coord, t0);
    await coord.upsertKey({
      keyId: commKeyU.id,
      owner: tenantU.id,
      provider: "groq",
      status: "ACTIVE",
      rpmLimit: 2,
      rpdLimit: 100,
    });

    const orchestrator = new LeaseOrchestrator();
    const ctxA = { tenantId: tenantA.id, env: env as unknown as WorkerEnv, estimateCu: 10 };
    const ctxB = { tenantId: tenantB.id, env: env as unknown as WorkerEnv, estimateCu: 10 };

    const lA1 = await orchestrator.acquire("groq", ctxA);
    const lB1 = await orchestrator.acquire("groq", ctxB);
    const lA2 = await orchestrator.acquire("groq", ctxA);
    const lB2 = await orchestrator.acquire("groq", ctxB);

    const granted = [lA1, lB1, lA2, lB2].filter((l) => l !== null);
    expect(granted.length).toBe(2);
    expect(granted.every((l) => l?.keyId === commKeyU.id)).toBe(true);

    await coord.removeKey(commKeyU.id);
  });

  it("3. Revocation visibility: revoking U's key via abuse takedown removes it before the very next lease", async () => {
    const tenantU = await createUser({ github: true, eligible: true });
    const tenantA = await createUser({ github: true, eligible: true });
    const rawPlaintext = "gsk_revocation_visibility_test_key_99999";

    const commKeyU = await addProviderKey(tenantU, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: rawPlaintext,
      rpmLimit: 10,
      rpdLimit: 100,
    });

    // Store key_hash on the D1 row so abuse takedown can match it
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawPlaintext)
    );
    const keyHashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await env.DB.prepare("UPDATE api_keys SET key_hash = ? WHERE id = ?")
      .bind(keyHashHex, commKeyU.id)
      .run();

    const coord = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:groq")
    ) as unknown as {
      upsertKey(input: {
        keyId: string;
        owner: string;
        provider: string;
        status: "ACTIVE";
        rpmLimit: number;
        rpdLimit: number;
      }): Promise<{ registered: boolean }>;
    };
    await setClock(coord, t0);
    await coord.upsertKey({
      keyId: commKeyU.id,
      owner: tenantU.id,
      provider: "groq",
      status: "ACTIVE",
      rpmLimit: 10,
      rpdLimit: 100,
    });

    const orchestrator = new LeaseOrchestrator();
    const ctxA = { tenantId: tenantA.id, env: env as unknown as WorkerEnv, estimateCu: 10 };

    const beforeRevoke = await orchestrator.acquire("groq", ctxA);
    expect(beforeRevoke?.keyId).toBe(commKeyU.id);

    // Trigger abuse takedown
    const reportRes = await SELF.fetch("https://console.test/api/abuse/report-key", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-turnstile-token": "valid-turnstile-token",
      },
      body: JSON.stringify({ leaked_key: rawPlaintext }),
    });
    expect(reportRes.status).toBe(200);
    await reportRes.json();

    const afterRevoke = await orchestrator.acquire("groq", ctxA);
    expect(afterRevoke).toBeNull();
  });

  it("4. Idempotency: calling settle twice with the same leaseId updates counters and debt once", async () => {
    const tenantU = await createUser({ github: true, eligible: true });
    const tenantA = await createUser({ github: true, eligible: true });

    const commKeyU = await addProviderKey(tenantU, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_idempotent_settle_test_key_00004",
      rpmLimit: 10,
      rpdLimit: 100,
    });

    const coord = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:groq")
    ) as unknown as {
      upsertKey(input: {
        keyId: string;
        owner: string;
        provider: string;
        status: "ACTIVE";
        rpmLimit: number;
        rpdLimit: number;
      }): Promise<{ registered: boolean }>;
      stats(): Promise<{ borrowerCuInWindow: number }>;
      removeKey(keyId: string): Promise<boolean>;
    };
    await setClock(coord, t0);
    await coord.upsertKey({
      keyId: commKeyU.id,
      owner: tenantU.id,
      provider: "groq",
      status: "ACTIVE",
      rpmLimit: 10,
      rpdLimit: 100,
    });

    const orchestrator = new LeaseOrchestrator();
    const ctxA = { tenantId: tenantA.id, env: env as unknown as WorkerEnv, estimateCu: 50 };

    const lease = await orchestrator.acquire("groq", ctxA);
    expect(lease).not.toBeNull();

    const statsBefore = await coord.stats();
    const first = await orchestrator.settle(lease!, "ok", ctxA, 50n);
    const second = await orchestrator.settle(lease!, "ok", ctxA, 50n);
    const statsAfter = await coord.stats();

    expect(first.settled).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(second.settled).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(statsAfter.borrowerCuInWindow - statsBefore.borrowerCuInWindow).toBe(50);

    const quotaA = env.TENANT_QUOTA.get(env.TENANT_QUOTA.idFromName(tenantA.id)) as unknown as {
      getDebtState(): Promise<{ communityDebtCu: string }>;
    };
    await setClock(quotaA, t0);
    const debtA = await quotaA.getDebtState();
    expect(debtA.communityDebtCu).toBe("50");

    await coord.removeKey(commKeyU.id);
  });

  it("5. Concurrency: 50 parallel leases against a key with rpm_limit=10 grants exactly 10", async () => {
    const tenantU = await createUser({ github: true, eligible: true });
    const tenantA = await createUser({ github: true, eligible: true });

    const commKeyU = await addProviderKey(tenantU, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_concurrency_50_parallel_rpm10_005",
      rpmLimit: 10,
      rpdLimit: 1000,
    });

    const coord = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:groq")
    ) as unknown as {
      upsertKey(input: {
        keyId: string;
        owner: string;
        provider: string;
        status: "ACTIVE";
        rpmLimit: number;
        rpdLimit: number;
      }): Promise<{ registered: boolean }>;
      removeKey(keyId: string): Promise<boolean>;
    };
    await setClock(coord, t0);
    await coord.upsertKey({
      keyId: commKeyU.id,
      owner: tenantU.id,
      provider: "groq",
      status: "ACTIVE",
      rpmLimit: 10,
      rpdLimit: 1000,
    });

    const orchestrator = new LeaseOrchestrator();
    const ctxA = { tenantId: tenantA.id, env: env as unknown as WorkerEnv, estimateCu: 10 };

    const results = await Promise.all(
      Array.from({ length: 50 }, () => orchestrator.acquire("groq", ctxA))
    );
    const granted = results.filter((r) => r !== null);
    expect(granted.length).toBe(10);

    await coord.removeKey(commKeyU.id);
  });

  it("6. 'auto' for a tenant holding only a Groq key leases Groq directly without attempting Gemini", async () => {
    const groqOwner = await createUser({ github: false, eligible: false });
    await addProviderKey(groqOwner, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_auto_groq_only_tenant_key_000006",
      rpmLimit: 10,
    });
    const token = await createApiKey(groqOwner);

    const googleCoord = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:google")
    ) as unknown as {
      stats(): Promise<{ dispatchedToday: number }>;
    };
    const beforeStats = await googleCoord.stats();

    const res = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "auto",
        messages: [{ role: "user", content: "Hello!" }],
      }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { model: string };
    expect(data.model).not.toContain("gemini");

    const afterStats = await googleCoord.stats();
    expect(afterStats.dispatchedToday).toBe(beforeStats.dispatchedToday);
  });

  it("7. With ROUTING_ENGINE=legacy, routing passes unchanged and coordinator is never asked for a lease", async () => {
    const legacyUser = await createUser({ github: true, eligible: true });
    const privKey = await addProviderKey(legacyUser, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_legacy_engine_test_key_00000007",
      rpmLimit: 10,
    });
    const token = await createApiKey(legacyUser);

    let coordCalled = false;
    const legacyEnv: WorkerEnv = {
      ...(env as unknown as WorkerEnv),
      ROUTING_ENGINE: "legacy",
      POOL_COORDINATOR: {
        idFromName: () => {
          coordCalled = true;
          throw new Error("Coordinator must not be called when ROUTING_ENGINE=legacy");
        },
        get: () => {
          coordCalled = true;
          throw new Error("Coordinator must not be called when ROUTING_ENGINE=legacy");
        },
      } as unknown as DurableObjectNamespace,
    };

    const req = new Request("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Legacy check" }],
      }),
    });

    const res = await defaultMainWorker.fetch(req, legacyEnv);
    expect(res.status).toBe(200);
    await res.json();
    expect(coordCalled).toBe(false);
    expect(privKey.id).toMatch(/^key_/);
  });

  it("8. D-21: A COMMUNITY key whose owner lacks communityPool is never returned by lease(ownOnly=false)", async () => {
    const ineligibleOwner = await createUser({ github: false, eligible: false });
    const eligibleBorrower = await createUser({ github: true, eligible: true });

    // Seed a stranded COMMUNITY key in D1 owned by a Google-only user
    await env.DB.prepare(
      `INSERT INTO api_keys (
         id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
         key_prefix, key_suffix, rpm_limit, rpd_limit, priority, pool_type,
         status, community_routing_status, created_at
       ) VALUES (?, ?, 'stranded', 'groq', 'Y2lwaGVy', 'bm9uY2UxMjM0NTY=', 'gsk_', '0008', 10, 100, 0, 'COMMUNITY', 'HEALTHY', 'ACTIVE', ?)`
    )
      .bind("key_stranded_d21_leases_08", ineligibleOwner.id, t0)
      .run();

    const coord = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:groq")
    ) as unknown as {
      reconcile(provider?: string): Promise<{ upserted: number; removed: number }>;
      lease(req: {
        tenant: string;
        ownOnly: boolean;
        provider: string;
      }): Promise<{ keyId: string } | null>;
    };
    await setClock(coord, t0);
    await coord.reconcile("groq");

    const borrowed = await coord.lease({
      tenant: eligibleBorrower.id,
      ownOnly: false,
      provider: "groq",
    });
    expect(borrowed).toBeNull();
  });
});
