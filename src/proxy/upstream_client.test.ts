/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: UpstreamClient (proxy-upstream-client)
 *
 * Conforms to:
 * - LLD 3.2 & 4.0: Unit tests for UpstreamClient HTTP request handling,
 *   header rewriting, key injection, streaming passthrough via SSEStreamTransformer,
 *   endpoint mapping, and error mapping for CascadeRouter fallbacks.
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no `any`).
 * - No Plaintext Keys: Keys injected solely into headers, never leaked in errors.
 * - Non-blocking hot path: Streaming passthrough delivers chunks with 0ms added latency.
 * - Fixed-Point Microdollars: All pricing calculations utilize int64 / bigint microdollars.
 */

import { describe, it, expect, vi } from "vitest";
import {
  UpstreamClient,
  rewriteHeaders,
  buildProviderUrl,
  mapUpstreamHttpError,
  parseRetryAfter,
  extractContentFromPayload,
  DEFAULT_PROVIDER_BASE_URLS,
  DEFAULT_PROVIDER_ENDPOINTS,
} from "./upstream_client";
import {
  RateLimitExceededError,
  InvalidKeyError,
  ProviderRoutingError,
  ProviderTimeoutError,
} from "../errors";
import type { KeyPoolContract } from "../contracts/key_pool";
import type { StreamUsage } from "./sse_transformer";

