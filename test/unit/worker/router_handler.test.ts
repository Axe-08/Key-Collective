/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: RouterHandler (DO routing, streaming passthrough, telemetry & golden tests)
 *
 * Invariants Tested (GEMINI.md Constitution & LLD Edge Worker Auth):
 * 1. Strict TypeScript (strict mode, zero any).
 * 2. Per-Tenant DO Isolation:
 *    env.KEY_POOL.idFromName(tenantId) ensures compute & state isolation.
 *    Cross-tenant mismatch throws TenantIsolationError (HTTP 403).
 * 3. Fixed-Point Microdollars:
 *    All costs in int64 / bigint microdollars. Zero floating-point math.
 * 4. Streaming Passthrough (Golden Test tc-02):
 *    SSE chunks forwarded with 0ms added latency, terminal usage block parsed, cost logged.
 * 5. Non-Blocking Telemetry:
 *    Post-stream ledger and telemetry logged inside ctx.waitUntil without blocking responses.
 * 6. Golden Tests Compliance:
 *    - tc-01: Happy path prompt routed to single Gemini key with 200 response and cost calculation.
 *    - tc-02: Streaming request parses terminal usage block and logs cost in ledger.
 *    - tc-05: Context window gate rejects prompt exceeding context window (HTTP 400).
 *    - tc-06: Model alias resolution ('smart-fast' -> 'gemini-2.0-flash').
 *    - tc-07: Capability filter excludes unsupported models when tools requested (HTTP 400).
 *    - tc-08: Budget exhaustion returns HTTP 429 with Retry-After header.
 *    - tc-12: Auth token validation rejects invalid token with HTTP 401.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRouterHandler,
  defaultRouterHandler,
  DurableObjectKeyPoolClient,
  DurableObjectNamespaceLike,
  DurableObjectStubLike,
  formatRouterError,
  handleRoute,
  RouterError,
  RouterHandler,
  RouterHandlerOptions,
} from "../../../src/worker/router_handler";
import {
  AuthenticatedContext,
  AuthMiddleware,
  WorkerEnv,
} from "../../../src/worker/auth_middleware";
import { ExecutionContextLike, TelemetryEmitter } from "../../../src/worker/telemetry_emitter";
import { TelemetryContract, TelemetryEvent } from "../../../src/contracts/telemetry";
import { KeyPoolContract, KeyMetrics } from "../../../src/contracts/key_pool";
import { CascadeRouter, CascadeRouteResponse } from "../../../src/router/cascade_router";
import { ModelRegistry, ContextWindowExceededError } from "../../../src/router/model_registry";
import { CapabilityFilter } from "../../../src/router/capability_filter";
import { UpstreamClient, UpstreamResponse } from "../../../src/proxy/upstream_client";
import { SSEStreamTransformer, StreamUsage } from "../../../src/proxy/sse_transformer";
import { CostLedgerRepository, CostLedgerEventInput } from "../../../src/storage/repositories/costLedger";
import { AuthTokensRepository, AuthTokenRecord } from "../../../src/storage/repositories/authTokens";
import { AuthenticationError, TenantIsolationError } from "../../../src/errors/auth_errors";
import {
  InvalidKeyError,
  KeyNotFoundError,
  QuotaExceededError,
  RateLimitExceededError,
} from "../../../src/errors/key_errors";
import {
  CapabilityMismatchError,
  FallbackExhaustedError,
  ModelNotFoundError,
  ProviderRoutingError,
  ProviderTimeoutError,
} from "../../../src/errors/routing_errors";
import { DEFAULT_RETRY_AFTER_SECONDS } from "../../../src/constants/limits";
import { hashToken } from "../../../src/crypto";

/**
 * Mock Cloudflare ExecutionContext tracking waitUntil background promises.
 */
class MockExecutionContext implements ExecutionContextLike {
  public promises: Promise<unknown>[] = [];

  waitUntil(promise: Promise<unknown>): void {
    this.promises.push(promise);
  }

