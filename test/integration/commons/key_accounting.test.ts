/**
 * Key Collective — Account Usage to the Key, Not the Model (WP-4.2, T-4.2.1)
 *
 * Verifies:
 * 1. Non-streaming completions write `cost_ledger.key_id` equal to the leased key's ID (`^key_`),
 *    never the model ID (`gemini-3.5-flash`).
 * 2. Streaming completions write `cost_ledger.key_id` equal to the leased key's ID (`^key_`),
 *    never the model ID.
 * 3. The key's minute counter in its owning DO (`KeyPoolDO` for PRIVATE, `PoolCoordinatorDO` for
 *    COMMUNITY) increments by exactly 1 per request in both non-streaming and streaming modes.
 * 4. `CostLedgerRepository` rejects any `keyId` that does not match `^key_`.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock, SELF } from "cloudflare:test";
import { CostLedgerRepository, InvalidCostLedgerEventError } from "../../../src/storage/repositories/cost_ledger/index";
import { clearDecryptedKeyCache } from "../../../src/worker/router/core/key_resolver";
import { addProviderKey, createApiKey, createUser } from "../../helpers/world";

type UpstreamScenario = "json_ok" | "sse_ok";
let currentScenario: UpstreamScenario = "json_ok";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  const replyHandler = () => {
    if (currentScenario === "sse_ok") {
      const sseBody = [
        'data: {"id":"chatcmpl-wp42-stream","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Streamed ok"}}]}\n\n',
        'data: {"id":"chatcmpl-wp42-stream","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":20,"completion_tokens":10,"total_tokens":30}}\n\n',
        "data: [DONE]\n\n",
      ].join("");
      return {
        statusCode: 200,
        data: sseBody,
        responseOptions: {
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        },
      };
    }

    return {
      statusCode: 200,
      data: JSON.stringify({
        id: "chatcmpl-wp42-json",
        object: "chat.completion",
        created: 1700000000,
        model: "gemini-3.5-flash",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Non-streamed ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }),
      responseOptions: {
        headers: { "content-type": "application/json" },
      },
    };
  };

  const googleOrigin = fetchMock.get("https://generativelanguage.googleapis.com");
  googleOrigin
    .intercept({ path: /.*/, method: "POST" })
    .reply(replyHandler)
    .persist();
});

beforeEach(async () => {
  currentScenario = "json_ok";
  clearDecryptedKeyCache();
  await env.DB.prepare("DELETE FROM cost_ledger").run();
  await env.DB.prepare("DELETE FROM daily_cu_rollup").run();
  await env.DB.prepare("DELETE FROM api_keys").run();
});

afterEach(() => {
  clearDecryptedKeyCache();
});

describe("WP-4.2 Account usage to the key, not the model (T-4.2.1)", () => {
  it("non-streaming and streaming completions write cost_ledger.key_id equal to the leased key id and increment DO minute counter by 1", async () => {
    const alice = await createUser({ github: true, eligible: true });
    const token = await createApiKey(alice);

    const privKey = await addProviderKey(alice, {
      provider: "google",
      pool: "PRIVATE",
      plaintext: "AIzaSyWp42PrivateKeyAccounting00000001",
      rpmLimit: 10,
      rpdLimit: 100,
    });

    const poolNs = env.KEY_POOL as unknown as DurableObjectNamespace;
    const poolStub = poolNs.get(poolNs.idFromName(alice.id)) as unknown as {
      getKeyMetrics(keyId: string): Promise<{ rpm: number }>;
    };

    // 1. Non-streaming completion
    currentScenario = "json_ok";
    const res1 = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-kc-trace-id": "req_wp42_nonstream_1",
      },
      body: JSON.stringify({
        model: "gemini-3.5-flash",
        messages: [{ role: "user", content: "Hello non-streaming" }],
        stream: false,
      }),
    });
    expect(res1.status).toBe(200);
    await res1.text();

    const row1 = await env.DB.prepare(
      "SELECT key_id, model_id FROM cost_ledger WHERE request_id = ?"
    )
      .bind("req_wp42_nonstream_1")
      .first<{ key_id: string; model_id: string }>();
    expect(row1).not.toBeNull();
    expect(row1?.key_id).toBe(privKey.id);
    expect(row1?.key_id).toMatch(/^key_/);
    expect(row1?.model_id).toBe("gemini-3.5-flash");

    const metricsAfter1 = await poolStub.getKeyMetrics(privKey.id);
    expect(metricsAfter1.rpm).toBe(1);

    // 2. Streaming completion
    currentScenario = "sse_ok";
    const res2 = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-kc-trace-id": "req_wp42_stream_2",
      },
      body: JSON.stringify({
        model: "gemini-3.5-flash",
        messages: [{ role: "user", content: "Hello streaming" }],
        stream: true,
      }),
    });
    expect(res2.status).toBe(200);
    // Consume the entire SSE stream so finalizeStream completes
    const sseText = await res2.text();
    expect(sseText).toContain("[DONE]");

    const row2 = await env.DB.prepare(
      "SELECT key_id, model_id FROM cost_ledger WHERE request_id = ?"
    )
      .bind("req_wp42_stream_2")
      .first<{ key_id: string; model_id: string }>();
    expect(row2).not.toBeNull();
    expect(row2?.key_id).toBe(privKey.id);
    expect(row2?.key_id).toMatch(/^key_/);
    expect(row2?.model_id).toBe("gemini-3.5-flash");

    const metricsAfter2 = await poolStub.getKeyMetrics(privKey.id);
    expect(metricsAfter2.rpm).toBe(2);
  });

  it("CostLedgerRepository rejects any key_id not matching ^key_", async () => {
    const repo = new CostLedgerRepository(env.DB);

    await expect(
      repo.recordEvent({
        requestId: "req_bad_model_as_key",
        tenantId: "usr_test_wp42",
        keyId: "gemini-3.5-flash",
        provider: "google",
        modelId: "gemini-3.5-flash",
        promptTokens: 10,
        completionTokens: 5,
        costCu: 100n,
        statusCode: 200,
      })
    ).rejects.toThrow(InvalidCostLedgerEventError);

    await expect(
      repo.recordBatch([
        {
          requestId: "req_bad_batch_key",
          tenantId: "usr_test_wp42",
          keyId: "openai/gpt-oss-120b",
          provider: "groq",
          modelId: "openai/gpt-oss-120b",
          promptTokens: 10,
          completionTokens: 5,
          costCu: 100n,
          statusCode: 200,
        },
      ])
    ).rejects.toThrow(InvalidCostLedgerEventError);
  });
});
