/**
 * Key Collective — GCP project probe and proof-of-life (WP-3.6, FR-06, IR-09)
 *
 * Invariants Tested:
 * 1. forceErrorGcpProbe sends the key in x-goog-api-key to Translation, then YouTube, and reads
 *    projects/<n> from ErrorInfo.metadata.consumer (fallbacks: containerInfo, project= links).
 * 2. Non-Google providers are not probed.
 * 3. checkProofOfLife makes one minimal call (gemini-3.5-flash-lite / openai/gpt-oss-20b, T-F.3.4)
 *    and maps 200 / 429 / 401-403 / Gemini 400 API_KEY_INVALID / 404 model / 5xx-timeout.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { checkProofOfLife, forceErrorGcpProbe } from "../../../src/ingress/probe";

const KEY = "AIza" + "x".repeat(35);

function answer(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

// Bodies recorded 2026-10-03 (docs/specs/gcp_probe.md); <NUM> replaced by a sample project number.
const TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2?q=hi&target=fr";
const YOUTUBE_URL = "https://youtube.googleapis.com/youtube/v3/videos?part=id&id=x";

const translationBlocked = (num: string) => ({
  error: {
    code: 403,
    status: "PERMISSION_DENIED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "API_KEY_SERVICE_BLOCKED",
        domain: "googleapis.com",
        metadata: {
          consumer: `projects/${num}`,
          apiName: "translate",
          methodName: "google.cloud.translate.v2.TranslateService.TranslateText",
          service: "translate.googleapis.com",
        },
      },
    ],
  },
});

const youtubeDisabled = (num: string) => ({
  error: {
    code: 403,
    status: "PERMISSION_DENIED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "SERVICE_DISABLED",
        domain: "googleapis.com",
        metadata: {
          consumer: `projects/${num}`,
          service: "youtube.googleapis.com",
          containerInfo: num,
          activationUrl: `https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=${num}`,
        },
      },
      {
        "@type": "type.googleapis.com/google.rpc.Help",
        links: [{ url: `https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=${num}` }],
      },
    ],
  },
});

/** Answers by URL: the first matching prefix wins. */
function route(table: Array<[string, number, unknown]>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = table.find(([prefix]) => url.startsWith(prefix));
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify(hit[2]), { status: hit[1], headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("forceErrorGcpProbe (T-F.4.1)", () => {
  it("reads the project from Translation's API_KEY_SERVICE_BLOCKED error, key in the header only", async () => {
    const fetchFn = route([[TRANSLATE_URL, 403, translationBlocked("123456789")]]);

    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ projectNumber: "123456789" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TRANSLATE_URL);
    expect(url).not.toContain(KEY);
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe(KEY);
  });

  it("falls back to YouTube SERVICE_DISABLED when Translation answers 200", async () => {
    const fetchFn = route([
      [TRANSLATE_URL, 200, { data: { translations: [{ translatedText: "salut" }] } }],
      [YOUTUBE_URL, 403, youtubeDisabled("987654321")],
    ]);

    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ projectNumber: "987654321" });
    const [url, init] = fetchFn.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(YOUTUBE_URL);
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe(KEY);
  });

  it("falls back to containerInfo, then to project= in activationUrl and Help links", async () => {
    const containerOnly = youtubeDisabled("111222333");
    const info = containerOnly.error.details[0] as { metadata: Record<string, string> };
    delete info.metadata.consumer;
    route([[TRANSLATE_URL, 200, {}], [YOUTUBE_URL, 403, containerOnly]]);
    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ projectNumber: "111222333" });

    const activationOnly = youtubeDisabled("444555666");
    const meta = (activationOnly.error.details[0] as { metadata: Record<string, string> }).metadata;
    delete meta.consumer;
    delete meta.containerInfo;
    activationOnly.error.details.pop();
    route([[TRANSLATE_URL, 200, {}], [YOUTUBE_URL, 403, activationOnly]]);
    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ projectNumber: "444555666" });

    const helpOnly = youtubeDisabled("777888999");
    helpOnly.error.details.shift();
    route([[TRANSLATE_URL, 200, {}], [YOUTUBE_URL, 403, helpOnly]]);
    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ projectNumber: "777888999" });
  });

  it("is unavailable when the key may call both services", async () => {
    route([[TRANSLATE_URL, 200, {}], [YOUTUBE_URL, 200, { items: [] }]]);

    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ unavailable: "both_services_allowed" });
  });

  it("is unavailable when no error names a project (e.g. CREDENTIALS_MISSING), on other statuses and on network errors", async () => {
    const noConsumer = { error: { code: 401, status: "UNAUTHENTICATED", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "CREDENTIALS_MISSING" }] } };
    route([[TRANSLATE_URL, 401, noConsumer], [YOUTUBE_URL, 401, noConsumer]]);
    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ unavailable: "no_project_in_response" });

    route([[TRANSLATE_URL, 500, {}], [YOUTUBE_URL, 500, {}]]);
    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ unavailable: "http_500" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ unavailable: "network_error" });
  });

  it("never uses the Gemini invalid-model probe, which carries no project", async () => {
    const fetchFn = route([[TRANSLATE_URL, 403, translationBlocked("123")], ["https://generativelanguage.googleapis.com", 404, {}]]);

    await forceErrorGcpProbe(KEY, "google");
    for (const call of fetchFn.mock.calls) {
      expect(String(call[0])).not.toContain("generativelanguage");
    }
  });

  it("does not probe non-Google providers", async () => {
    const fetchFn = answer(400, {});

    expect(await forceErrorGcpProbe("gsk_" + "a".repeat(30), "groq")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("checkProofOfLife", () => {
  it("sends one minimal Gemini call on gemini-3.5-flash-lite", async () => {
    const fetchFn = answer(200, { candidates: [] });

    expect(await checkProofOfLife(KEY, "google")).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect(JSON.parse(String(init.body)).generationConfig.maxOutputTokens).toBe(1);
  });

  it("sends one minimal Groq call on openai/gpt-oss-20b", async () => {
    const fetchFn = answer(200, { choices: [] });

    expect(await checkProofOfLife("gsk_" + "a".repeat(30), "groq")).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "openai/gpt-oss-20b", max_tokens: 1 });
  });

  it("maps the live Gemini 400 API_KEY_INVALID body to key_invalid", async () => {
    // Recorded 2026-10-03 (docs/specs/gcp_probe.md, RA-04): an invalid key answers 400, not 401.
    answer(400, {
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "API_KEY_INVALID",
            domain: "googleapis.com",
            metadata: { service: "generativelanguage.googleapis.com" },
          },
        ],
      },
    });

    expect(await checkProofOfLife(KEY, "google")).toEqual({ error: "key_invalid" });
  });

  it("does not blame the key for another Gemini 400", async () => {
    answer(400, { error: { code: 400, message: "Invalid JSON payload", status: "INVALID_ARGUMENT" } });

    expect(await checkProofOfLife(KEY, "google")).toEqual({ error: "provider_unavailable" });
  });

  it.each([
    ["google", 404, { error: { code: 404, message: "models/gemini-3.5-flash-lite is not found", status: "NOT_FOUND" } }],
    ["groq", 404, { error: { message: "The model does not exist", type: "invalid_request_error", code: "model_not_found" } }],
    ["groq", 400, { error: { message: "The model has been decommissioned", type: "invalid_request_error", code: "model_decommissioned" } }],
  ])("logs probe_model_unavailable and answers provider_unavailable for %s HTTP %i", async (provider, status, body) => {
    answer(status, body);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const key = provider === "groq" ? "gsk_" + "a".repeat(30) : KEY;
    expect(await checkProofOfLife(key, provider)).toEqual({ error: "provider_unavailable" });
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("probe_model_unavailable");
    expect(logged).toContain(provider === "groq" ? "openai/gpt-oss-20b" : "gemini-3.5-flash-lite");
    expect(logged).not.toContain(key);
    warn.mockRestore();
  });

  it.each([
    [429, "key_no_quota"],
    [401, "key_invalid"],
    [403, "key_invalid"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
  ])("maps HTTP %i to %s", async (status, error) => {
    answer(status, {});

    expect(await checkProofOfLife(KEY, "google")).toEqual({ error });
  });

  it("maps a network failure or timeout to provider_unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); }));

    expect(await checkProofOfLife(KEY, "google")).toEqual({ error: "provider_unavailable" });
  });
});
