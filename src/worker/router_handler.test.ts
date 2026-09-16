import { describe, expect, it, vi } from "vitest";
import { sanitizeErrorMessage, SECRET_REGEX, IP_REGEX } from "../errors/normalizer";
import { formatRouterError, RouterHandler } from "./router_handler";
import type { WorkerEnv } from "./env";
import { RouterError } from "./router_handler";
import { encryptKey } from "../durable_objects/crypto";

describe("GATEWAY-001: Error Normalizer & Secret Redaction", () => {
  describe("sanitizeErrorMessage", () => {
    it("Format error containing an IP", () => {
      const raw = "Connection failed to 192.168.1.100 on port 443";
      const sanitized = sanitizeErrorMessage(raw);
      expect(sanitized).toBe("Connection failed to [REDACTED_IP] on port 443");
      expect(sanitized).not.toContain("192.168.1.100");
    });

    it("Format error containing sk-key", () => {
      const raw = "Authentication failed for key sk-1234567890abcdef1234567890: invalid credentials";
      const sanitized = sanitizeErrorMessage(raw);
      expect(sanitized).toBe("Authentication failed for key [REDACTED_SECRET]: invalid credentials");
      expect(sanitized).not.toContain("sk-1234567890abcdef1234567890");
    });

    it("redacts Bearer tokens", () => {
      const raw = "Upstream returned 401 with header Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      const sanitized = sanitizeErrorMessage(raw);
      expect(sanitized).toBe("Upstream returned 401 with header Authorization: [REDACTED_SECRET]");
      expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    });

    it("redacts multiple IP addresses and multiple secrets in a single message", () => {
      const raw = "Proxy error from 10.0.0.1 to 172.16.254.1 using sk-key12345678901234567890";
      const sanitized = sanitizeErrorMessage(raw);
      expect(sanitized).toBe("Proxy error from [REDACTED_IP] to [REDACTED_IP] using [REDACTED_SECRET]");
      expect(sanitized).not.toContain("10.0.0.1");
      expect(sanitized).not.toContain("172.16.254.1");
      expect(sanitized).not.toContain("sk-key12345678901234567890");
    });

    it("handles empty or falsy message gracefully", () => {
      expect(sanitizeErrorMessage("")).toBe("");
    });
  });

  describe("formatRouterError", () => {
    it("Format error containing an IP", async () => {
      const error = new Error("Failed to reach upstream host 10.128.0.5: Connection timed out");
      const response = formatRouterError(error);
      expect(response.status).toBe(500);

      const body = (await response.json()) as { error: { message: string; code: string; statusCode: number } };
      expect(body.error.message).toBe("Failed to reach upstream host [REDACTED_IP]: Connection timed out");
      expect(body.error.message).not.toContain("10.128.0.5");
      expect(body.error.code).toBe("INTERNAL_ROUTING_ERROR");
      expect(body.error.statusCode).toBe(500);
    });

    it("Format error containing sk-key", async () => {
      const error = new Error("Upstream rejected token sk-abcdefghijklmnopqrstuvwxyz1234567890");
      const response = formatRouterError(error);
      expect(response.status).toBe(500);

      const body = (await response.json()) as { error: { message: string; code: string; statusCode: number } };
      expect(body.error.message).toBe("Upstream rejected token [REDACTED_SECRET]");
      expect(body.error.message).not.toContain("sk-abcdef");
    });

    it("sanitizes DomainError messages", async () => {
      const error = new RouterError("DO node 192.168.0.1 failed to route sk-12345678901234567890abcdef");
      const response = formatRouterError(error);
      expect(response.status).toBe(500);

      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("DO node [REDACTED_IP] failed to route [REDACTED_SECRET]");
      expect(body.error).not.toContain("192.168.0.1");
      expect(body.error).not.toContain("sk-123456");
    });
  });
});

describe("GATEWAY-001: /v1/report Takedown Endpoint with Timing Shield", () => {
  const handler = new RouterHandler({ requireAuth: false });
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

describe("GATEWAY-001: Midnight Freeze Guard Global Circuit Breaker", () => {
  const handler = new RouterHandler({ requireAuth: false });

  it("MIDNIGHT_FREEZE='true' returns 503", async () => {
    const env = {
      MIDNIGHT_FREEZE: "true",
    } as unknown as WorkerEnv;

    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
    });

    const response = await handler.handle(request, env);
    expect(response.status).toBe(503);

    const body = (await response.json()) as {
      error: {
        message: string;
        type: string;
        code: string;
        statusCode: number;
      };
    };
    expect(body.error.code).toBe("MIDNIGHT_FREEZE");
    expect(body.error.statusCode).toBe(503);
    expect(body.error.type).toBe("service_unavailable");
    expect(body.error.message).toContain("Midnight Freeze");
  });

  it("MIDNIGHT_FREEZE='1' returns 503", async () => {
    const env = {
      MIDNIGHT_FREEZE: "1",
    } as unknown as WorkerEnv;

    const request = new Request("http://localhost/health", {
      method: "GET",
    });

    const response = await handler.handle(request, env);
    expect(response.status).toBe(503);

    const body = (await response.json()) as {
      error: {
        code: string;
        statusCode: number;
      };
    };
    expect(body.error.code).toBe("MIDNIGHT_FREEZE");
    expect(body.error.statusCode).toBe(503);
  });

  it("MIDNIGHT_FREEZE undefined passes through normally", async () => {
    const env = {
      MIDNIGHT_FREEZE: undefined,
    } as unknown as WorkerEnv;

    const request = new Request("http://localhost/health", {
      method: "GET",
    });

    const response = await handler.handle(request, env);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("healthy");
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
            }),
          }),
        }),
      };

      const env = {
        DB: mockDb,
        KC_MASTER_KEY: MASTER_KEY,
      } as unknown as WorkerEnv;

      const handler = new RouterHandler({
        requireAuth: false,
        keyPoolFactory: () => mockKeyPool,
      });

      const request = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      const response = await handler.handle(request, env);
      expect(response.status).toBe(200);

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders?.get("x-goog-api-key")).toBe(rawApiKey);
      expect(capturedHeaders?.get("x-goog-api-key")).not.toBe("key_gemini_test_1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