describe("UpstreamClient", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  /**
   * Helper to create a readable byte stream from chunk strings.
   */
  function createChunkStream(chunks: string[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  }

  /**
   * Helper to consume a ReadableStream<Uint8Array | string> as string.
   */
  async function readStreamToString(
    stream: ReadableStream<Uint8Array | string>
  ): Promise<string> {
    const reader = stream.getReader();
    let result = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (typeof value === "string") {
        result += value;
      } else {
        result += decoder.decode(value, { stream: true });
      }
    }
    result += decoder.decode();
    return result;
  }

  describe("Unit: Header Rewriting (rewriteHeaders)", () => {
    it("strips client-side authentication headers", () => {
      const incoming: Record<string, string> = {
        authorization: "Bearer client-secret-token",
        "x-api-key": "client-api-key",
        "api-key": "another-key",
        "proxy-authorization": "Basic xyz",
        "kc-token": "kc-jwt-token",
        "kc-tenant-id": "tenant-123",
        "kc-trace-id": "trace-abc",
        "kc-key-id": "key-xyz",
        "x-custom-tenant": "keep-this-one",
      };

      const rewritten = rewriteHeaders("openai", incoming, "sk-upstream-secret");

      expect(rewritten.has("x-api-key")).toBe(false);
      expect(rewritten.has("api-key")).toBe(false);
      expect(rewritten.has("proxy-authorization")).toBe(false);
      expect(rewritten.has("kc-token")).toBe(false);
      expect(rewritten.has("kc-tenant-id")).toBe(false);
      expect(rewritten.has("kc-trace-id")).toBe(false);
      expect(rewritten.has("kc-key-id")).toBe(false);
      expect(rewritten.get("x-custom-tenant")).toBe("keep-this-one");
      // Authorization must be rewritten with upstream key
      expect(rewritten.get("authorization")).toBe("Bearer sk-upstream-secret");
    });

    it("strips hop-by-hop headers per RFC 7230", () => {
      const incoming: Record<string, string> = {
        connection: "keep-alive",
        "keep-alive": "timeout=5",
        "proxy-authenticate": "Basic",
        te: "trailers",
        trailer: "Expires",
        "transfer-encoding": "chunked",
        upgrade: "websocket",
        host: "proxy.internal.net",
        "x-request-id": "req-12345",
      };

      const rewritten = rewriteHeaders("openai", incoming, "sk-test");

      expect(rewritten.has("connection")).toBe(false);
      expect(rewritten.has("keep-alive")).toBe(false);
      expect(rewritten.has("proxy-authenticate")).toBe(false);
      expect(rewritten.has("te")).toBe(false);
      expect(rewritten.has("trailer")).toBe(false);
      expect(rewritten.has("transfer-encoding")).toBe(false);
      expect(rewritten.has("upgrade")).toBe(false);
      expect(rewritten.has("host")).toBe(false);
      expect(rewritten.get("x-request-id")).toBe("req-12345");
    });

    it("strips Cloudflare edge internal headers (cf-*, x-forwarded-*)", () => {
      const incoming: Record<string, string> = {
        "cf-ray": "8c5932a934-EWR",
        "cf-connecting-ip": "1.2.3.4",
        "cf-ipcountry": "US",
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
        "x-forwarded-proto": "https",
        "user-agent": "MyApp/1.0",
      };

      const rewritten = rewriteHeaders("openai", incoming, "sk-test");

      expect(rewritten.has("cf-ray")).toBe(false);
      expect(rewritten.has("cf-connecting-ip")).toBe(false);
      expect(rewritten.has("cf-ipcountry")).toBe(false);
      expect(rewritten.has("x-forwarded-for")).toBe(false);
      expect(rewritten.has("x-forwarded-proto")).toBe(false);
      expect(rewritten.get("user-agent")).toBe("MyApp/1.0");
    });

    it("injects OpenAI/Groq/DeepSeek provider key as Authorization: Bearer <key>", () => {
      const providers = ["openai", "groq", "deepseek", "mistral", "together", "cohere"];

      for (const provider of providers) {
        const headers = rewriteHeaders(provider, {}, "test-provider-key");
        expect(headers.get("authorization")).toBe("Bearer test-provider-key");
        expect(headers.has("x-api-key")).toBe(false);
      }
    });

    it("injects Anthropic provider key as x-api-key and sets anthropic-version", () => {
      const headers = rewriteHeaders("anthropic", {}, "sk-ant-test-key");

      expect(headers.get("x-api-key")).toBe("sk-ant-test-key");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(headers.has("authorization")).toBe(false);
    });

    it("preserves custom anthropic-version if provided by client", () => {
      const incoming = { "anthropic-version": "2024-01-01" };
      const headers = rewriteHeaders("anthropic", incoming, "sk-ant-test-key");

      expect(headers.get("x-api-key")).toBe("sk-ant-test-key");
      expect(headers.get("anthropic-version")).toBe("2024-01-01");
    });

    it("injects Google/Gemini key as x-goog-api-key and Authorization: Bearer", () => {
      const gHeaders = rewriteHeaders("google", {}, "AIzaSyTestKey");
      expect(gHeaders.get("x-goog-api-key")).toBe("AIzaSyTestKey");
      expect(gHeaders.get("authorization")).toBe("Bearer AIzaSyTestKey");

      const geminiHeaders = rewriteHeaders("gemini", {}, "AIzaSyTestKey");
      expect(geminiHeaders.get("x-goog-api-key")).toBe("AIzaSyTestKey");
      expect(geminiHeaders.get("authorization")).toBe("Bearer AIzaSyTestKey");
    });

    it("enforces Content-Type: application/json if missing", () => {
      const headers = rewriteHeaders("openai", {});
      expect(headers.get("content-type")).toBe("application/json");
    });

    it("preserves existing custom Content-Type", () => {
      const headers = rewriteHeaders("openai", { "content-type": "application/json; charset=utf-8" });
      expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
    });

    it("sets Accept: text/event-stream when stream mode is requested", () => {
      const headers = rewriteHeaders("openai", {}, "sk-test", { stream: true });
      expect(headers.get("accept")).toBe("text/event-stream");
    });

    it("sets Accept: application/json when non-streaming and no accept header provided", () => {
      const headers = rewriteHeaders("openai", {}, "sk-test", { stream: false });
      expect(headers.get("accept")).toBe("application/json");
    });

    it("accepts Headers object as incoming headers input", () => {
      const input = new Headers();
      input.set("authorization", "Bearer client-key");
      input.set("x-custom-foo", "bar");

      const headers = rewriteHeaders("openai", input, "sk-upstream");
      expect(headers.get("authorization")).toBe("Bearer sk-upstream");
      expect(headers.get("x-custom-foo")).toBe("bar");
    });
  });

  describe("Unit: Endpoint Mapping & URL Construction (buildUrl)", () => {
    it("maps standard default provider chat endpoints", () => {
      expect(buildProviderUrl("openai")).toBe("https://api.openai.com/v1/chat/completions");
      expect(buildProviderUrl("anthropic")).toBe("https://api.anthropic.com/v1/messages");
      expect(buildProviderUrl("google")).toBe(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
      );
      expect(buildProviderUrl("gemini")).toBe(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
      );
      expect(buildProviderUrl("groq")).toBe("https://api.groq.com/openai/v1/chat/completions");
      expect(buildProviderUrl("deepseek")).toBe("https://api.deepseek.com/v1/chat/completions");
      expect(buildProviderUrl("cohere")).toBe("https://api.cohere.com/v1/chat");
      expect(buildProviderUrl("mistral")).toBe("https://api.mistral.ai/v1/chat/completions");
      expect(buildProviderUrl("together")).toBe("https://api.together.xyz/v1/chat/completions");
    });

    it("normalizes /chat/completions for Anthropic to /messages", () => {
      expect(buildProviderUrl("anthropic", "/chat/completions")).toBe(
        "https://api.anthropic.com/v1/messages"
      );
    });

    it("normalizes /chat/completions for Google to /openai/chat/completions", () => {
      expect(buildProviderUrl("google", "/chat/completions")).toBe(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
      );
      expect(buildProviderUrl("gemini", "/chat/completions")).toBe(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
      );
    });

    it("handles Google native generateContent endpoints with model parameter", () => {
      const url = buildProviderUrl(
        "google",
        ":generateContent",
        "gemini-2.0-flash"
      );
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
      );
    });

    it("appends custom relative endpoints cleanly without double slashes", () => {
      expect(buildProviderUrl("openai", "/embeddings")).toBe(
        "https://api.openai.com/v1/embeddings"
      );
      expect(buildProviderUrl("openai", "embeddings")).toBe(
        "https://api.openai.com/v1/embeddings"
      );
    });

    it("returns absolute URLs directly without modifying host or path", () => {
      const absolute = "https://my-custom-proxy.internal/v1/chat/completions";
      expect(buildProviderUrl("openai", absolute)).toBe(absolute);
    });

    it("respects baseUrls overrides in constructor options", () => {
      const client = new UpstreamClient({
        baseUrls: {
          openai: "https://mock-openai.local/v1",
          anthropic: "https://mock-anthropic.local",
        },
      });

      expect(client.buildUrl("openai")).toBe(
        "https://mock-openai.local/v1/chat/completions"
      );
      expect(client.buildUrl("anthropic")).toBe(
        "https://mock-anthropic.local/messages"
      );
      // Unspecified provider falls back to default
      expect(client.buildUrl("groq")).toBe(
        "https://api.groq.com/openai/v1/chat/completions"
      );
    });
  });

  describe("Unit: Error Mapping & Fallback Triggers (mapError)", () => {
    it("maps HTTP 429 to RateLimitExceededError and parses integer Retry-After header", () => {
      const headers = new Headers({ "retry-after": "45" });
      const err = mapUpstreamHttpError(
        "openai",
        429,
        "Rate limit exceeded: TPM limit reached",
        headers
      );

      expect(err).toBeInstanceOf(RateLimitExceededError);
      const rlErr = err as RateLimitExceededError;
      expect(rlErr.statusCode).toBe(429);
      expect(rlErr.provider).toBe("openai");
      expect(rlErr.retryAfterSeconds).toBe(45);
      expect(rlErr.message).toContain("rate limit exceeded");
    });

    it("maps HTTP 429 with HTTP-date Retry-After header to seconds delta", () => {
      const futureDate = new Date(Date.now() + 30_000).toUTCString();
      const headers = new Headers({ "retry-after": futureDate });
      const err = mapUpstreamHttpError("groq", 429, "Too Many Requests", headers);

      expect(err).toBeInstanceOf(RateLimitExceededError);
      const rlErr = err as RateLimitExceededError;
      expect(rlErr.retryAfterSeconds).toBeGreaterThanOrEqual(25);
      expect(rlErr.retryAfterSeconds).toBeLessThanOrEqual(35);
    });

    it("defaults Retry-After to 60 seconds when header is missing or unparseable", () => {
      expect(parseRetryAfter(null)).toBe(60);
      expect(parseRetryAfter("")).toBe(60);
      expect(parseRetryAfter("invalid-date-string")).toBe(60);
    });

    it("maps HTTP 401 and 403 to InvalidKeyError", () => {
      const err401 = mapUpstreamHttpError(
        "anthropic",
        401,
        "x-api-key header is invalid or revoked"
      );
      expect(err401).toBeInstanceOf(InvalidKeyError);
      const keyErr401 = err401 as InvalidKeyError;
      expect(keyErr401.statusCode).toBe(400);
      expect(keyErr401.provider).toBe("anthropic");
      expect(keyErr401.reason).toContain("invalid or revoked");

      const err403 = mapUpstreamHttpError("google", 403, "API key not authorized for model");
      expect(err403).toBeInstanceOf(InvalidKeyError);
    });

    it("maps HTTP 408 and 504 to ProviderTimeoutError", () => {
      const err408 = mapUpstreamHttpError(
        "openai",
        408,
        "Request Timeout",
        undefined,
        "gpt-4o",
        15_000
      );
      expect(err408).toBeInstanceOf(ProviderTimeoutError);
      const timeoutErr408 = err408 as ProviderTimeoutError;
      expect(timeoutErr408.statusCode).toBe(504);
      expect(timeoutErr408.provider).toBe("openai");
      expect(timeoutErr408.modelId).toBe("gpt-4o");
      expect(timeoutErr408.timeoutMs).toBe(15_000);

      const err504 = mapUpstreamHttpError("deepseek", 504, "Gateway Timeout");
      expect(err504).toBeInstanceOf(ProviderTimeoutError);
    });

    it("maps HTTP 500, 502, 503 to ProviderRoutingError (HTTP 502 Bad Gateway)", () => {
      const err500 = mapUpstreamHttpError("mistral", 500, "Internal Server Error");
      expect(err500).toBeInstanceOf(ProviderRoutingError);
      const routeErr500 = err500 as ProviderRoutingError;
      expect(routeErr500.statusCode).toBe(502);
      expect(routeErr500.upstreamStatusCode).toBe(500);

      const err503 = mapUpstreamHttpError("anthropic", 503, "Service Unavailable");
      expect(err503).toBeInstanceOf(ProviderRoutingError);
      const routeErr503 = err503 as ProviderRoutingError;
      expect(routeErr503.upstreamStatusCode).toBe(503);
    });

    it("maps HTTP 400, 404, 422 to ProviderRoutingError", () => {
      const err400 = mapUpstreamHttpError("openai", 400, "Invalid JSON body");
      expect(err400).toBeInstanceOf(ProviderRoutingError);
      expect((err400 as ProviderRoutingError).upstreamStatusCode).toBe(400);

      const err404 = mapUpstreamHttpError("google", 404, "Model not found");
      expect(err404).toBeInstanceOf(ProviderRoutingError);
      expect((err404 as ProviderRoutingError).upstreamStatusCode).toBe(404);
    });
  });

  describe("Unit: Content Extraction (extractContentFromPayload)", () => {
    it("extracts OpenAI/Groq/DeepSeek message content", () => {
      const payload = {
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello from OpenAI!" },
            finish_reason: "stop",
          },
        ],
      };
      expect(extractContentFromPayload(payload)).toBe("Hello from OpenAI!");
    });

    it("extracts OpenAI legacy choices[0].text format", () => {
      const payload = {
        choices: [{ text: "Hello legacy text!" }],
      };
      expect(extractContentFromPayload(payload)).toBe("Hello legacy text!");
    });

    it("extracts Anthropic content blocks format", () => {
      const payload = {
        content: [
          { type: "text", text: "Hello from " },
          { type: "text", text: "Anthropic Claude!" },
        ],
      };
      expect(extractContentFromPayload(payload)).toBe("Hello from Anthropic Claude!");
    });

    it("extracts Google Gemini candidates parts format", () => {
      const payload = {
        candidates: [
          {
            content: {
              parts: [{ text: "Hello from Gemini 2.0!" }],
              role: "model",
            },
          },
        ],
      };
      expect(extractContentFromPayload(payload)).toBe("Hello from Gemini 2.0!");
    });

    it("extracts Cohere format", () => {
      expect(extractContentFromPayload({ text: "Hello from Cohere!" })).toBe(
        "Hello from Cohere!"
      );
      expect(
        extractContentFromPayload({
          message: { content: "Hello from Cohere v2!" },
        })
      ).toBe("Hello from Cohere v2!");
    });

    it("returns empty string for null or non-object payloads", () => {
      expect(extractContentFromPayload(null)).toBe("");
      expect(extractContentFromPayload(undefined)).toBe("");
      expect(extractContentFromPayload("string")).toBe("");
      expect(extractContentFromPayload({})).toBe("");
    });
  });

  describe("Integration: KeyPool Key Injection & Telemetry", () => {
    it("throws InvalidKeyError when no key is provided and no KeyPool configured", async () => {
      const client = new UpstreamClient();

      await expect(
        client.send({
          provider: "openai",
          body: { model: "gpt-4o", messages: [] },
        })
      ).rejects.toThrow(InvalidKeyError);
    });

    it("automatically fetches key from KeyPool when apiKey is omitted", async () => {
      const mockKeyPool: KeyPoolContract = {
        getKey: vi.fn().mockResolvedValue("pool-injected-api-key"),
        recordUsage: vi.fn().mockResolvedValue(undefined),
        recordResult: vi.fn().mockResolvedValue(undefined),
      };

      let capturedAuth = "";
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (_url, init) => {
        const headers = new Headers(init?.headers);
        capturedAuth = headers.get("authorization") ?? "";
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const client = new UpstreamClient({
        keyPool: mockKeyPool,
        fetch: mockFetch,
      });

      const res = await client.send({
        provider: "openai",
        model: "gpt-4o",
        body: { messages: [] },
      });

      expect(mockKeyPool.getKey).toHaveBeenCalledWith("openai");
      expect(capturedAuth).toBe("Bearer pool-injected-api-key");
      expect(res.ok).toBe(true);
      expect(mockKeyPool.recordResult).toHaveBeenCalledWith("pool-injected-api-key", true);
    });

    it("uses explicit apiKey if passed, bypassing KeyPool.getKey", async () => {
      const mockKeyPool: KeyPoolContract = {
        getKey: vi.fn(),
        recordUsage: vi.fn().mockResolvedValue(undefined),
        recordResult: vi.fn().mockResolvedValue(undefined),
      };

      let capturedAuth = "";
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (_url, init) => {
        const headers = new Headers(init?.headers);
        capturedAuth = headers.get("authorization") ?? "";
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const client = new UpstreamClient({
        keyPool: mockKeyPool,
        fetch: mockFetch,
      });

      await client.send({
        provider: "openai",
        apiKey: "explicit-key-override",
        keyId: "explicit-key-id",
        body: { messages: [] },
      });

      expect(mockKeyPool.getKey).not.toHaveBeenCalled();
      expect(capturedAuth).toBe("Bearer explicit-key-override");
      expect(mockKeyPool.recordResult).toHaveBeenCalledWith("explicit-key-id", true);
    });

    it("resolves encrypted or raw key via custom keyResolver hook", async () => {
      const mockKeyPool: KeyPoolContract = {
        getKey: vi.fn().mockResolvedValue("key-id-123"),
        recordUsage: vi.fn().mockResolvedValue(undefined),
        recordResult: vi.fn().mockResolvedValue(undefined),
      };

      const keyResolver = vi.fn().mockResolvedValue("decrypted-plain-key");

      let capturedAuth = "";
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (_url, init) => {
        const headers = new Headers(init?.headers);
        capturedAuth = headers.get("authorization") ?? "";
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const client = new UpstreamClient({
        keyPool: mockKeyPool,
        keyResolver,
        fetch: mockFetch,
      });

      await client.send({
        provider: "openai",
        body: {},
      });

      expect(keyResolver).toHaveBeenCalledWith("key-id-123", "openai");
      expect(capturedAuth).toBe("Bearer decrypted-plain-key");
      // Results recorded under original keyId
      expect(mockKeyPool.recordResult).toHaveBeenCalledWith("key-id-123", true);
    });

    it("records failure on KeyPool when upstream returns error status", async () => {
      const mockKeyPool: KeyPoolContract = {
        getKey: vi.fn().mockResolvedValue("failing-key-id"),
        recordUsage: vi.fn().mockResolvedValue(undefined),
        recordResult: vi.fn().mockResolvedValue(undefined),
      };

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "retry-after": "60" },
        });
      });

      const client = new UpstreamClient({
        keyPool: mockKeyPool,
        fetch: mockFetch,
      });

      await expect(
        client.send({
          provider: "openai",
          body: {},
        })
      ).rejects.toThrow(RateLimitExceededError);

      expect(mockKeyPool.recordResult).toHaveBeenCalledWith("failing-key-id", false);
    });

    it("records usage with int64 microdollars when costCalculator is provided (non-streaming)", async () => {
      const mockKeyPool: KeyPoolContract = {
        getKey: vi.fn().mockResolvedValue("active-key-id"),
        recordUsage: vi.fn().mockResolvedValue(undefined),
        recordResult: vi.fn().mockResolvedValue(undefined),
      };

      const costCalculator = vi.fn().mockReturnValue(125_000n); // 0.125 USD = 125,000 µ$

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Hello world" } }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      });

      const client = new UpstreamClient({
        keyPool: mockKeyPool,
        costCalculator,
        fetch: mockFetch,
      });

      const res = await client.send({
        provider: "openai",
        model: "gpt-4o",
        body: {},
      });

      // Calling json extracts usage and triggers recordUsage
      const json = await res.json();
      expect(json).toBeDefined();

      expect(costCalculator).toHaveBeenCalled();
      expect(mockKeyPool.recordUsage).toHaveBeenCalledWith("active-key-id", 125_000n);
    });
  });

  describe("Integration: Streaming Passthrough (SSEStreamTransformer)", () => {
    it("pipes streaming response through SSEStreamTransformer and yields raw chunks", async () => {
      const sseChunks = [
        'data: {"id":"1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"id":"2","choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: {"id":"3","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":10,"total_tokens":15}}\n\n',
        "data: [DONE]\n\n",
      ];

      const stream = createChunkStream(sseChunks);
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      );

      const client = new UpstreamClient({ fetch: mockFetch });
      const res = await client.send({
        provider: "openai",
        apiKey: "sk-stream-test",
        stream: true,
        body: { stream: true },
      });

      expect(res.ok).toBe(true);
      expect(res.body).toBeDefined();
      expect(res.transformer).toBeDefined();

      // Read through stream to trigger passthrough
      const consumedText = await readStreamToString(res.body!);
      expect(consumedText).toBe(sseChunks.join(""));

      // Intercepted usage block
      const usage = await res.getUsage();
      expect(usage).toBeDefined();
      expect(usage?.promptTokens).toBe(5);
      expect(usage?.completionTokens).toBe(10);
      expect(usage?.totalTokens).toBe(15);

      // Intercepted metadata
      const metadata = await res.getMetadata();
      expect(metadata).toBeDefined();
      expect(metadata?.chunkCount).toBe(4);
      expect(metadata?.eventCount).toBe(4);
    });

    it("triggers onUsage and onMetadata callbacks during stream lifecycle", async () => {
      const sseChunks = [
        'data: {"id":"1","model":"gpt-4o","choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"id":"2","usage":{"prompt_tokens":12,"completion_tokens":24,"total_tokens":36}}\n\n',
        "data: [DONE]\n\n",
      ];

      const stream = createChunkStream(sseChunks);
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      );

      const onUsage = vi.fn();
      const onMetadata = vi.fn();

      const client = new UpstreamClient({ fetch: mockFetch });
      const res = await client.send({
        provider: "openai",
        apiKey: "sk-test",
        stream: true,
        onUsage,
        onMetadata,
        body: { stream: true },
      });

      await readStreamToString(res.body!);

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          promptTokens: 12,
          completionTokens: 24,
          totalTokens: 36,
        })
      );
      expect(onMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          chunkCount: 3,
          eventCount: 3,
        })
      );
    });

    it("records usage and result to KeyPool on clean stream close", async () => {
      const mockKeyPool: KeyPoolContract = {
        getKey: vi.fn(),
        recordUsage: vi.fn().mockResolvedValue(undefined),
        recordResult: vi.fn().mockResolvedValue(undefined),
      };

      const costCalculator = vi.fn().mockReturnValue(500_000n);

      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Done"}}]}\n\n',
        'data: {"usage":{"prompt_tokens":20,"completion_tokens":40,"total_tokens":60}}\n\n',
        "data: [DONE]\n\n",
      ];

      const stream = createChunkStream(sseChunks);
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      );

      const client = new UpstreamClient({
        keyPool: mockKeyPool,
        costCalculator,
        fetch: mockFetch,
      });

      const res = await client.send({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "sk-test",
        keyId: "streaming-key-id",
        stream: true,
      });

      await readStreamToString(res.body!);

      // KeyPool result recorded
      expect(mockKeyPool.recordResult).toHaveBeenCalledWith("streaming-key-id", true);
      // Cost calculated and usage recorded
      expect(costCalculator).toHaveBeenCalled();
      expect(mockKeyPool.recordUsage).toHaveBeenCalledWith("streaming-key-id", 500_000n);
    });

    it("throws ProviderRoutingError if streaming response body is null", async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue(
        new Response(null, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      );

      const client = new UpstreamClient({ fetch: mockFetch });
      await expect(
        client.send({
          provider: "openai",
          apiKey: "sk-test",
          stream: true,
        })
      ).rejects.toThrow(ProviderRoutingError);
    });
  });

  describe("Integration: High-Level Chat Completions (chat)", () => {
    it("formats OpenAI request and returns parsed UpstreamChatResponse", async () => {
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (url, init) => {
        expect(url).toBe("https://api.openai.com/v1/chat/completions");
        const body = JSON.parse(init?.body as string);
        expect(body.model).toBe("gpt-4o");
        expect(body.temperature).toBe(0.7);
        expect(body.stream).toBe(false);

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: "assistant", content: "Chat response here" },
              },
            ],
            usage: {
              prompt_tokens: 15,
              completion_tokens: 25,
              total_tokens: 40,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      });

      const costCalculator = vi.fn().mockReturnValue(400_000n);

      const client = new UpstreamClient({
        fetch: mockFetch,
        costCalculator,
      });

      const chatRes = await client.chat({
        provider: "openai",
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello!" }],
        temperature: 0.7,
        apiKey: "sk-test",
      });

      expect(chatRes.content).toBe("Chat response here");
      expect(chatRes.model).toBe("gpt-4o");
      expect(chatRes.provider).toBe("openai");
      expect(chatRes.usage?.totalTokens).toBe(40);
      expect(chatRes.costMicrodollars).toBe(400_000n);
    });

    it("formats Anthropic request ensuring max_tokens is present", async () => {
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (url, init) => {
        expect(url).toBe("https://api.anthropic.com/v1/messages");
        const body = JSON.parse(init?.body as string);
        expect(body.model).toBe("claude-3-5-sonnet");
        expect(body.max_tokens).toBe(4096); // Defaults to 4096 if unspecified

        return new Response(
          JSON.stringify({
            content: [{ type: "text", text: "Claude response" }],
            usage: { input_tokens: 10, output_tokens: 20 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      });

      const client = new UpstreamClient({ fetch: mockFetch });

      const chatRes = await client.chat({
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        messages: [{ role: "user", content: "Hello Claude!" }],
        apiKey: "sk-ant-test",
      });

      expect(chatRes.content).toBe("Claude response");
      expect(chatRes.provider).toBe("anthropic");
    });

    it("returns empty content with streaming response when stream: true in chat()", async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Part 1"}}]}\n\n',
        "data: [DONE]\n\n",
      ];
      const stream = createChunkStream(sseChunks);
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      );

      const client = new UpstreamClient({ fetch: mockFetch });
      const chatRes = await client.chat({
        provider: "openai",
        model: "gpt-4o",
        messages: [],
        stream: true,
        apiKey: "sk-test",
      });

      expect(chatRes.content).toBe("");
      expect(chatRes.response.body).toBeDefined();
    });
  });

  describe("Integration: toClientResponse Helper", () => {
    it("converts UpstreamResponse to standard Response stripping hop-by-hop headers", async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue(
        new Response("OK body", {
          status: 200,
          headers: {
            "content-type": "text/plain",
            connection: "keep-alive",
            "content-length": "7",
            "x-custom-header": "test-val",
          },
        })
      );

      const client = new UpstreamClient({ fetch: mockFetch });
      const upstreamRes = await client.send({
        provider: "openai",
        apiKey: "sk-test",
      });

      const clientRes = client.toClientResponse(upstreamRes, {
        "x-edge-trace": "trace-123",
      });

      expect(clientRes.status).toBe(200);
      expect(clientRes.headers.get("content-type")).toBe("text/plain");
      expect(clientRes.headers.get("x-custom-header")).toBe("test-val");
      expect(clientRes.headers.get("x-edge-trace")).toBe("trace-123");
      expect(clientRes.headers.has("connection")).toBe(false);
      expect(clientRes.headers.has("content-length")).toBe(false);
    });
  });

  describe("Unit: Network Errors & Timeout Handling", () => {
    it("throws ProviderRoutingError on low-level fetch network failure", async () => {
      const mockFetch: typeof fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      const client = new UpstreamClient({ fetch: mockFetch });
      await expect(
        client.send({
          provider: "openai",
          apiKey: "sk-test",
        })
      ).rejects.toThrow(ProviderRoutingError);
    });

    it("throws ProviderTimeoutError when request timeout fires", async () => {
      // Mock fetch that hangs until aborted
      const mockFetch: typeof fetch = vi.fn().mockImplementation((_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      });

      const client = new UpstreamClient({
        fetch: mockFetch,
        defaultTimeoutMs: 50, // Fast timeout for test
      });

      await expect(
        client.send({
          provider: "openai",
          apiKey: "sk-test",
          timeoutMs: 50,
        })
      ).rejects.toThrow(ProviderTimeoutError);
    });
  });
});