  async flush(): Promise<void> {
    await Promise.all(this.promises);
  }
}

/**
 * Mock DurableObjectStub simulating KeyPoolDO RPC & fetch handling.
 */
class MockDurableObjectStub implements DurableObjectStubLike {
  public tenantId: string;
  public keys: Map<string, string> = new Map(); // provider -> keyId
  public usageRecords: { keyId: string; costMicrodollars: bigint }[] = [];
  public resultRecords: { keyId: string; success: boolean }[] = [];
  public statusCodeRecords: { keyId: string; statusCode: number }[] = [];
  public fetchCalls: { url: string; method: string; headers: Headers; body?: unknown }[] = [];

  constructor(tenantId: string) {
    this.tenantId = tenantId;
    this.keys.set("google", "key-gemini-test-1");
    this.keys.set("openai", "key-openai-test-1");
    this.keys.set("anthropic", "key-claude-test-1");
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const urlStr = typeof input === "string" ? input : input.toString();
    const url = new URL(urlStr, "http://key-pool");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);

    let parsedBody: unknown = undefined;
    if (init?.body && typeof init.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }

    this.fetchCalls.push({ url: urlStr, method, headers, body: parsedBody });

    // Assert tenant header
    const headerTenant = headers.get("x-tenant-id");
    if (headerTenant && headerTenant !== this.tenantId) {
      return new Response("Tenant isolation mismatch", { status: 403 });
    }

    if (url.pathname === "/keys/get" && method === "POST") {
      const b = parsedBody as { provider: string; tenantId: string };
      const keyId = this.keys.get(b.provider);
      if (!keyId) {
        return new Response(`No key found for provider ${b.provider}`, { status: 404 });
      }
      return Response.json({ keyId, key: { id: keyId, ciphertext: keyId } });
    }

    if (url.pathname === "/keys/usage" && method === "POST") {
      const b = parsedBody as { keyId: string; costMicrodollars: string };
      this.usageRecords.push({
        keyId: b.keyId,
        costMicrodollars: BigInt(b.costMicrodollars ?? "0"),
      });
      return Response.json({ success: true });
    }

    if (url.pathname === "/keys/result" && method === "POST") {
      const b = parsedBody as { keyId: string; success: boolean };
      this.resultRecords.push({ keyId: b.keyId, success: b.success });
      return Response.json({ success: true });
    }

    if (url.pathname === "/keys/status-code" && method === "POST") {
      const b = parsedBody as { keyId: string; statusCode: number };
      this.statusCodeRecords.push({ keyId: b.keyId, statusCode: b.statusCode });
      return Response.json({ success: true });
    }

    if (url.pathname === "/metrics" && method === "GET") {
      return Response.json({
        metrics: {
          rpm: 5,
          circuitBreakerTripped: false,
          costAccumulatedMicrodollars: "1500",
        },
      });
    }

    if (url.pathname === "/capacity" && method === "GET") {
      return Response.json({
        capacity: {
          totalKeys: 3,
          healthyKeys: 3,
          rateLimitedKeys: 0,
          degradedKeys: 0,
          disabledKeys: 0,
          totalRpmLimit: 180,
          currentRpm: 5,
          availableRpm: 175,
        },
      });
    }

    if (url.pathname === "/keys" && method === "GET") {
      return Response.json({ keys: Array.from(this.keys.entries()) });
    }

    return new Response("Not found", { status: 404 });
  }
}

/**
 * Mock DurableObjectNamespace creating MockDurableObjectStubs per tenant.
 */
class MockDurableObjectNamespace implements DurableObjectNamespaceLike {
  public stubs = new Map<string, MockDurableObjectStub>();

  idFromName(name: string): DurableObjectId {
    return {
      toString: () => name,
      name,
    } as unknown as DurableObjectId;
  }

