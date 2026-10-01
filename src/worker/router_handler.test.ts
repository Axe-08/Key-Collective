import { describe, expect, it, vi } from "vitest";
import { sanitize, SECRET_REGEX, IP_REGEX } from "./error_normalizer";
import { formatRouterError, RouterHandler } from "./router/index";
import type { AuthenticatedContext, WorkerEnv } from "./auth/types";
import { RouterError } from "./router/index";
import { encryptKey } from "../durable_objects/crypto";

describe("GATEWAY-001: Error Normalizer & Secret Redaction", () => {
  describe("sanitize", () => {
    it("Format error containing an IP", () => {
      const raw = "Connection failed to 192.168.1.100 on port 443";
      const sanitized = sanitize(raw);
      expect(sanitized).toBe("Connection failed to [REDACTED_IP] on port 443");
      expect(sanitized).not.toContain("192.168.1.100");
    });

    it("Format error containing sk-key", () => {
      const raw = "Authentication failed for key sk-1234567890abcdef1234567890: invalid credentials";
      const sanitized = sanitize(raw);
      expect(sanitized).toBe("Authentication failed for key [REDACTED_SECRET]: invalid credentials");
      expect(sanitized).not.toContain("sk-1234567890abcdef1234567890");
    });

    it("redacts Bearer tokens", () => {
      const raw = "Upstream returned 401 with header Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      const sanitized = sanitize(raw);
      expect(sanitized).toBe("Upstream returned 401 with header Authorization: [REDACTED_SECRET]");
      expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    });

    it("redacts multiple IP addresses and multiple secrets in a single message", () => {
      const raw = "Proxy error from 10.0.0.1 to 172.16.254.1 using sk-key12345678901234567890";
      const sanitized = sanitize(raw);
      expect(sanitized).toBe("Proxy error from [REDACTED_IP] to [REDACTED_IP] using [REDACTED_SECRET]");
      expect(sanitized).not.toContain("10.0.0.1");
      expect(sanitized).not.toContain("172.16.254.1");
      expect(sanitized).not.toContain("sk-key12345678901234567890");
    });

    it("handles empty or falsy message gracefully", () => {
      expect(sanitize("")).toBe("");
    });
  });

  describe("formatRouterError", () => {
    it("Format error containing an IP", async () => {
      const error = new Error("Failed to reach upstream host 10.128.0.5: Connection timed out");
      const response = formatRouterError(error);
      expect(response.status).toBe(500);
      expect(response.headers.get("x-kc-request-id")).toBeDefined();

      const body = (await response.json()) as { error: { message: string; type: string; code: string } };
      expect(body.error.message).toBe("Internal error");
      expect(body.error.message).not.toContain("10.128.0.5");
      expect(body.error.type).toBe("internal_server_error");
      expect(body.error.code).toBe("INTERNAL_ROUTING_ERROR");
      expect((body as Record<string, unknown>).details).toBeUndefined();
    });

    it("Format error containing sk-key", async () => {
      const error = new Error("Upstream rejected token sk-abcdefghijklmnopqrstuvwxyz1234567890");
      const response = formatRouterError(error);
      expect(response.status).toBe(500);
      expect(response.headers.get("x-kc-request-id")).toBeDefined();

      const body = (await response.json()) as { error: { message: string; type: string; code: string } };
      expect(body.error.message).toBe("Internal error");
      expect(body.error.message).not.toContain("sk-abcdef");
      expect(body.error.type).toBe("internal_server_error");
      expect(body.error.code).toBe("INTERNAL_ROUTING_ERROR");
      expect((body as Record<string, unknown>).details).toBeUndefined();
    });

    it("sanitizes DomainError messages", async () => {
      const error = new RouterError("DO node 192.168.0.1 failed to route sk-12345678901234567890abcdef", {
        details: { confidentialToken: "secret-do-details" },
      });
      const response = formatRouterError(error);
      expect(response.status).toBe(500);
      expect(response.headers.get("x-kc-request-id")).toBeDefined();

      const body = (await response.json()) as { error: { message: string; type: string; code: string } };
      expect(body.error.message).toBe("DO node [REDACTED_IP] failed to route [REDACTED_SECRET]");
      expect(body.error.message).not.toContain("192.168.0.1");
      expect(body.error.message).not.toContain("sk-123456");
      expect(body.error.type).toBe("internal_server_error");
      expect(body.error.code).toBe("INTERNAL_DOMAIN_ERROR");
      // details is never serialized to clients
      expect((body as Record<string, unknown>).details).toBeUndefined();
      expect((body.error as unknown as Record<string, unknown>).details).toBeUndefined();
    });
  });
});

