import { describe, it, expect } from "vitest";
import {
  DomainError,
  DomainErrorJson,
  isDomainError,
  AuthenticationError,
  TenantIsolationError,
  isAuthenticationError,
  isTenantIsolationError,
  DecryptionError,
  EncryptionError,
  RateLimitExceededError,
  KeyNotFoundError,
  KeyExhaustedError,
  InvalidKeyError,
  QuotaExceededError,
  isDecryptionError,
  isEncryptionError,
  isRateLimitExceededError,
  isKeyNotFoundError,
  isKeyExhaustedError,
  isInvalidKeyError,
  isQuotaExceededError,
  CircuitBreakerTrippedError,
  ProviderRoutingError,
  ModelNotFoundError,
  UnknownModelAliasError,
  NoAvailableProviderError,
  ProviderTimeoutError,
  CapabilityMismatchError,
  FallbackExhaustedError,
  isCircuitBreakerTrippedError,
  isProviderRoutingError,
  isModelNotFoundError,
  isUnknownModelAliasError,
  isNoAvailableProviderError,
  isProviderTimeoutError,
  isCapabilityMismatchError,
  isFallbackExhaustedError,
  TelemetryEmissionError,
  InvalidTelemetryEventError,
  isTelemetryEmissionError,
  isInvalidTelemetryEventError,
} from "../src/errors";

// Concrete dummy class to test base DomainError
class TestDomainError extends DomainError {
  public override readonly name = "TestDomainError";
}

