/**
 * WP-F.2 T-F.2.2 (RA-05): an upstream 404 (model retired or unknown) is a fact about the model,
 * not the key. It must not change key status, must not count a breaker failure, and must fall back
 * to the next candidate model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock, SELF } from "cloudflare:test";
import { addProviderKey, createApiKey, createUser } from "../../helpers/world";
import {
  GROQ_MODEL_NOT_FOUND_STATUS,
  groqModelNotFoundBody,
} from "../../helpers/provider_fixtures";

const DEAD_MODEL = "openai/gpt-oss-120b";
const groqModelsCalled: string[] = [];
let geminiCalls = 0;

function modelOf(body: string): string {
  const parsed: unknown = JSON.parse(body);
  if (parsed && typeof parsed === "object" && "model" in parsed) {
    const model = (parsed as { model: unknown }).model;
    return typeof model === "string" ? model : "";
  }
  return "";
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  fetchMock
    .get("https://api.groq.com")
    .intercept({ path: /\/openai\/v1\/chat\/completions/, method: "POST" })
    .reply((reqOpts) => {
      const bodyStr = typeof reqOpts.body === "string" ? reqOpts.body : "{}";
      const model = modelOf(bodyStr);
      groqModelsCalled.push(model);
      if (model === DEAD_MODEL) {
        return {
          statusCode: GROQ_MODEL_NOT_FOUND_STATUS,
          data: groqModelNotFoundBody(model),
          responseOptions: { headers: { "content-type": "application/json" } },
        };
      }
      return {
        statusCode: 200,
        data: JSON.stringify({
          id: "chatcmpl-next",
          object: "chat.completion",
          created: 1700000000,
          model,
          choices: [
            { index: 0, message: { role: "assistant", content: "served" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();

  fetchMock
    .get("https://generativelanguage.googleapis.com")
    .intercept({ path: /.*/, method: "POST" })
    .reply(() => {
      geminiCalls += 1;
      return {
        statusCode: 500,
        data: JSON.stringify({ error: { code: 500, status: "INTERNAL" } }),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();
});

function getKeyPoolStub(tenantId: string) {
  return env.KEY_POOL.get(env.KEY_POOL.idFromName(tenantId)) as unknown as {
    setClockForTest(ms: number): Promise<void>;
    getCircuitBreakerState(keyId: string): Promise<string>;
    getKeyById(keyId: string): Promise<{ status: string } | undefined>;
  };
}

describe("model_unavailable settle (WP-F.2 T-F.2.2)", () => {
  it("five consecutive 404s leave the key HEALTHY with its breaker closed, and the next candidate serves", async () => {
    const user = await createUser({ github: true, eligible: true });
    const privKey = await addProviderKey(user, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_ModelUnavailPrivKey0000000000001",
      rpmLimit: 50,
      rpdLimit: 1000,
    });
    const token = await createApiKey(user);

    const pool = getKeyPoolStub(user.id);
    await pool.setClockForTest(Date.UTC(2030, 6, 1, 9, 0, 0));

    for (let i = 1; i <= 5; i++) {
      const r = await SELF.fetch("https://api.test/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: DEAD_MODEL,
          messages: [{ role: "user", content: `dead model ${i}` }],
          max_fallbacks: 0,
        }),
      });
      expect(r.status).toBeGreaterThanOrEqual(500);
      await r.text();
    }
    expect(groqModelsCalled.filter((m) => m === DEAD_MODEL)).toHaveLength(5);

    // No key action and no breaker failure.
    expect(await pool.getCircuitBreakerState(privKey.id)).toBe("CLOSED");
    expect((await pool.getKeyById(privKey.id))?.status).toBe("HEALTHY");
    const row = await env.DB.prepare("SELECT status FROM api_keys WHERE id = ?")
      .bind(privKey.id)
      .first<{ status: string }>();
    expect(row?.status).toBe("HEALTHY");

    // With fallback allowed, the same key serves the next candidate model.
    const before = groqModelsCalled.length;
    const res = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: DEAD_MODEL,
        messages: [{ role: "user", content: "dead model then fallback" }],
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { model?: string };
    expect(json.model).toBeDefined();
    expect(json.model).not.toBe(DEAD_MODEL);
    const called = groqModelsCalled.slice(before);
    expect(called[0]).toBe(DEAD_MODEL);
    expect(called.length).toBeGreaterThanOrEqual(2);
    expect(called[called.length - 1]).not.toBe(DEAD_MODEL);
    expect(geminiCalls).toBe(0);
  });
});
