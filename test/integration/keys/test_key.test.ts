/**
 * Key Collective — POST /api/keys/:id/test is truthful (WP-3.8, v1 5.2)
 *
 * Invariants Tested:
 * 1. 200 / 429 / 401 / timeout from the provider map to healthy / no_quota / invalid / unavailable.
 * 2. The key's D1 status follows: HEALTHY, COOLDOWN, QUARANTINED; unavailable leaves it alone.
 * 3. A revoked key is never revived by a test.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { addProviderKey, createSession, createUser } from "../../helpers/world";

const workerEnv = { ...env, TENANT_QUOTA: undefined, KEY_POOL: undefined } as unknown as WorkerEnv;
let answer: number | "timeout" = 200;

beforeEach(() => {
  answer = 200;
});

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  const reply = () => {
    if (answer === "timeout") throw new Error("upstream timed out");
    return { statusCode: answer, data: "{}", responseOptions: { headers: { "content-type": "application/json" } } };
  };
  fetchMock.get("https://api.groq.com").intercept({ path: "/openai/v1/chat/completions", method: "POST" }).reply(reply).persist();
  fetchMock.get("https://generativelanguage.googleapis.com").intercept({ path: /:generateContent$/, method: "POST" }).reply(reply).persist();
});

async function testKey(provider = "groq", status = "HEALTHY") {
  const user = await createUser();
  const key = await addProviderKey(user, { provider, pool: "PRIVATE", plaintext: `${provider}-secret-${crypto.randomUUID()}` });
  await env.DB.prepare("UPDATE api_keys SET status = ? WHERE id = ?").bind(status, key.id).run();
  const { cookie, csrfToken } = await createSession(user);
  const res = await defaultMainWorker.fetch(
    new Request(`https://console.test/api/keys/${key.id}/test`, { method: "POST", headers: { cookie, "x-kc-csrf": csrfToken } }),
    workerEnv
  );
  const row = await env.DB.prepare("SELECT status FROM api_keys WHERE id = ?").bind(key.id).first<{ status: string }>();
  return { res, body: (await res.json()) as { ok: boolean; success: boolean; status: string; latency_ms: number }, dbStatus: row?.status };
}

describe("POST /api/keys/:id/test", () => {
  it.each([
    [200, "healthy", true, "HEALTHY"],
    [429, "no_quota", false, "COOLDOWN"],
    [401, "invalid", false, "QUARANTINED"],
  ] as const)("provider HTTP %i → %s (ok %s), D1 status %s", async (code, status, ok, dbStatus) => {
    answer = code;

    const result = await testKey("groq", "COOLDOWN");

    expect(result.res.status).toBe(200);
    expect(result.body).toMatchObject({ ok, success: ok, status });
    expect(typeof result.body.latency_ms).toBe("number");
    expect(result.dbStatus).toBe(dbStatus);
  });

  it("a timeout is 'unavailable' and leaves the key's status alone", async () => {
    answer = "timeout";

    const result = await testKey("google", "HEALTHY");

    expect(result.body).toMatchObject({ ok: false, status: "unavailable" });
    expect(result.dbStatus).toBe("HEALTHY");
  });

  it("a healthy answer does not revive a revoked key", async () => {
    const result = await testKey("groq", "REVOKED");

    expect(result.body.status).toBe("healthy");
    expect(result.dbStatus).toBe("REVOKED");
  });
});