describe("Domain Error Architecture", () => {
  describe("Base DomainError", () => {
    it("initializes with default status code and code", () => {
      const err = new TestDomainError("Something went wrong");
      expect(err.message).toBe("Something went wrong");
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe("INTERNAL_DOMAIN_ERROR");
      expect(err.isOperational).toBe(true);
      expect(err.details).toBeUndefined();
      expect(err.name).toBe("TestDomainError");
      expect(err instanceof Error).toBe(true);
      expect(err instanceof DomainError).toBe(true);
      expect(err instanceof TestDomainError).toBe(true);
    });

    it("accepts custom statusCode, code, details, and isOperational", () => {
      const details = { requestId: "req-123", retryable: false };
      const err = new TestDomainError("Custom failure", {
        statusCode: 418,
        code: "TEAPOT_ERROR",
        isOperational: false,
        details,
      });

      expect(err.statusCode).toBe(418);
      expect(err.code).toBe("TEAPOT_ERROR");
      expect(err.isOperational).toBe(false);
      expect(err.details).toEqual(details);
    });

    it("preserves error cause", () => {
      const original = new Error("Underlying network issue");
      const err = new TestDomainError("Wrapped error", { cause: original });
      expect(err.cause).toBe(original);
    });

    it("serializes to structured JSON via toJSON()", () => {
      const err = new TestDomainError("Failed processing", {
        statusCode: 422,
        code: "UNPROCESSABLE",
        details: { field: "messages" },
      });

      const json: DomainErrorJson = err.toJSON();
      expect(json).toEqual({
        error: "Failed processing",
        code: "UNPROCESSABLE",
        statusCode: 422,
        details: { field: "messages" },
      });
    });

    it("converts to standard Web API Response via toResponse()", async () => {
      const err = new TestDomainError("Service error", {
        statusCode: 503,
        code: "DEGRADED",
      });

      const response = err.toResponse({ "x-custom-header": "test-val" });
      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("x-custom-header")).toBe("test-val");

      const body = (await response.json()) as DomainErrorJson;
      expect(body.error).toBe("Service error");
      expect(body.code).toBe("DEGRADED");
      expect(body.statusCode).toBe(503);
    });

    it("type guard isDomainError identifies DomainError instances", () => {
      const err = new TestDomainError("Err");
      expect(isDomainError(err)).toBe(true);
      expect(isDomainError(new Error("Generic"))).toBe(false);
      expect(isDomainError(null)).toBe(false);
      expect(isDomainError(undefined)).toBe(false);
      expect(isDomainError("Error string")).toBe(false);
      expect(isDomainError({ statusCode: 500, code: "CODE", isOperational: true })).toBe(true);
    });
  });

  describe("Authentication & Authorization Errors", () => {
    describe("AuthenticationError", () => {
      it("initializes with 401 status and correct defaults", () => {
        const err = new AuthenticationError();
        expect(err.statusCode).toBe(401);
        expect(err.code).toBe("AUTHENTICATION_FAILED");
        expect(err.name).toBe("AuthenticationError");
        expect(isAuthenticationError(err)).toBe(true);
      });

      it("includes reason and bearerTokenPrefix in details", () => {
        const err = new AuthenticationError("Token expired", {
          reason: "expired_token",
          bearerTokenPrefix: "sk-proj-abc...",
        });
        expect(err.reason).toBe("expired_token");
        expect(err.bearerTokenPrefix).toBe("sk-proj-abc...");
        expect(err.details?.reason).toBe("expired_token");
        expect(err.details?.bearerTokenPrefix).toBe("sk-proj-abc...");
      });

      it("sets WWW-Authenticate header in toResponse()", () => {
        const err = new AuthenticationError();
        const res = err.toResponse();
        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate")).toBe('Bearer realm="Key Collective API"');
      });
    });

    describe("TenantIsolationError", () => {
      it("initializes with 403 status and tenant metadata", () => {
        const err = new TenantIsolationError("Cross-tenant violation", {
          tenantId: "tenant-A",
          attemptedTenantId: "tenant-B",
          resourceId: "key-999",
        });

        expect(err.statusCode).toBe(403);
        expect(err.code).toBe("TENANT_ISOLATION_VIOLATION");
        expect(err.tenantId).toBe("tenant-A");
        expect(err.attemptedTenantId).toBe("tenant-B");
        expect(err.resourceId).toBe("key-999");
        expect(isTenantIsolationError(err)).toBe(true);
      });
    });
  });

  describe("Key Management Errors", () => {
    describe("DecryptionError", () => {
      it("initializes with 500 status and crypto details", () => {
        const err = new DecryptionError("Decryption tag mismatch", {
          keyId: "key-123",
          provider: "openai",
          nonceLengthBytes: 12,
        });

        expect(err.statusCode).toBe(500);
        expect(err.code).toBe("DECRYPTION_FAILED");
        expect(err.name).toBe("DecryptionError");
        expect(err.keyId).toBe("key-123");
        expect(err.provider).toBe("openai");
        expect(err.algorithm).toBe("AES-GCM");
        expect(err.details?.nonceLengthBytes).toBe(12);
        expect(isDecryptionError(err)).toBe(true);
      });
    });

    describe("EncryptionError", () => {
      it("initializes with 500 status and provider info", () => {
        const err = new EncryptionError("Failed to encrypt key", {
          provider: "anthropic",
        });

        expect(err.statusCode).toBe(500);
        expect(err.code).toBe("ENCRYPTION_FAILED");
        expect(err.name).toBe("EncryptionError");
        expect(err.provider).toBe("anthropic");
        expect(err.algorithm).toBe("AES-GCM");
        expect(isEncryptionError(err)).toBe(true);
      });
    });

    describe("RateLimitExceededError", () => {
      it("initializes with 429 status and sets Retry-After header", () => {
        const err = new RateLimitExceededError("Rate limit reached", {
          tenantId: "t-1",
          provider: "openai",
          keyId: "k-1",
          rpmLimit: 60,
          currentRpm: 65,
          retryAfterSeconds: 30,
        });

        expect(err.statusCode).toBe(429);
        expect(err.code).toBe("RATE_LIMIT_EXCEEDED");
        expect(err.name).toBe("RateLimitExceededError");
        expect(err.tenantId).toBe("t-1");
        expect(err.provider).toBe("openai");
        expect(err.keyId).toBe("k-1");
        expect(err.rpmLimit).toBe(60);
        expect(err.currentRpm).toBe(65);
        expect(err.retryAfterSeconds).toBe(30);
        expect(isRateLimitExceededError(err)).toBe(true);

        const res = err.toResponse();
        expect(res.status).toBe(429);
        expect(res.headers.get("retry-after")).toBe("30");
      });

      it("defaults retryAfterSeconds to 60", () => {
        const err = new RateLimitExceededError();
        expect(err.retryAfterSeconds).toBe(60);
        expect(err.toResponse().headers.get("retry-after")).toBe("60");
      });
    });

    describe("KeyNotFoundError", () => {
      it("initializes with 404 status and key identifier", () => {
        const err = new KeyNotFoundError("key-xyz", undefined, {
          tenantId: "tenant-100",
          provider: "google",
        });

        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("KEY_NOT_FOUND");
        expect(err.keyId).toBe("key-xyz");
        expect(err.tenantId).toBe("tenant-100");
        expect(err.provider).toBe("google");
        expect(err.message).toContain("key-xyz");
        expect(isKeyNotFoundError(err)).toBe(true);
      });
    });

    describe("KeyExhaustedError", () => {
      it("initializes with 429 status when all keys exhausted", () => {
        const err = new KeyExhaustedError("All keys rate limited", {
          provider: "groq",
          tenantId: "t-2",
          totalKeys: 5,
          retryAfterSeconds: 45,
        });

        expect(err.statusCode).toBe(429);
        expect(err.code).toBe("ALL_KEYS_EXHAUSTED");
        expect(err.provider).toBe("groq");
        expect(err.totalKeys).toBe(5);
        expect(err.retryAfterSeconds).toBe(45);
        expect(isKeyExhaustedError(err)).toBe(true);

        const res = err.toResponse();
        expect(res.status).toBe(429);
        expect(res.headers.get("retry-after")).toBe("45");
      });
    });

    describe("InvalidKeyError", () => {
      it("initializes with 400 status for malformed keys", () => {
        const err = new InvalidKeyError("Key lacks required prefix", {
          provider: "openai",
          reason: "missing_sk_prefix",
        });

        expect(err.statusCode).toBe(400);
        expect(err.code).toBe("INVALID_KEY");
        expect(err.provider).toBe("openai");
        expect(err.reason).toBe("missing_sk_prefix");
        expect(isInvalidKeyError(err)).toBe(true);
      });
    });

    describe("QuotaExceededError", () => {
      it("initializes with 429 status and supports BigInt quotas", () => {
        const err = new QuotaExceededError("Monthly microdollar spend cap reached", {
          tenantId: "tenant-vip",
          quotaType: "spend_limit",
          limit: 10_000_000n, // $10 USD in microdollars
          consumed: 10_050_000n,
        });

        expect(err.statusCode).toBe(429);
        expect(err.code).toBe("QUOTA_EXCEEDED");
        expect(err.tenantId).toBe("tenant-vip");
        expect(err.quotaType).toBe("spend_limit");
        expect(err.limit).toBe(10_000_000n);
        expect(err.consumed).toBe(10_050_000n);
        expect(err.details?.limit).toBe("10000000");
        expect(isQuotaExceededError(err)).toBe(true);
      });
    });
  });

  describe("Routing and Provider Errors", () => {
    describe("CircuitBreakerTrippedError", () => {
      it("initializes with 503 status and sets Retry-After", () => {
        const err = new CircuitBreakerTrippedError("cohere", undefined, {
          modelId: "command-r",
          consecutiveFailures: 5,
          circuitOpenUntil: "2026-09-09T22:00:00.000Z",
          retryAfterSeconds: 45,
        });

        expect(err.statusCode).toBe(503);
        expect(err.code).toBe("CIRCUIT_BREAKER_OPEN");
        expect(err.provider).toBe("cohere");
        expect(err.modelId).toBe("command-r");
        expect(err.consecutiveFailures).toBe(5);
        expect(err.circuitOpenUntil).toBe("2026-09-09T22:00:00.000Z");
        expect(err.retryAfterSeconds).toBe(45);
        expect(isCircuitBreakerTrippedError(err)).toBe(true);

        const res = err.toResponse();
        expect(res.status).toBe(503);
        expect(res.headers.get("retry-after")).toBe("45");
      });
    });

    describe("ProviderRoutingError", () => {
      it("defaults to 502 Bad Gateway", () => {
        const err = new ProviderRoutingError("openai", undefined, {
          modelId: "gpt-4o",
          upstreamStatusCode: 502,
          upstreamResponseText: "Bad Gateway from upstream edge",
        });

        expect(err.statusCode).toBe(502);
        expect(err.code).toBe("BAD_GATEWAY");
        expect(err.provider).toBe("openai");
        expect(err.modelId).toBe("gpt-4o");
        expect(err.upstreamStatusCode).toBe(502);
        expect(err.upstreamResponseText).toBe("Bad Gateway from upstream edge");
        expect(isProviderRoutingError(err)).toBe(true);
      });

      it("supports 504 Gateway Timeout", () => {
        const err = new ProviderRoutingError("anthropic", "Anthropic gateway timed out", {
          statusCode: 504,
          upstreamStatusCode: 504,
        });

        expect(err.statusCode).toBe(504);
        expect(err.code).toBe("GATEWAY_TIMEOUT");
        expect(err.provider).toBe("anthropic");
      });
    });

    describe("ModelNotFoundError", () => {
      it("initializes with 404 status and available model suggestions", () => {
        const err = new ModelNotFoundError("gpt-5-ultra", undefined, {
          availableModels: ["gpt-4o", "gemini-2.0-flash"],
        });

        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("MODEL_NOT_FOUND");
        expect(err.modelIdOrAlias).toBe("gpt-5-ultra");
        expect(err.availableModels).toEqual(["gpt-4o", "gemini-2.0-flash"]);
        expect(isModelNotFoundError(err)).toBe(true);
      });
    });

    describe("UnknownModelAliasError", () => {
      it("initializes with 400 status and configured aliases", () => {
        const err = new UnknownModelAliasError("turbo-mega", undefined, {
          configuredAliases: ["fast-model", "smart-model"],
        });

        expect(err.statusCode).toBe(400);
        expect(err.code).toBe("UNKNOWN_MODEL_ALIAS");
        expect(err.alias).toBe("turbo-mega");
        expect(err.configuredAliases).toEqual(["fast-model", "smart-model"]);
        expect(isUnknownModelAliasError(err)).toBe(true);
      });
    });

    describe("NoAvailableProviderError", () => {
      it("initializes with 503 status when no candidate providers exist", () => {
        const err = new NoAvailableProviderError("All providers filtered", {
          requestedModel: "smart-model",
          candidateCount: 0,
          reason: "no_healthy_keys",
        });

        expect(err.statusCode).toBe(503);
        expect(err.code).toBe("NO_AVAILABLE_PROVIDER");
        expect(err.requestedModel).toBe("smart-model");
        expect(err.candidateCount).toBe(0);
        expect(isNoAvailableProviderError(err)).toBe(true);
      });
    });

    describe("ProviderTimeoutError", () => {
      it("initializes with 504 status and timeout duration", () => {
        const err = new ProviderTimeoutError("mistral", undefined, {
          modelId: "mistral-large",
          timeoutMs: 15000,
        });

        expect(err.statusCode).toBe(504);
        expect(err.code).toBe("GATEWAY_TIMEOUT");
        expect(err.provider).toBe("mistral");
        expect(err.modelId).toBe("mistral-large");
        expect(err.timeoutMs).toBe(15000);
        expect(isProviderTimeoutError(err)).toBe(true);
      });
    });

    describe("CapabilityMismatchError", () => {
      it("initializes with 400 status and lists missing capabilities", () => {
        const err = new CapabilityMismatchError(["tools", "vision"], undefined, {
          candidateModel: "deepseek-r1",
        });

        expect(err.statusCode).toBe(400);
        expect(err.code).toBe("CAPABILITY_MISMATCH");
        expect(err.requiredCapabilities).toEqual(["tools", "vision"]);
        expect(err.candidateModel).toBe("deepseek-r1");
        expect(isCapabilityMismatchError(err)).toBe(true);
      });
    });

    describe("FallbackExhaustedError", () => {
      it("initializes with 502 status and tracks all attempted fallback routes", () => {
        const attempts = [
          { provider: "openai", modelId: "gpt-4o", error: "429 Too Many Requests" },
          { provider: "anthropic", modelId: "claude-3-5-sonnet", error: "503 Degraded" },
          { provider: "google", modelId: "gemini-2.0-flash", error: "504 Gateway Timeout" },
        ];

        const err = new FallbackExhaustedError(attempts);
        expect(err.statusCode).toBe(502);
        expect(err.code).toBe("FALLBACK_EXHAUSTED");
        expect(err.attemptedRoutes).toHaveLength(3);
        expect(err.attemptedRoutes[0].provider).toBe("openai");
        expect(err.details?.attemptedRoutes).toEqual(attempts);
        expect(isFallbackExhaustedError(err)).toBe(true);
      });
    });
  });

  describe("Telemetry Errors", () => {
    describe("TelemetryEmissionError", () => {
      it("initializes with 500 status and diagnostic metadata", () => {
        const err = new TelemetryEmissionError("Analytics Engine buffer overflow", {
          traceId: "trace-987",
          eventType: "request_completed",
          reason: "dataset_write_failure",
        });

        expect(err.statusCode).toBe(500);
        expect(err.code).toBe("TELEMETRY_EMISSION_FAILED");
        expect(err.traceId).toBe("trace-987");
        expect(err.eventType).toBe("request_completed");
        expect(err.reason).toBe("dataset_write_failure");
        expect(isTelemetryEmissionError(err)).toBe(true);
      });
    });

    describe("InvalidTelemetryEventError", () => {
      it("initializes with 400 status and validation details", () => {
        const err = new InvalidTelemetryEventError("Missing traceId", {
          validationErrors: ["traceId is required", "costMicrodollars must be BigInt"],
        });

        expect(err.statusCode).toBe(400);
        expect(err.code).toBe("INVALID_TELEMETRY_EVENT");
        expect(err.validationErrors).toEqual([
          "traceId is required",
          "costMicrodollars must be BigInt",
        ]);
        expect(isInvalidTelemetryEventError(err)).toBe(true);
      });
    });
  });
});
