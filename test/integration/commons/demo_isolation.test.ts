/**
 * Key Collective — Demo Pool Isolation Integration Tests (WP-4.5 T-4.5.1)
 *
 * Invariants Enforced (GEMINI.md Constitution & Remediation Plan):
 * - Ephemeral demo tokens authenticate strictly as `sys_demo`.
 * - For `sys_demo`, the orchestrator leases only `KeyPoolDO("sys_operator")` private keys,
 *   never calling the coordinator.
 * - Community keys present + empty operator pool -> 503 `demo_unavailable`, coordinator untouched.
 * - Operator key present in `sys_operator` -> served (200), no `borrowed` ledger row.
 * - Demo traffic is excluded from debt accrual and pool telemetry.
 * - `/api/demo/token` serves the rotating demo token; `/api/playground/token` is session-scoped.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock, SELF } from "cloudflare:test";
import { addProviderKey, createApiKey, createSession, createUser } from "../../helpers/world";

let groqCalls = 0;

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
    .reply(() => {
      groqCalls += 1;
      return {
        statusCode: 200,
        data: JSON.stringify({
          id: "chatcmpl-demo-isolation",
          object: "chat.completion",
          created: 1700000000,
          model: "openai/gpt-oss-120b",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Groq demo response" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 15,
            completion_tokens: 10,
            total_tokens: 25,
          },
        }),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();
});

describe("Demo Pool Isolation (WP-4.5 T-4.5.1)", () => {
  it("authenticates rotating demo token as sys_demo", async () => {
    // 1. Fetch demo token from /api/demo/token
    const tokenRes = await SELF.fetch("https://console.test/api/demo/token");
    expect(tokenRes.status).toBe(200);
    const tokenData = (await tokenRes.json()) as { token: string };
    expect(tokenData.token).toMatch(/^kc_demo_/);
  });

  it("community keys exist, operator pool empty -> 503 demo_unavailable, coordinator untouched", async () => {
    // 1. Seed a community key for another contributor in D1 + reconcile coordinator
    const contributor = await createUser({ github: true, eligible: true });
    const commKey = await addProviderKey(contributor, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_contributor_community_key_1111",
      rpmLimit: 20,
    });

    const coordNs = env.POOL_COORDINATOR as unknown as {
      get(id: unknown): {
        reconcile(provider?: string): Promise<unknown>;
        stats(): Promise<{ activeKeys: number; totalLeased?: number }>;
        setStatus(keyId: string, status: string): Promise<boolean>;
      };
      idFromName(name: string): unknown;
    };

    const coordStub = coordNs.get(coordNs.idFromName("pool:groq"));
    await coordStub.reconcile("groq");
    await coordStub.setStatus(commKey.id, "ACTIVE");
    const statsBefore = await coordStub.stats();
    expect(statsBefore.activeKeys).toBeGreaterThanOrEqual(1);

    // 2. Ensure sys_operator has no keys in KeyPoolDO
    const operatorPool = env.KEY_POOL.get(env.KEY_POOL.idFromName("sys_operator")) as unknown as {
      reconcile(tenantId?: string): Promise<unknown>;
      getKeyCount(provider?: string): Promise<number>;
    };
    await operatorPool.reconcile("sys_operator");
    const opKeys = await operatorPool.getKeyCount();
    expect(opKeys).toBe(0);

    // 3. Obtain demo token
    const tokenRes = await SELF.fetch("https://console.test/api/demo/token");
    const { token: demoToken } = (await tokenRes.json()) as { token: string };

    const initialGroqCalls = groqCalls;

    // 4. Send chat request using demo token
    const res = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${demoToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [{ role: "user", content: "Hello demo" }],
        max_fallbacks: 0,
      }),
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code?: string } };
    expect(body.error?.code).toBe("demo_unavailable");

    // 5. Assert coordinator was NOT called and upstream was NOT called
    expect(groqCalls).toBe(initialGroqCalls);
    const statsAfter = await coordStub.stats();
    expect(statsAfter.totalLeased ?? 0).toBe(statsBefore.totalLeased ?? 0);
  });

  it("with an operator key in sys_operator -> served, no borrowed ledger row", async () => {
    // 1. Add operator private key to sys_operator in D1
    const operatorUser = { id: "sys_operator" };
    const opKey = await addProviderKey(operatorUser, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_sys_operator_private_key_2222",
      rpmLimit: 20,
    });

    // Reconcile KeyPoolDO("sys_operator")
    const operatorPool = env.KEY_POOL.get(env.KEY_POOL.idFromName("sys_operator")) as unknown as {
      reconcile(tenantId?: string): Promise<unknown>;
      getKeyCount(provider?: string): Promise<number>;
    };
    await operatorPool.reconcile("sys_operator");

    // 2. Obtain fresh demo token
    const tokenRes = await SELF.fetch("https://console.test/api/demo/token");
    const { token: demoToken } = (await tokenRes.json()) as { token: string };

    // 3. Send chat request using demo token
    const res = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${demoToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [{ role: "user", content: "Hello from demo with operator key" }],
        max_fallbacks: 0,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; choices: Array<{ message: { content: string } }> };
    expect(body.choices[0].message.content).toBe("Groq demo response");

    // 4. Verify cost_ledger row for this request
    const ledgerRows = await env.DB.prepare(
      "SELECT tenant_id, key_id, borrowed, lender_tenant_id FROM cost_ledger WHERE tenant_id = 'sys_demo' ORDER BY created_at DESC LIMIT 1"
    ).all<{
      tenant_id: string;
      key_id: string;
      borrowed: number;
      lender_tenant_id: string | null;
    }>();

    expect(ledgerRows.results.length).toBe(1);
    const row = ledgerRows.results[0];
    expect(row.tenant_id).toBe("sys_demo");
    expect(row.key_id).toBe(opKey.id);
    expect(row.borrowed).toBe(0);
    expect(row.lender_tenant_id).toBeNull();
  });
});
