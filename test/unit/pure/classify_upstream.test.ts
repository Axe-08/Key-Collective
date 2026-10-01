import { describe, expect, it } from "vitest";
import {
  classifyUpstreamError,
  classifyUpstreamResponse,
} from "../../../src/proxy/upstream/classify";
import {
  InvalidKeyError,
  ProviderRoutingError,
  ProviderTimeoutError,
  RateLimitExceededError,
} from "../../../src/errors";

describe("classifyUpstreamResponse (WP-4.3 T-4.3.1)", () => {
  const fixedNow = 1_700_000_000_000;

  it("maps 200 to outcome 'ok' with shouldFallback=false", () => {
    const res = classifyUpstreamResponse({
      status: 200,
      body: { id: "chatcmpl-123" },
      nowMs: fixedNow,
    });
    expect(res.outcome).toBe("ok");
    expect(res.shouldFallback).toBe(false);
  });

  it("maps 401 and 403 (API_KEY_INVALID / PERMISSION_DENIED) to 'key_invalid' with shouldFallback=true", () => {
    const res401 = classifyUpstreamResponse({
      status: 401,
      body: JSON.stringify({ error: { message: "Invalid API key" } }),
      nowMs: fixedNow,
    });
    expect(res401.outcome).toBe("key_invalid");
    expect(res401.shouldFallback).toBe(true);

    const res403ApiKeyInvalid = classifyUpstreamResponse({
      status: 403,
      body: JSON.stringify({
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          details: [{ reason: "API_KEY_INVALID" }],
        },
      }),
      nowMs: fixedNow,
    });
    expect(res403ApiKeyInvalid.outcome).toBe("key_invalid");
    expect(res403ApiKeyInvalid.shouldFallback).toBe(true);

    const res403PermDenied = classifyUpstreamResponse({
      status: 403,
      body: { error: { status: "PERMISSION_DENIED", message: "Permission denied" } },
      nowMs: fixedNow,
    });
    expect(res403PermDenied.outcome).toBe("key_invalid");
    expect(res403PermDenied.shouldFallback).toBe(true);
  });

  it("maps 429 with Gemini QuotaFailure.violations[].quotaId containing PerDay to 'rpd_exhausted'", () => {
    const geminiRpdBody = JSON.stringify({
      error: {
        code: 429,
        message: "Resource has been exhausted",
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [
              {
                quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
              },
            ],
          },
        ],
      },
    });

    const res = classifyUpstreamResponse({
      status: 429,
      body: geminiRpdBody,
      nowMs: fixedNow,
    });
    expect(res.outcome).toBe("rpd_exhausted");
    expect(res.shouldFallback).toBe(true);
    expect(res.cooldownUntilMs).toBeGreaterThan(fixedNow + 3600 * 1000);
  });

  it("maps 429 with Groq x-ratelimit-remaining-requests: 0 and reset > 1h to 'rpd_exhausted'", () => {
    const resDuration = classifyUpstreamResponse({
      status: 429,
      headers: {
        "x-ratelimit-remaining-requests": "0",
        "x-ratelimit-reset-requests": "2h15m30s",
      },
      body: JSON.stringify({ error: { message: "Rate limit reached for requests per day" } }),
      nowMs: fixedNow,
    });
    expect(resDuration.outcome).toBe("rpd_exhausted");
    expect(resDuration.shouldFallback).toBe(true);
    expect(resDuration.retryAfterSeconds).toBe(2 * 3600 + 15 * 60 + 30);
    expect(resDuration.cooldownUntilMs).toBe(fixedNow + (2 * 3600 + 15 * 60 + 30) * 1000);

    const resSeconds = classifyUpstreamResponse({
      status: 429,
      headers: new Headers({
        "x-ratelimit-remaining-requests": "0",
        "retry-after": "7200",
      }),
      body: "Rate limit exceeded",
      nowMs: fixedNow,
    });
    expect(resSeconds.outcome).toBe("rpd_exhausted");
    expect(resSeconds.retryAfterSeconds).toBe(7200);
  });

  it("maps other 429 responses to 'rpm_limited' with retry-after (default 60s)", () => {
    // 429 with no retry-after -> default 60s
    const defaultRpm = classifyUpstreamResponse({
      status: 429,
      body: JSON.stringify({ error: { message: "Rate limit exceeded (RPM)" } }),
      nowMs: fixedNow,
    });
    expect(defaultRpm.outcome).toBe("rpm_limited");
    expect(defaultRpm.retryAfterSeconds).toBe(60);
    expect(defaultRpm.cooldownUntilMs).toBe(fixedNow + 60_000);
    expect(defaultRpm.shouldFallback).toBe(true);

    // 429 with explicit retry-after: 15
    const explicitRpm = classifyUpstreamResponse({
      status: 429,
      headers: { "retry-after": "15" },
      body: JSON.stringify({ error: { message: "Slow down" } }),
      nowMs: fixedNow,
    });
    expect(explicitRpm.outcome).toBe("rpm_limited");
    expect(explicitRpm.retryAfterSeconds).toBe(15);
    expect(explicitRpm.cooldownUntilMs).toBe(fixedNow + 15_000);

    // 429 with Groq x-ratelimit-remaining-requests: 0 but reset <= 1h (e.g. 45s) -> rpm_limited
    const shortReset = classifyUpstreamResponse({
      status: 429,
      headers: {
        "x-ratelimit-remaining-requests": "0",
        "x-ratelimit-reset-requests": "45s",
        "retry-after": "45",
      },
      nowMs: fixedNow,
    });
    expect(shortReset.outcome).toBe("rpm_limited");
    expect(shortReset.retryAfterSeconds).toBe(45);

    // 429 with Gemini QuotaFailure PerMinute -> rpm_limited
    const geminiRpm = classifyUpstreamResponse({
      status: 429,
      body: {
        error: {
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel" }],
            },
          ],
        },
      },
      nowMs: fixedNow,
    });
    expect(geminiRpm.outcome).toBe("rpm_limited");
    expect(geminiRpm.retryAfterSeconds).toBe(60);
  });

  it("maps 5xx and timeouts to 'upstream_error' with shouldFallback=true", () => {
    for (const status of [500, 502, 503, 504]) {
      const res = classifyUpstreamResponse({ status, nowMs: fixedNow });
      expect(res.outcome).toBe("upstream_error");
      expect(res.shouldFallback).toBe(true);
    }

    const timeoutRes = classifyUpstreamResponse({
      timedOut: true,
      nowMs: fixedNow,
    });
    expect(timeoutRes.outcome).toBe("upstream_error");
    expect(timeoutRes.shouldFallback).toBe(true);
  });

  it("maps 400 to 'request_error' with shouldFallback=false", () => {
    const res = classifyUpstreamResponse({
      status: 400,
      body: JSON.stringify({ error: { message: "Invalid temperature value" } }),
      nowMs: fixedNow,
    });
    expect(res.outcome).toBe("request_error");
    expect(res.shouldFallback).toBe(false);
  });

  it("classifyUpstreamError classifies mapped DomainErrors accurately", () => {
    const invalidErr = new InvalidKeyError("Upstream authentication failed", {
      provider: "google",
      details: { upstreamStatusCode: 401 },
    });
    expect(classifyUpstreamError(invalidErr, fixedNow).outcome).toBe("key_invalid");

    const timeoutErr = new ProviderTimeoutError("groq", "Upstream timeout", {
      timeoutMs: 5000,
    });
    expect(classifyUpstreamError(timeoutErr, fixedNow).outcome).toBe("upstream_error");

    const rpdErr = new RateLimitExceededError("Upstream rate limit", {
      provider: "google",
      retryAfterSeconds: 60,
      details: {
        upstreamStatusCode: 429,
        upstreamBody: JSON.stringify({
          error: {
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                violations: [{ quotaId: "RequestsPerDay" }],
              },
            ],
          },
        }),
      },
    });
    expect(classifyUpstreamError(rpdErr, fixedNow).outcome).toBe("rpd_exhausted");

    const badReqErr = new ProviderRoutingError("groq", "Bad request", {
      upstreamStatusCode: 400,
      statusCode: 400,
    });
    const badReqClass = classifyUpstreamError(badReqErr, fixedNow);
    expect(badReqClass.outcome).toBe("request_error");
    expect(badReqClass.shouldFallback).toBe(false);
  });
});
