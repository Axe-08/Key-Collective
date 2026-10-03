/**
 * T-F.1.2 (RA-02): a chat request must not send x-kc-* or x-tenant-id to the provider.
 * fetchMock captures the outgoing upstream request headers.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, fetchMock, SELF } from "cloudflare:test";
import { clearDecryptedKeyCache } from "../../../src/worker/router/core/key_resolver";
import { addProviderKey, createApiKey, createUser } from "../../helpers/world";

let captured: Record<string, string>[] = [];

function headerRecord(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw instanceof Headers) {
    raw.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
  } else if (Array.isArray(raw)) {
    for (let i = 0; i + 1 < raw.length; i += 2) {
      out[String(raw[i]).toLowerCase()] = String(raw[i + 1]);
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[k.toLowerCase()] = String(v);
    }
  }
  return out;
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get("https://generativelanguage.googleapis.com")
    .intercept({ path: /.*/, method: "POST" })
    .reply((opts) => {
      captured.push(headerRecord(opts.headers));
      return {
        statusCode: 200,
        data: JSON.stringify({
          id: "chatcmpl-ra02",
          object: "chat.completion",
          created: 1700000000,
          model: "gemini-2.0-flash",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();
});

beforeEach(() => {
  captured = [];
  clearDecryptedKeyCache();
});

afterEach(() => {
  clearDecryptedKeyCache();
});

describe("no internal headers upstream (T-F.1.2, RA-02)", () => {
  it("strips x-kc-* and x-tenant-id from the provider request", async () => {
    const user = await createUser({ github: true, eligible: true });
    const token = await createApiKey(user);
    await addProviderKey(user, {
      provider: "google",
      pool: "PRIVATE",
      plaintext: "AIzaSyRa02HeaderLeakPrivateKey00000001",
      rpmLimit: 10,
      rpdLimit: 100,
    });

    const res = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-kc-trace-id": "trace_ra02",
      },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(captured.length).toBeGreaterThan(0);
    for (const h of captured) {
      const names = Object.keys(h);
      expect(names.filter((n) => n.startsWith("x-kc-"))).toEqual([]);
      expect(names).not.toContain("x-tenant-id");
      expect(Object.values(h)).not.toContain(user.id);
    }
    await env.DB.prepare("DELETE FROM api_keys WHERE tenant_id = ?").bind(user.id).run();
  });
});
