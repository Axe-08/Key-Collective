import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock, SELF } from "cloudflare:test";
import { CascadeRouter } from "../../../src/router/cascade/router";
import type { Lease, LeaseAcquireContext, LeaseProvider, LeaseSettleResult } from "../../../src/router/leases/orchestrator";
import type { KeyPoolContract } from "../../../src/contracts/key_pool";
import { addProviderKey, createApiKey, createUser } from "../../helpers/world";

let scenario = "groq_ok";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  fetchMock
    .get("https://api.groq.com")
    .intercept({ path: /\/openai\/v1\/chat\/completions/, method: "POST" })
    .reply(() => {
      return {
        statusCode: 200,
        data: JSON.stringify({
          id: "chatcmpl-groq-lease-test",
          object: "chat.completion",
          created: 1700000000,
          model: "llama-3.1-8b-instant",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Hello from leased Groq!" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();

  fetchMock
    .get("https://generativelanguage.googleapis.com")
    .intercept({ path: /generateContent/, method: "POST" })
    .reply(() => {
      if (scenario === "gemini_probe_fail") {
        return {
          statusCode: 400,
          data: JSON.stringify({
            error: {
              code: 400,
              message: "Invalid model",
              status: "INVALID_ARGUMENT",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                  metadata: { consumer: "projects/987654321098" },
                },
              ],
            },
          }),
          responseOptions: { headers: { "content-type": "application/json" } },
        };
      }
      return {
        statusCode: 200,
        data: JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "Hello from leased Gemini!" }], role: "model" },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 6,
            totalTokenCount: 18,
          },
        }),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();
});

describe("CascadeRouter on leases (WP-4.1 T-4.1.5)", () => {
  it("uses LeaseProvider (acquire & settle) and never calls keyPool.getKey() when leaseProvider is configured", async () => {
    let getKeyCalled = 0;
    const forbiddenKeyPool: KeyPoolContract = {
      async getKey() {
        getKeyCalled += 1;
        throw new Error("keyPool.getKey must not be called on lease path");
      },
      async recordUsage() {},
      async recordResult() {},
      async recordStatusCode() {},
      async getKeyMetrics() {
        return { rpm: 0, circuitBreakerTripped: false, costAccumulatedMicrodollars: 0n };
      },
      async addKey() {},
      async removeKey() {},
      async listKeys() {
        return [];
      },
    };

    const acquiredProviders: string[] = [];
    const settledLeases: Array<{ leaseId: string; outcome: string; cu: number }> = [];

    const mockLeaseProvider: LeaseProvider = {
      async acquire(provider: string, _ctx: LeaseAcquireContext): Promise<Lease | null> {
        acquiredProviders.push(provider);
        return {
          leaseId: `lease_test_${provider}`,
          keyId: "gsk_direct_test_key_for_lease_router",
          source: "private",
          ownerTenantId: "usr_goog_test",
          provider,
        };
      },
      async settle(
        lease: Lease,
        outcome: string,
        _ctx: LeaseAcquireContext,
        cu?: number | bigint
      ): Promise<LeaseSettleResult> {
        settledLeases.push({
          leaseId: lease.leaseId,
          outcome,
          cu: Number(cu ?? 0),
        });
        return { settled: true, duplicate: false };
      },
    };

    const router = new CascadeRouter({
      keyPool: forbiddenKeyPool,
      leaseProvider: mockLeaseProvider,
    });

    const res = await router.route({
      modelAlias: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "ping" }],
      stream: false,
      tenantId: "usr_goog_test",
    });

    expect(getKeyCalled).toBe(0);
    expect(acquiredProviders).toEqual(["groq"]);
    expect(res.lease).toBeDefined();
    expect(res.lease?.leaseId).toBe("lease_test_groq");
    expect(settledLeases.length).toBe(1);
    expect(settledLeases[0].leaseId).toBe("lease_test_groq");
    expect(settledLeases[0].outcome).toBe("ok");
  });

  it("routes 'auto' for a Groq-only tenant directly to Groq without attempting a Gemini lease", async () => {
    scenario = "groq_ok";
    const groqTenant = await createUser({ github: false, eligible: false });
    await addProviderKey(groqTenant, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_groq_only_auto_test_key_12345",
      rpmLimit: 10,
    });
    const apiKey = await createApiKey(groqTenant);

    // Spy on the Google coordinator to ensure no Gemini lease is attempted
    const googleCoord = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:google")
    ) as unknown as {
      stats(): Promise<{ dispatchedToday: number }>;
    };
    const beforeGoogleStats = await googleCoord.stats();

    const response = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "auto",
        messages: [{ role: "user", content: "Hello auto!" }],
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      model: string;
      choices: Array<{ message: { content: string } }>;
    };
    expect(body.choices[0].message.content).toContain("Groq");
    expect(body.model).not.toContain("gemini");

    const afterGoogleStats = await googleCoord.stats();
    expect(afterGoogleStats.dispatchedToday).toBe(beforeGoogleStats.dispatchedToday);
  });
});