describe("GATEWAY-001: /v1/report Takedown Endpoint with Timing Shield", () => {
  const handler = new RouterHandler();
  const mockEnv = {
    REPORT_WEBHOOK_SECRET: "sec_webhook_takedown_token_xyz123",
  } as unknown as WorkerEnv;

  it("Missing header -> 401", async () => {
    const request = new Request("http://localhost/v1/report", {
      method: "POST",
    });

    const response = await handler.handle(request, mockEnv);
    expect(response.status).toBe(401);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("Wrong token -> 401", async () => {
    const request = new Request("http://localhost/v1/report", {
      method: "POST",
      headers: {
        authorization: "Bearer wrong_invalid_secret",
      },
    });

    const response = await handler.handle(request, mockEnv);
    expect(response.status).toBe(401);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("Correct token -> 200", async () => {
    const request = new Request("http://localhost/v1/report", {
      method: "POST",
      headers: {
        authorization: "Bearer sec_webhook_takedown_token_xyz123",
      },
    });

    const response = await handler.handle(request, mockEnv);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toBe("Report accepted");
  });

  it("Correct token without 'Bearer ' prefix -> 200", async () => {
    const request = new Request("http://localhost/v1/report", {
      method: "POST",
      headers: {
        authorization: "sec_webhook_takedown_token_xyz123",
      },
    });

    const response = await handler.handle(request, mockEnv);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toBe("Report accepted");
  });

  it("Direct handleReport call validates timing shield correctly", async () => {
    const reqMissing = new Request("http://localhost/v1/report", { method: "POST" });
    const resMissing = await handler.handleReport(reqMissing, mockEnv);
    expect(resMissing.status).toBe(401);

    const reqWrong = new Request("http://localhost/v1/report", {
      method: "POST",
      headers: { authorization: "Bearer invalid" },
    });
    const resWrong = await handler.handleReport(reqWrong, mockEnv);
    expect(resWrong.status).toBe(401);

    const reqCorrect = new Request("http://localhost/v1/report", {
      method: "POST",
      headers: { authorization: "Bearer sec_webhook_takedown_token_xyz123" },
    });
    const resCorrect = await handler.handleReport(reqCorrect, mockEnv);
    expect(resCorrect.status).toBe(200);
  });
});

describe("ROUTER: Plaintext Key Decryption for Upstream Calls", () => {
  it("decrypts keyId from KeyPool using D1 and KC_MASTER_KEY before calling upstream", async () => {
    const MASTER_KEY = "super-secret-master-key-1234567890";
    const rawApiKey = "AIzaSyDecryptedGoogleKey999";
    const encrypted = await encryptKey(rawApiKey, "default", "google", MASTER_KEY);

    let capturedHeaders: Headers | undefined;
    const mockFetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          id: "chatcmpl-123",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "Hello there!" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const mockKeyPool = {
        getKey: vi.fn().mockResolvedValue("key_gemini_test_1"),
        recordUsage: vi.fn().mockResolvedValue(undefined),
        recordResult: vi.fn().mockResolvedValue(undefined),
      };

      const mockDb = {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              id: "key_gemini_test_1",
              encrypted_key_b64: encrypted.ciphertext,
              nonce_b64: encrypted.nonce,
              tenant_id: "default",
              provider: "google",
              hkdf_migrated: 0,
            }),
            run: async () => ({ success: true }),
          }),
        }),
      };

      const env = {
        DB: mockDb,
        KC_MASTER_KEY: MASTER_KEY,
      } as unknown as WorkerEnv;

      const handler = new RouterHandler({
        keyPoolFactory: () => mockKeyPool,
      });

      const authContext: AuthenticatedContext = {
        tenantId: "default",
        isAuthenticated: true,
        token: {
          id: "tok_test_default",
          hashSha256: "hash_default",
          tenantId: "default",
          budgetMicrodollars: 10_000_000n,
          spentMicrodollars: 0n,
          allowedProviders: [],
          rpmLimit: 1000,
          expiresAt: null,
          createdAt: new Date().toISOString(),
        },
        rpmLimit: 1000,
        currentRpm: 1,
        remainingRpm: 999,
        budgetMicrodollars: 10_000_000n,
        spentMicrodollars: 0n,
      };

      const request = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      const response = await handler.handle(request, env, undefined, authContext);
      expect(response.status).toBe(200);

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders?.get("x-goog-api-key")).toBe(rawApiKey);
      expect(capturedHeaders?.get("x-goog-api-key")).not.toBe("key_gemini_test_1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

