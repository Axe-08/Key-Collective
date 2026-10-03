/**
 * Key Collective v2 — Security Regression Tests (T-0.6.2)
 *
 * Verifies that upstream provider error bodies (which may contain
 * cloud project identifiers, API keys, or other sensitive details) never
 * reach the client through the domain error message / formatted response,
 * and that a fallback-exhausted response never echoes provider error text.
 */

import { describe, expect, it } from "vitest";
import { mapUpstreamHttpError } from "../../src/proxy/upstream/errors";
import { formatRouterError } from "../../src/worker/router/errors";
import { FallbackExhaustedError } from "../../src/errors/routing_errors";

const REAL_SHAPED_GEMINI_400 = JSON.stringify({
  error: {
    code: 400,
    message: "API key not valid. Please pass a valid API key.",
    status: "INVALID_ARGUMENT",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "API_KEY_INVALID",
        domain: "googleapis.com",
        metadata: {
          service: "generativelanguage.googleapis.com",
          project: "projects/123456789012",
        },
      },
    ],
    // A realistically-shaped (fake) Gemini API key value used only to
    // assert it never leaks into the client-facing body.
    apiKeyHint: "AIzaSyD-FAKE1234567890abcdefghijklmno",
  },
});

async function bodyOf(response: Response): Promise<string> {
  return response.text();
}

describe("Security: upstream error leakage (r2)", () => {
  it("HTTP 400 Gemini error with google.rpc.ErrorInfo does not leak project id, key or details", async () => {
    const err = mapUpstreamHttpError(
      "google",
      400,
      REAL_SHAPED_GEMINI_400
    );

    const response = formatRouterError(err, "req-1");
    const text = await bodyOf(response);

    expect(text).not.toContain("projects/123456789012");
    expect(text).not.toContain("AIzaSy");
    expect(text).not.toContain("details");
    expect(text).not.toContain("google.rpc.ErrorInfo");
  });

  it("HTTP 401 Gemini auth error does not leak project id, key or details", async () => {
    const err = mapUpstreamHttpError("google", 401, REAL_SHAPED_GEMINI_400);
    const response = formatRouterError(err, "req-2");
    const text = await bodyOf(response);

    expect(text).not.toContain("projects/123456789012");
    expect(text).not.toContain("AIzaSy");
    expect(text).not.toContain("details");
  });

  it("HTTP 429 Gemini rate-limit error does not leak project id, key or details", async () => {
    const err = mapUpstreamHttpError("google", 429, REAL_SHAPED_GEMINI_400);
    const response = formatRouterError(err, "req-3");
    const text = await bodyOf(response);

    expect(text).not.toContain("projects/123456789012");
    expect(text).not.toContain("AIzaSy");
    expect(text).not.toContain("details");
  });

  it("Upstream timeout (HTTP 504) does not leak project id, key or details", async () => {
    const err = mapUpstreamHttpError("google", 504, REAL_SHAPED_GEMINI_400);
    const response = formatRouterError(err, "req-4");
    const text = await bodyOf(response);

    expect(text).not.toContain("projects/123456789012");
    expect(text).not.toContain("AIzaSy");
    expect(text).not.toContain("details");
    expect(text).toContain("Upstream timeout");
  });

  it("fallback-exhausted response has no provider error text", async () => {
    const err = new FallbackExhaustedError([
      {
        provider: "google",
        modelId: "gemini-3.5-flash",
        error: REAL_SHAPED_GEMINI_400,
      },
      {
        provider: "openai",
        modelId: "gpt-4o",
        error: "Upstream rate limit",
      },
    ]);

    const response = formatRouterError(err, "req-5");
    const text = await bodyOf(response);

    expect(text).not.toContain("projects/123456789012");
    expect(text).not.toContain("AIzaSy");
    expect(text).not.toContain("details");
    expect(text).not.toContain("google.rpc.ErrorInfo");
    expect(text).not.toContain("gemini-3.5-flash");
    expect(text).toContain("All upstream routes failed");
  });
});
