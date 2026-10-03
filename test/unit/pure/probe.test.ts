/**
 * Key Collective — GCP project probe and proof-of-life (WP-3.6, FR-06, IR-09)
 *
 * Invariants Tested:
 * 1. forceErrorGcpProbe reads projects/<n> from ErrorInfo.metadata.consumer on 400 and 404,
 *    falls back to Help links and ResourceInfo, and otherwise reports why it is unavailable.
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

const errorInfo = (consumer: string) => ({
  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
  reason: "API_KEY_INVALID",
  metadata: { consumer, service: "generativelanguage.googleapis.com" },
});

afterEach(() => vi.unstubAllGlobals());

describe("forceErrorGcpProbe", () => {
  it.each([400, 404])("reads the project number from ErrorInfo on HTTP %i", async (status) => {
    answer(status, { error: { code: status, details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest" }, errorInfo("projects/123456789")] } });

    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ projectNumber: "123456789" });
  });

  it("falls back to a Help link naming the project", async () => {
    answer(400, {
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.Help",
            links: [{ description: "Google developers console", url: "https://console.developers.google.com/apis/api/generativelanguage.googleapis.com/overview?project=987654321" }],
          },
        ],
      },
    });

    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ projectNumber: "987654321" });
  });

  it("falls back to ResourceInfo naming the project", async () => {
    answer(404, {
      error: { details: [{ "@type": "type.googleapis.com/google.rpc.ResourceInfo", resourceName: "projects/555000111/locations/global" }] },
    });

    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ projectNumber: "555000111" });
  });

  it("reports unavailable when no detail names a project, on other statuses and on network errors", async () => {
    answer(400, { error: { details: [] } });
    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ unavailable: "no_project_in_response" });

    answer(429, { error: { code: 429 } });
    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ unavailable: "http_429" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    expect(await forceErrorGcpProbe(KEY, "google")).toEqual({ unavailable: "network_error" });
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
