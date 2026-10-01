import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock, SELF } from "cloudflare:test";
import { addProviderKey, createApiKey, createUser } from "../../helpers/world";

let groqStep: () => {
  statusCode: number;
  data: string;
  headers?: Record<string, string>;
} = () => ({
  statusCode: 200,
  data: JSON.stringify({
    id: "chatcmpl-ok",
    object: "chat.completion",
    created: 1700000000,
    model: "llama-3.1-8b-instant",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }),
});

let geminiStep: () => {
  statusCode: number;
  data: string;
  headers?: Record<string, string>;
} = () => ({
  statusCode: 200,
  data: JSON.stringify({
    candidates: [
      {
        content: { parts: [{ text: "ok from gemini" }], role: "model" },
        finishReason: "STOP",
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    },
  }),
});

let groqCallCount = 0;
let geminiCallCount = 0;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  fetchMock
    .get("https://api.groq.com")
    .intercept({ path: /\/openai\/v1\/chat\/completions/, method: "POST" })
    .reply((reqOpts) => {
      const bodyStr = typeof reqOpts.body === "string" ? reqOpts.body : "";
      if (bodyStr.includes('"max_tokens":1')) {
        return {
          statusCode: 200,
          data: JSON.stringify({
            id: "chatcmpl-probe",
            choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
          }),
          responseOptions: { headers: { "content-type": "application/json" } },
        };
      }
      groqCallCount += 1;
      const step = groqStep();
      return {
        statusCode: step.statusCode,
        data: step.data,
        responseOptions: {
          headers: {
            "content-type": "application/json",
            ...(step.headers ?? {}),
          },
        },
      };
    })
    .persist();

  fetchMock
    .get("https://generativelanguage.googleapis.com")
    .intercept({ path: /.*/, method: "POST" })
    .reply((reqOpts) => {
      const pathStr = String(reqOpts.path ?? "");
      const bodyStr = typeof reqOpts.body === "string" ? reqOpts.body : "";
      // GCP probe: invalid-model?key=... returns 400 with project info
      if (pathStr.includes("invalid-model") || pathStr.includes("__kc_probe__")) {
        return {
          statusCode: 400,
          data: JSON.stringify({
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                  metadata: { consumer: `projects/${Math.floor(100000000 + Math.random() * 900000000)}` },
                },
              ],
            },
          }),
          responseOptions: { headers: { "content-type": "application/json" } },
        };
      }
      // Proof-of-life probe: maxOutputTokens:1 → quick 200
      if (bodyStr.includes('"maxOutputTokens":1')) {
        return {
          statusCode: 200,
          data: JSON.stringify({
            candidates: [{ content: { parts: [{ text: "ok" }], role: "model" } }],
          }),
          responseOptions: { headers: { "content-type": "application/json" } },
        };
      }
      geminiCallCount += 1;
      const step = geminiStep();
      return {
        statusCode: step.statusCode,
        data: step.data,
        responseOptions: {
          headers: {
            "content-type": "application/json",
            ...(step.headers ?? {}),
          },
        },
      };
    })
    .persist();
});

function getKeyPoolStub(tenantId: string) {
  return env.KEY_POOL.get(env.KEY_POOL.idFromName(tenantId)) as unknown as {
    setClockForTest(ms: number): Promise<void>;
    leasePrivate(provider: string, estimateCu?: number, tenantId?: string): Promise<{ leaseId: string; keyId: string } | null>;
  };
}

function getCoordinatorStub(provider: "google" | "groq") {
  return env.POOL_COORDINATOR.get(
    env.POOL_COORDINATOR.idFromName(`pool:${provider}`)
  ) as unknown as {
    setClockForTest(ms: number): Promise<void>;
    reconcile(provider?: string): Promise<{ upserted: number; removed: number }>;
    setStatus(keyId: string, status: string, until?: number | null): Promise<boolean>;
    lease(req: { tenant: string; ownOnly: boolean; estimateCu?: number }): Promise<{ leaseId: string; keyId: string } | null>;
  };
}