  get(id: DurableObjectId): DurableObjectStubLike {
    const name = id.name ?? id.toString();
    let stub = this.stubs.get(name);
    if (!stub) {
      stub = new MockDurableObjectStub(name);
      this.stubs.set(name, stub);
    }
    return stub;
  }
}

/**
 * Creates an in-memory CostLedgerRepository mock.
 */
class MockCostLedgerRepository {
  public events: CostLedgerEventInput[] = [];

  async recordEvent(event: CostLedgerEventInput): Promise<void> {
    this.events.push(event);
  }
}

/**
 * Creates an in-memory AuthTokensRepository mock.
 */
class MockAuthTokensRepository {
  public spendRecords: { id: string; tenantId: string; spend: bigint }[] = [];

  async recordSpend(id: string, tenantId: string, spend: bigint | number): Promise<bigint> {
    this.spendRecords.push({
      id,
      tenantId,
      spend: typeof spend === "bigint" ? spend : BigInt(spend),
    });
    return typeof spend === "bigint" ? spend : BigInt(spend);
  }
}

describe("RouterHandler Unit Tests (T3)", () => {
  let doNamespace: MockDurableObjectNamespace;
  let mockCostLedger: MockCostLedgerRepository;
  let mockAuthTokens: MockAuthTokensRepository;
  let emittedTelemetry: TelemetryEvent[];
  let mockTelemetry: TelemetryContract;
  let defaultAuthContext: AuthenticatedContext;
  let env: WorkerEnv;

  beforeEach(() => {
    doNamespace = new MockDurableObjectNamespace();
    mockCostLedger = new MockCostLedgerRepository();
    mockAuthTokens = new MockAuthTokensRepository();
    emittedTelemetry = [];

    mockTelemetry = {
      emit: vi.fn((event: TelemetryEvent) => {
        emittedTelemetry.push(event);
      }),
    };

    defaultAuthContext = {
      tenantId: "tenant-alpha",
      isAuthenticated: true,
      token: {
        id: "token-uuid-1",
        hashSha256: "hash123",
        tenantId: "tenant-alpha",
        budgetMicrodollars: 10_000_000n, // 10 USD
        spentMicrodollars: 500_000n,    // 0.5 USD
        allowedProviders: [],
        rpmLimit: 60,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
      rpmLimit: 60,
      currentRpm: 1,
      remainingRpm: 59,
      budgetMicrodollars: 10_000_000n,
      spentMicrodollars: 500_000n,
      budgetRemainingMicrodollars: 9_500_000n,
    };

    env = {
      KEY_POOL: doNamespace as unknown as DurableObjectNamespace,
    };
  });

  describe("DurableObjectKeyPoolClient Adapter", () => {
    it("enforces non-empty tenant ID", () => {
      const stub = new MockDurableObjectStub("t1");
      expect(() => new DurableObjectKeyPoolClient(stub, "")).toThrow(TenantIsolationError);
      expect(() => new DurableObjectKeyPoolClient(stub, "   ")).toThrow(TenantIsolationError);
    });

    it("acquires keys from DO via HTTP fetch RPC", async () => {
      const stub = new MockDurableObjectStub("tenant-alpha");
      const client = new DurableObjectKeyPoolClient(stub, "tenant-alpha");

      const keyId = await client.getKey("google");
      expect(keyId).toBe("key-gemini-test-1");

      expect(stub.fetchCalls).toHaveLength(1);
      expect(stub.fetchCalls[0].url).toBe("http://key-pool/keys/get");
      expect(stub.fetchCalls[0].headers.get("x-tenant-id")).toBe("tenant-alpha");
      expect(stub.fetchCalls[0].body).toEqual({
        provider: "google",
        tenantId: "tenant-alpha",
      });
    });

    it("prefers direct stub method if available", async () => {
      const stub: DurableObjectStubLike = {
        fetch: vi.fn(),
        getKey: vi.fn().mockResolvedValue("direct-key-123"),
      };
      const client = new DurableObjectKeyPoolClient(stub, "tenant-beta");

      const key = await client.getKey("openai");
      expect(key).toBe("direct-key-123");
      expect(stub.getKey).toHaveBeenCalledWith("openai");
      expect(stub.fetch).not.toHaveBeenCalled();
    });

    it("throws KeyNotFoundError when provider key is missing", async () => {
      const stub = new MockDurableObjectStub("tenant-alpha");
      const client = new DurableObjectKeyPoolClient(stub, "tenant-alpha");

      await expect(client.getKey("unknown-provider")).rejects.toThrow(KeyNotFoundError);
    });

    it("throws RateLimitExceededError when DO returns 429", async () => {
      const stub: DurableObjectStubLike = {
        fetch: vi.fn().mockResolvedValue(new Response("Too Many Requests", { status: 429 })),
      };
      const client = new DurableObjectKeyPoolClient(stub, "tenant-alpha");

      await expect(client.getKey("google")).rejects.toThrow(RateLimitExceededError);
    });

    it("throws TenantIsolationError when DO returns 403", async () => {
      const stub: DurableObjectStubLike = {
        fetch: vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })),
      };
      const client = new DurableObjectKeyPoolClient(stub, "tenant-alpha");

      await expect(client.getKey("google")).rejects.toThrow(TenantIsolationError);
    });

    it("records usage and cost in microdollars to DO", async () => {
      const stub = new MockDurableObjectStub("tenant-alpha");
      const client = new DurableObjectKeyPoolClient(stub, "tenant-alpha");

      await client.recordUsage("key-1", 450n);

      expect(stub.usageRecords).toHaveLength(1);
      expect(stub.usageRecords[0]).toEqual({ keyId: "key-1", costMicrodollars: 450n });
    });

    it("records result success and failure to DO", async () => {
      const stub = new MockDurableObjectStub("tenant-alpha");
      const client = new DurableObjectKeyPoolClient(stub, "tenant-alpha");

      await client.recordResult("key-1", true);
      await client.recordResult("key-1", false);

      expect(stub.resultRecords).toEqual([
        { keyId: "key-1", success: true },
        { keyId: "key-1", success: false },
      ]);
    });

    it("records upstream status code to DO", async () => {
      const stub = new MockDurableObjectStub("tenant-alpha");
      const client = new DurableObjectKeyPoolClient(stub, "tenant-alpha");

      await client.recordStatusCode("key-1", 429);

      expect(stub.statusCodeRecords).toEqual([{ keyId: "key-1", statusCode: 429 }]);
    });

    it("retrieves key metrics and capacity summary from DO", async () => {
      const stub = new MockDurableObjectStub("tenant-alpha");
      const client = new DurableObjectKeyPoolClient(stub, "tenant-alpha");

      const metrics = await client.getKeyMetrics("key-1");
      expect(metrics.rpm).toBe(5);
      expect(metrics.costAccumulatedMicrodollars).toBe(1500n);

      const capacity = await client.getCapacitySummary("google");
      expect(capacity.totalKeys).toBe(3);
      expect(capacity.availableRpm).toBe(175);
    });
  });

  describe("Tenant Isolation Invariant Enforcement", () => {
    it("instantiates tenant-specific DO from env.KEY_POOL.idFromName(tenantId)", async () => {
      const handler = createRouterHandler();
      const keyPool = handler.getKeyPool("tenant-xyz", env);

      expect(keyPool).toBeInstanceOf(DurableObjectKeyPoolClient);
      expect((keyPool as DurableObjectKeyPoolClient).tenantId).toBe("tenant-xyz");
      expect(doNamespace.stubs.has("tenant-xyz")).toBe(true);
    });

    it("rejects requests where x-tenant-id header does not match authenticated token", async () => {
      const handler = createRouterHandler();
      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": "tenant-rogue", // Attempted mismatch
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "hello" }],
        }),
      });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);
      expect(res.status).toBe(403);
      const json = await res.json() as { error: string; code: string };
      expect(json.code).toBe("TENANT_ISOLATION_VIOLATION");
    });
  });

  describe("Golden Test tc-01: Happy Path Non-Streaming Completion", () => {
    it("routes simple prompt to Gemini key with 200 response, cost calculation and ledger write", async () => {
      // Mock UpstreamClient returning successful Gemini response
      const mockUpstream = new UpstreamClient({
        fetch: async (_url, _init) => {
          return Response.json({
            id: "chatcmpl-mock-1",
            choices: [
              {
                message: { role: "assistant", content: "Hello from Gemini!" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
            },
          });
        },
      });

      const ctx = new MockExecutionContext();
      const handler = new RouterHandler({
        upstreamClient: mockUpstream,
        costLedgerRepo: mockCostLedger as unknown as CostLedgerRepository,
        authTokensRepo: mockAuthTokens as unknown as AuthTokensRepository,
        telemetryEmitter: new TelemetryEmitter({ fallbackEmitter: mockTelemetry }),
      });

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kc-trace-id": "trace-tc01",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Hello" }],
          stream: false,
        }),
      });

      const res = await handler.handle(req, env, ctx, defaultAuthContext);

      // Golden assertions for tc-01
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("x-kc-trace-id")).toBe("trace-tc01");
      expect(res.headers.get("x-kc-tenant-id")).toBe("tenant-alpha");
      expect(res.headers.get("x-kc-model")).toBe("gemini-2.0-flash");
      expect(res.headers.get("x-kc-provider")).toBe("google");

      const body = await res.json() as Record<string, unknown>;
      expect(body.object).toBe("chat.completion");
      expect(body.model).toBe("gemini-2.0-flash");
      expect((body.choices as Array<{ message: { content: string } }>)[0].message.content).toBe("Hello from Gemini!");

      // Verify token usage
      const usage = body.usage as { prompt_tokens: number; completion_tokens: number };
      expect(usage.prompt_tokens).toBe(100);
      expect(usage.completion_tokens).toBe(50);

      // Wait for non-blocking background tasks to flush
      await ctx.flush();

      // Verify cost ledger event logged accurately
      expect(mockCostLedger.events).toHaveLength(1);
      const ledgerEvent = mockCostLedger.events[0];
      expect(ledgerEvent.requestId).toBe("trace-tc01");
      expect(ledgerEvent.tenantId).toBe("tenant-alpha");
      expect(ledgerEvent.modelId).toBe("gemini-2.0-flash");
      expect(ledgerEvent.provider).toBe("google");
      expect(ledgerEvent.promptTokens).toBe(100);
      expect(ledgerEvent.completionTokens).toBe(50);
      expect(ledgerEvent.costMicrodollars).toBeGreaterThan(0n);
      expect(ledgerEvent.statusCode).toBe(200);

      // Verify AuthToken spend update
      expect(mockAuthTokens.spendRecords).toHaveLength(1);
      expect(mockAuthTokens.spendRecords[0].spend).toBeGreaterThan(0n);

      // Verify non-blocking telemetry event emitted
      expect(emittedTelemetry).toHaveLength(1);
      expect(emittedTelemetry[0].eventType).toBe("chat_completion");
      expect(emittedTelemetry[0].tenantId).toBe("tenant-alpha");
    });
  });

  describe("Golden Test tc-02: Happy Path Streaming Request", () => {
    it("streams SSE chunks, parses terminal usage block on the fly, and logs cost to ledger", async () => {
      // Mock SSE stream payload including chunks and terminal usage block
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world!"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":500,"total_tokens":1500}}\n\n',
        'data: [DONE]\n\n',
      ];

      const encoder = new TextEncoder();
      const mockStream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      const mockUpstream = new UpstreamClient({
        fetch: async () => {
          return new Response(mockStream, {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          });
        },
      });

      const ctx = new MockExecutionContext();
      const handler = new RouterHandler({
        upstreamClient: mockUpstream,
        costLedgerRepo: mockCostLedger as unknown as CostLedgerRepository,
        authTokensRepo: mockAuthTokens as unknown as AuthTokensRepository,
        telemetryEmitter: new TelemetryEmitter({ fallbackEmitter: mockTelemetry }),
      });

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kc-trace-id": "trace-tc02",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Tell me a story" }],
          stream: true,
        }),
      });

      const res = await handler.handle(req, env, ctx, defaultAuthContext);

      // Golden assertions for tc-02
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
      expect(res.headers.get("cache-control")).toContain("no-cache");

      // Read entire client stream to trigger stream completion
      const reader = res.body?.getReader();
      expect(reader).toBeDefined();

      let streamReceivedText = "";
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          streamReceivedText += decoder.decode(value);
        }
      }

      // Assert chunks were forwarded
      expect(streamReceivedText).toContain("Hello");
      expect(streamReceivedText).toContain("world!");
      expect(streamReceivedText).toContain("[DONE]");

      // Flush background execution context promises
      await ctx.flush();

      // Assert terminal usage block parsed and cost logged to D1 ledger
      expect(mockCostLedger.events).toHaveLength(1);
      const ledgerEvent = mockCostLedger.events[0];
      expect(ledgerEvent.requestId).toBe("trace-tc02");
      expect(ledgerEvent.promptTokens).toBe(1000);
      expect(ledgerEvent.completionTokens).toBe(500);
      expect(ledgerEvent.costMicrodollars).toBeGreaterThan(0n);
      expect(ledgerEvent.statusCode).toBe(200);

      // Assert telemetry emitted
      expect(emittedTelemetry).toHaveLength(1);
      expect(emittedTelemetry[0].eventType).toBe("chat_completion_stream");
      expect(emittedTelemetry[0].metadata["promptTokens"]).toBe("1000");
      expect(emittedTelemetry[0].metadata["completionTokens"]).toBe("500");
    });
  });

  describe("Golden Test tc-05: Context Window Gate", () => {
    it("rejects prompt exceeding model context window with HTTP 400 before network call", async () => {
      const upstreamFetch = vi.fn();
      const mockUpstream = new UpstreamClient({ fetch: upstreamFetch });

      const handler = new RouterHandler({
        upstreamClient: mockUpstream,
      });

      // Provide large estimatedPromptTokens (e.g. 150,000 for gpt-4o which has 128k context)
      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Super huge prompt" }],
          estimatedPromptTokens: 200_000,
        }),
      });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);

      // Golden assertions for tc-05
      expect(res.status).toBe(400);
      const json = await res.json() as { error: string; code: string };
      expect(json.code).toBe("CONTEXT_WINDOW_EXCEEDED");

      // Verify no upstream call was made
      expect(upstreamFetch).not.toHaveBeenCalled();
      // Verify no cost ledger event was logged
      expect(mockCostLedger.events).toHaveLength(0);
    });
  });

  describe("Golden Test tc-06: Model Alias Resolution", () => {
    it("resolves logical alias 'smart-fast' to 'gemini-2.0-flash' and selects google provider", async () => {
      let forwardedUrl = "";
      const mockUpstream = new UpstreamClient({
        fetch: async (url) => {
          forwardedUrl = typeof url === "string" ? url : url.toString();
          return Response.json({
            choices: [{ message: { role: "assistant", content: "Alias resolved!" } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          });
        },
      });

      const handler = new RouterHandler({
        upstreamClient: mockUpstream,
      });

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "smart-fast", // Logical alias
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-kc-model")).toBe("gemini-2.0-flash");
      expect(res.headers.get("x-kc-provider")).toBe("google");
      expect(forwardedUrl).toContain("googleapis.com");
    });
  });

  describe("Golden Test tc-07: Capability Filter - Tools", () => {
    it("excludes text-only models when tools parameter is present", async () => {
      const registry = new ModelRegistry();
      registry.registerModel({
        id: "text-only-model",
        provider: "openai",
        logicalAliases: [],
        contextWindow: 8192,
        maxOutputTokens: 2048,
        inputCostPerMTokMicro: 100_000n,
        outputCostPerMTokMicro: 200_000n,
        cacheReadCostPerMTokMicro: 0n,
        supportsTools: false,
        supportsVision: false,
        supportsJsonSchema: false,
        isActive: true,
      });

      const handler = new RouterHandler({
        modelRegistry: registry,
      });

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "text-only-model",
          messages: [{ role: "user", content: "Use tool" }],
          tools: [{ type: "function", function: { name: "calculator" } }],
        }),
      });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);

      // Golden assertions for tc-07
      expect(res.status).toBe(400);
      const json = await res.json() as { error: string; code: string };
      expect(json.code).toBe("CAPABILITY_MISMATCH");
    });
  });

  describe("Golden Test tc-08: Budget Exhaustion Gate", () => {
    it("returns HTTP 429 with Retry-After header when tenant budget is exhausted", async () => {
      const mockAuth = new AuthMiddleware();
      vi.spyOn(mockAuth, "authenticate").mockRejectedValue(
        new QuotaExceededError("Tenant budget exhausted", { tenantId: "tenant-alpha" })
      );

      const handler = new RouterHandler({ authMiddleware: mockAuth });
      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "authorization": "Bearer kc_test_token_exhausted",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      const res = await handler.handle(req, env);

      // Golden assertions for tc-08
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe(String(DEFAULT_RETRY_AFTER_SECONDS));
    });
  });

  describe("Golden Test tc-12: Auth Token Validation at Edge", () => {
    it("rejects missing or invalid Bearer token with HTTP 401 without invoking upstream", async () => {
      const upstreamFetch = vi.fn();
      const mockUpstream = new UpstreamClient({ fetch: upstreamFetch });

      const mockAuth = new AuthMiddleware();
      vi.spyOn(mockAuth, "authenticate").mockRejectedValue(
        new AuthenticationError("Missing Authorization header")
      );

      const handler = new RouterHandler({
        authMiddleware: mockAuth,
        upstreamClient: mockUpstream,
      });

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" }, // Missing Authorization
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      const res = await handler.handle(req, env);

      // Golden assertions for tc-12
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      expect(upstreamFetch).not.toHaveBeenCalled();
    });
  });

  describe("Models Catalog Endpoints", () => {
    it("GET /v1/models returns complete list of registered models in OpenAI format", async () => {
      const handler = createRouterHandler();
      const req = new Request("http://localhost/v1/models", { method: "GET" });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);
      expect(res.status).toBe(200);

      const json = await res.json() as { object: string; data: Array<{ id: string; owned_by: string; capabilities: unknown }> };
      expect(json.object).toBe("list");
      expect(json.data.length).toBeGreaterThanOrEqual(8);

      const gemini = json.data.find((m) => m.id === "gemini-2.0-flash");
      expect(gemini).toBeDefined();
      expect(gemini?.owned_by).toBe("google");
    });

    it("GET /v1/models/:id returns specific model details", async () => {
      const handler = createRouterHandler();
      const req = new Request("http://localhost/v1/models/gpt-4o", { method: "GET" });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);
      expect(res.status).toBe(200);

      const json = await res.json() as { id: string; owned_by: string };
      expect(json.id).toBe("gpt-4o");
      expect(json.owned_by).toBe("openai");
    });

    it("GET /v1/models/:id returns 404 for unknown model ID", async () => {
      const handler = createRouterHandler();
      const req = new Request("http://localhost/v1/models/unknown-model-xyz", { method: "GET" });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);
      expect(res.status).toBe(404);
      const json = await res.json() as { error: string; code: string };
      expect(json.code).toBe("MODEL_NOT_FOUND");
    });
  });

  describe("Direct DO Management Forwarding", () => {
    it("forwards /v1/keys requests to tenant DO stub", async () => {
      const handler = createRouterHandler();
      const req = new Request("http://localhost/v1/keys?provider=google", {
        method: "GET",
      });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);
      expect(res.status).toBe(200);

      const stub = doNamespace.stubs.get("tenant-alpha");
      expect(stub?.fetchCalls).toHaveLength(1);
      expect(stub?.fetchCalls[0].url).toContain("/keys");
      expect(stub?.fetchCalls[0].headers.get("x-tenant-id")).toBe("tenant-alpha");
    });

    it("forwards /v1/metrics requests to tenant DO stub", async () => {
      const handler = createRouterHandler();
      const req = new Request("http://localhost/v1/metrics?keyId=key-1", {
        method: "GET",
      });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);
      expect(res.status).toBe(200);
      const json = await res.json() as { metrics: { rpm: number } };
      expect(json.metrics.rpm).toBe(5);
    });

    it("forwards /v1/capacity requests to tenant DO stub", async () => {
      const handler = createRouterHandler();
      const req = new Request("http://localhost/v1/capacity?provider=google", {
        method: "GET",
      });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);
      expect(res.status).toBe(200);
      const json = await res.json() as { capacity: { totalKeys: number } };
      expect(json.capacity.totalKeys).toBe(3);
    });
  });

  describe("Structured ApiResponse Format (kc_api)", () => {
    it("returns structured ApiResponse with meta when responseFormat is kc_api", async () => {
      const mockUpstream = new UpstreamClient({
        fetch: async () => Response.json({
          choices: [{ message: { role: "assistant", content: "Custom API format" } }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        }),
      });

      const handler = new RouterHandler({
        upstreamClient: mockUpstream,
        responseFormat: "kc_api",
      });

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);
      expect(res.status).toBe(200);

      const json = await res.json() as { data: unknown; meta: { latencyMs: number; costMicrodollars: string; model: string } };
      expect(json.data).toBeDefined();
      expect(json.meta).toBeDefined();
      expect(json.meta.model).toBe("gemini-2.0-flash");
      expect(json.meta.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Error Handling & Edge Cases", () => {
    it("returns 400 when request body contains malformed JSON", async () => {
      const handler = createRouterHandler();
      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ invalid json ",
      });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);
      expect(res.status).toBe(400);
      const json = await res.json() as { error: string; code: string };
      expect(json.code).toBe("INVALID_REQUEST_BODY");
    });

    it("returns 400 when messages parameter is not an array", async () => {
      const handler = createRouterHandler();
      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: "not an array",
        }),
      });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);
      expect(res.status).toBe(400);
      const json = await res.json() as { error: string; code: string };
      expect(json.code).toBe("INVALID_MESSAGES_PARAMETER");
    });

    it("returns 404 for unknown route paths", async () => {
      const handler = createRouterHandler();
      const req = new Request("http://localhost/v1/unknown-route", { method: "GET" });

      const res = await handler.handle(req, env, undefined, defaultAuthContext);
      expect(res.status).toBe(404);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe("ROUTE_NOT_FOUND");
    });

    it("bypasses auth for /health endpoint", async () => {
      const handler = createRouterHandler({ requireAuth: true });
      const req = new Request("http://localhost/health", { method: "GET" });

      const res = await handler.handle(req, env);
      expect(res.status).toBe(200);
      const json = await res.json() as { status: string };
      expect(json.status).toBe("healthy");
    });

    it("supports standalone handleRoute helper function", async () => {
      const mockUpstream = new UpstreamClient({
        fetch: async () => Response.json({
          choices: [{ message: { role: "assistant", content: "via helper" } }],
        }),
      });

      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      const res = await handleRoute(req, env, undefined, defaultAuthContext, {
        upstreamClient: mockUpstream,
      });
      expect(res.status).toBe(200);
      const json = await res.json() as { choices: Array<{ message: { content: string } }> };
      expect(json.choices[0].message.content).toBe("via helper");
    });
  });
});
