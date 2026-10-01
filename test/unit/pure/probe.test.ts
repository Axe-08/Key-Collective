/**
 * Key Collective — GCP project probe and proof-of-life (WP-3.6, FR-06, IR-09)
 *
 * Invariants Tested:
 * 1. forceErrorGcpProbe reads projects/<n> from ErrorInfo.metadata.consumer on 400 and 404,
 *    falls back to Help links and ResourceInfo, and otherwise reports why it is unavailable.
 * 2. Non-Google providers are not probed.
 * 3. checkProofOfLife makes one minimal call and maps 200 / 429 / 401-403 / 5xx-timeout.
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
  it("sends one minimal Gemini call", async () => {
    const fetchFn = answer(200, { candidates: [] });

    expect(await checkProofOfLife(KEY, "google")).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(":generateContent");
    expect(JSON.parse(String(init.body)).generationConfig.maxOutputTokens).toBe(1);
  });

  it("sends one minimal Groq call on llama-3.1-8b-instant", async () => {
    const fetchFn = answer(200, { choices: [] });

    expect(await checkProofOfLife("gsk_" + "a".repeat(30), "groq")).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "llama-3.1-8b-instant", max_tokens: 1 });
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