describe("Upstream outcomes & settle state transitions (WP-4.3 T-4.3.2)", () => {
  it("400 request_error returns 400 (sanitised) and does NOT trigger fallback to the next candidate", async () => {
    const user = await createUser({ github: true, eligible: true });
    await addProviderKey(user, {
      provider: "google",
      pool: "PRIVATE",
      plaintext: "AIzaSyOut400GooglePrivKey000000000000001",
    });
    await addProviderKey(user, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_Out400GroqPrivKey00000000000000001",
    });
    const token = await createApiKey(user);

    geminiCallCount = 0;
    groqCallCount = 0;
    geminiStep = () => ({
      statusCode: 400,
      data: JSON.stringify({
        error: {
          code: 400,
          message: "Invalid argument for AIzaSyOut400GooglePrivKey000000000000001",
          status: "INVALID_ARGUMENT",
        },
      }),
    });

    const res = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "auto",
        messages: [{ role: "user", content: "Trigger 400" }],
      }),
    });

    expect(res.status).toBe(400);
    const bodyTxt = await res.text();
    expect(bodyTxt).not.toContain("AIzaSyOut400GooglePrivKey000000000000001");
    // Must stop after the first candidate and never fall back to subsequent candidates
    expect(geminiCallCount).toBe(1);
    expect(groqCallCount).toBe(0);
  });

  it("401 / 403 key_invalid quarantines a COMMUNITY key in Coordinator and updates D1 status + status_changed_at", async () => {
    const user = await createUser({ github: true, eligible: true });
    const commKey = await addProviderKey(user, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_Out401CommGroqKey00000000000000001",
    });
    const token = await createApiKey(user);

    const coord = getCoordinatorStub("groq");
    const t0 = Date.UTC(2030, 5, 1, 10, 0, 0);
    await coord.setClockForTest(t0);
    await coord.reconcile("groq");
    await coord.setStatus(commKey.id, "ACTIVE");

    groqStep = () => ({
      statusCode: 401,
      data: JSON.stringify({ error: { message: "Invalid API Key" } }),
    });

    const res = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Trigger 401" }],
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(500);

    // Key must be QUARANTINED in Coordinator (not leaseable) and in D1
    expect(await coord.lease({ tenant: user.id, ownOnly: true })).toBeNull();

    const row = await env.DB.prepare(
      "SELECT status, status_changed_at FROM api_keys WHERE id = ?"
    )
      .bind(commKey.id)
      .first<{ status: string; status_changed_at: number | null }>();
    expect(row?.status).toBe("QUARANTINED");
    expect(row?.status_changed_at).toBe(t0);
  });

  it("429 rpd_exhausted (Groq remaining=0, reset>1h) puts key into COOLDOWN in D1 + DO, and recovers to HEALTHY in D1 on subsequent 200 ok", async () => {
    const user = await createUser({ github: true, eligible: true });
    const privKey = await addProviderKey(user, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_Out429RpdPrivKey000000000000000001",
    });
    const token = await createApiKey(user);

    const pool = getKeyPoolStub(user.id);
    const t0 = Date.UTC(2030, 5, 2, 12, 0, 0);
    await pool.setClockForTest(t0);

    groqStep = () => ({
      statusCode: 429,
      headers: {
        "x-ratelimit-remaining-requests": "0",
        "x-ratelimit-reset-requests": "2h0m0s",
      },
      data: JSON.stringify({ error: { message: "Rate limit reached for RPD" } }),
    });

    const res1 = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Trigger RPD 429" }],
      }),
    });
    expect(res1.status).toBeGreaterThanOrEqual(500);

    const rowCooldown = await env.DB.prepare(
      "SELECT status, status_changed_at FROM api_keys WHERE id = ?"
    )
      .bind(privKey.id)
      .first<{ status: string; status_changed_at: number | null }>();
    expect(rowCooldown?.status).toBe("COOLDOWN");
    expect(rowCooldown?.status_changed_at).toBe(t0);

    // During the 2h cooldown, key cannot be leased
    expect(await pool.leasePrivate("groq", 10, user.id)).toBeNull();

    // Advance test clock past 2h cooldown -> next 200 ok recovers D1 status to HEALTHY
    const tRecovered = t0 + 2 * 3600 * 1000 + 5_000;
    await pool.setClockForTest(tRecovered);
    groqStep = () => ({
      statusCode: 200,
      data: JSON.stringify({
        id: "chatcmpl-recovered",
        object: "chat.completion",
        created: 1700000000,
        model: "llama-3.3-70b-versatile",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "recovered!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      }),
    });

    const res2 = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "After cooldown" }],
      }),
    });
    expect(res2.status).toBe(200);

    const rowHealthy = await env.DB.prepare(
      "SELECT status, status_changed_at FROM api_keys WHERE id = ?"
    )
      .bind(privKey.id)
      .first<{ status: string; status_changed_at: number | null }>();
    expect(rowHealthy?.status).toBe("HEALTHY");
    expect(rowHealthy?.status_changed_at).toBe(tRecovered);
  });

  it("circuit breaker opens on the 5th consecutive 5xx and half-opens after 60s of test clock", async () => {
    const user = await createUser({ github: true, eligible: true });
    const privKey = await addProviderKey(user, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_Out5xxBreakerPrivKey00000000000001",
      rpmLimit: 50,
      rpdLimit: 1000,
    });
    const token = await createApiKey(user);

    const pool = getKeyPoolStub(user.id);
    const t0 = Date.UTC(2030, 5, 3, 14, 0, 0);
    await pool.setClockForTest(t0);

    groqStep = () => ({
      statusCode: 503,
      data: JSON.stringify({ error: { message: "Backend unavailable" } }),
    });

    // Send 4 requests that fail with 503 (max_fallbacks: 0 ensures exactly 1 upstream attempt per request)
    for (let i = 1; i <= 4; i++) {
      const r = await SELF.fetch("https://api.test/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: `5xx attempt ${i}` }],
          max_fallbacks: 0,
        }),
      });
      expect(r.status).toBe(502);
    }

    // After 4 failures, breaker must STILL be closed (5th failure opens it)
    const fifthAttemptCountBefore = groqCallCount;
    const r5 = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "5xx attempt 5" }],
        max_fallbacks: 0,
      }),
    });
    expect(r5.status).toBe(502);
    expect(groqCallCount).toBe(fifthAttemptCountBefore + 1);

    // Now after the 5th consecutive 5xx, breaker is OPEN -> leasePrivate returns null
    expect(await pool.leasePrivate("groq", 10, user.id)).toBeNull();

    // Advance test clock by 60s -> breaker half-opens -> probe request succeeds on 200
    await pool.setClockForTest(t0 + 60_000);
    groqStep = () => ({
      statusCode: 200,
      data: JSON.stringify({
        id: "chatcmpl-halfopen-ok",
        object: "chat.completion",
        created: 1700000000,
        model: "llama-3.3-70b-versatile",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "breaker closed!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const rProbe = await SELF.fetch("https://api.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Half-open probe" }],
      }),
    });
    expect(rProbe.status).toBe(200);
    expect(privKey.id).toMatch(/^key_/);
  });
});
