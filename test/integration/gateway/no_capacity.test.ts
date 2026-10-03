/**
 * @file no_capacity.test.ts
 * T-F.8.2 (QA-08): when every cascade candidate fails because no lease is
 * available, the client gets 503 service_unavailable / no_capacity with a
 * Retry-After. Real upstream failures stay 502 upstream_error.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fetchMock, SELF } from "cloudflare:test";
import { addProviderKey, createApiKey, createUser } from "../../helpers/world";

interface ErrorBody {
  error: { message: string; type: string; code: string };
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get("https://api.groq.com")
    .intercept({ path: /\/openai\/v1\/chat\/completions/, method: "POST" })
    .reply(500, JSON.stringify({ error: { message: "groq is down" } }), {
      headers: { "content-type": "application/json" },
    })
    .persist();
});

function chat(apiKey: string, model: string): Promise<Response> {
  return SELF.fetch("https://api.test/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }] }),
  });
}

describe("T-F.8.2 capacity exhaustion vs upstream failure", () => {
  it("answers 503 service_unavailable / no_capacity with Retry-After when no candidate has a lease", async () => {
    const user = await createUser({ github: true, eligible: true });
    const apiKey = await createApiKey(user);

    const res = await chat(apiKey, "auto");
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(503);
    expect(body.error.type).toBe("service_unavailable");
    expect(body.error.code).toBe("no_capacity");
    const retryAfter = Number(res.headers.get("retry-after"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
  });

  it("keeps 502 upstream_error when a leased key reached the upstream and it failed", async () => {
    const user = await createUser({ github: false, eligible: false });
    await addProviderKey(user, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_no_capacity_test_upstream_fail_123456",
    });
    const apiKey = await createApiKey(user);

    const res = await chat(apiKey, "openai/gpt-oss-120b");
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(502);
    expect(body.error.type).toBe("upstream_error");
    expect(body.error.code).toBe("FALLBACK_EXHAUSTED");
  });
});
