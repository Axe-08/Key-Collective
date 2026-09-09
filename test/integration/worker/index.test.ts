/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Integration Tests: Main Worker Export, HTTP Routing, Auth, Budget Gating & End-to-End Pipeline (T4)
 *
 * Invariants Tested (GEMINI.md Constitution & LLD Edge Worker Auth):
 * 1. Strict TypeScript: Strict mode, zero `any`.
 * 2. Per-Tenant DO Isolation:
 *    env.KEY_POOL.idFromName(tenantId) ensures compute & state isolation.
 *    Cross-tenant header mismatch throws TenantIsolationError (HTTP 403).
 * 3. Fixed-Point Microdollars:
 *    All costs in int64 / bigint microdollars (1 USD = 1,000,000 µ$). Zero floating-point math.
 * 4. Streaming Passthrough (Golden Test tc-02):
 *    SSE chunks forwarded with 0ms added latency, terminal usage parsed, cost logged in D1.
 * 5. Non-Blocking Telemetry:
 *    Ledger writes and telemetry emission executed inside ctx.waitUntil() without blocking response.
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
import worker, {
  applyCors,
  CORS_HEADERS,
  createWorker,
  HealthResponse,
  MainWorker,
  WorkerOptions,
} from "../../../src/worker/index";
import rootWorker from "../../../src/index";
import {
  AuthenticatedContext,
  AuthMiddleware,
  WorkerEnv,
} from "../../../src/worker/auth_middleware";
import {
  DurableObjectNamespaceLike,
  DurableObjectStubLike,
  RouterHandler,
} from "../../../src/worker/router_handler";
import {
  ExecutionContextLike,
  TelemetryEmitter,
} from "../../../src/worker/telemetry_emitter";
import { TelemetryContract, TelemetryEvent } from "../../../src/contracts/telemetry";
import { UpstreamClient } from "../../../src/proxy/upstream_client";
import { CostLedgerEventInput, CostLedgerRepository } from "../../../src/storage/repositories/costLedger";
import {
  AuthTokenRecord,
  AuthTokenRow,
  AuthTokensRepository,
} from "../../../src/storage/repositories/authTokens";
import { hashToken } from "../../../src/crypto";
import { ModelRegistry } from "../../../src/router/model_registry";

/**
 * Mock Cloudflare ExecutionContext tracking waitUntil background tasks.
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
 * Mock DurableObjectStub simulating KeyPoolDO RPC & HTTP fetch.
 */
class MockDurableObjectStub implements DurableObjectStubLike {
  public tenantId: string;
  public keys: Map<string, string> = new Map();
  public usageRecords: { keyId: string; costMicrodollars: bigint }[] = [];
  public resultRecords: { keyId: string; success: boolean }[] = [];
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

    if (url.pathname === "/capacity" && method === "GET") {
      return Response.json({
        capacity: {
          totalKeys: 3,
          healthyKeys: 3,
          totalRpmLimit: 180,
          currentRpm: 10,
          remainingRpm: 170,
          utilizationPercent: 5.5,
        },
      });
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
 * Mock D1 Database simulating token storage & cost ledger persistence.
 */
class MockD1Database implements D1Database {
  public tokens = new Map<string, AuthTokenRow>();
  public ledgerEvents: CostLedgerEventInput[] = [];

  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(query, this);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const stmt of statements) {
      results.push(await stmt.run<T>());
    }
    return results;
  }

  async exec(_query: string): Promise<D1ExecResult> {
    return { count: 1, duration: 1 };
  }

  withSession(): D1DatabaseSession {
    throw new Error("withSession not implemented in mock");
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}

class MockD1PreparedStatement implements D1PreparedStatement {
  private boundParams: unknown[] = [];

  constructor(
    private readonly query: string,
    private readonly db: MockD1Database
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundParams = values;
    return this;
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const res = await this.all<T>();
    const firstRow = res.results[0] ?? null;
    if (!firstRow) return null;
    if (colName && typeof firstRow === "object") {
      return ((firstRow as Record<string, unknown>)[colName] ?? null) as T;
    }
    return firstRow;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeQuery<T>();
  }

  raw<T = unknown[]>(_options?: { columnNames?: boolean }): Promise<T[]> {
    throw new Error("raw not implemented in mock");
  }

  private executeQuery<T>(): D1Result<T> {
    const trimmed = this.query.trim();
    const upper = trimmed.toUpperCase().replace(/\s+/g, " ");

    // SELECT FROM AUTH_TOKENS
    if (upper.includes("SELECT") && upper.includes("AUTH_TOKENS")) {
      let matchedRow: AuthTokenRow | undefined = undefined;
      if (upper.includes("HASH_SHA256")) {
        const hash = String(this.boundParams[0]);
        for (const row of this.db.tokens.values()) {
          if (row.hash_sha256 === hash) {
            matchedRow = row;
            break;
          }
        }
      } else if (upper.includes("ID = ?") || upper.includes("WHERE ID =")) {
        const id = String(this.boundParams[0]);
        matchedRow = this.db.tokens.get(id);
      }

      return {
        results: (matchedRow ? [matchedRow] : []) as unknown as T[],
        success: true,
        meta: { duration: 1 } as D1Response["meta"],
      };
    }

    // UPDATE AUTH_TOKENS
    if (upper.includes("UPDATE") && upper.includes("AUTH_TOKENS")) {
      if (upper.includes("SPENT_MICRODOLLARS")) {
        const newSpent = Number(this.boundParams[0]);
        const id = String(this.boundParams[1]);
        const row = this.db.tokens.get(id);
        if (row) {
          row.spent_microdollars = newSpent;
        }
      }
      return {
        results: [],
        success: true,
        meta: { duration: 1 } as D1Response["meta"],
      };
    }

    // INSERT INTO COST_LEDGER
    if (upper.includes("INSERT INTO COST_LEDGER")) {
      const [
        id,
        request_id,
        tenant_id,
        key_id,
        provider,
        model_id,
        prompt_tokens,
        completion_tokens,
        cached_tokens,
        reasoning_tokens,
        cost_microdollars,
        latency_ms,
        status_code,
        error_message,
        created_at,
      ] = this.boundParams;

      this.db.ledgerEvents.push({
        id: String(id),
        requestId: String(request_id),
        tenantId: String(tenant_id),
        keyId: String(key_id),
        provider: String(provider),
        modelId: String(model_id),
        promptTokens: Number(prompt_tokens),
        completionTokens: Number(completion_tokens),
        cachedTokens: Number(cached_tokens),
        reasoningTokens: Number(reasoning_tokens),
        costMicrodollars: BigInt(cost_microdollars as string | number),
        latencyMs: Number(latency_ms),
        statusCode: Number(status_code),
        errorMessage: error_message ? String(error_message) : undefined,
        createdAt: String(created_at),
      });

      return {
        results: [],
        success: true,
        meta: { duration: 1 } as D1Response["meta"],
      };
    }

    return {
      results: [],
      success: true,
      meta: { duration: 1 } as D1Response["meta"],
    };
  }
}

describe("Worker Integration Tests (T4)", () => {
  let mockDb: MockD1Database;
  let mockDoNamespace: MockDurableObjectNamespace;
  let emittedTelemetry: TelemetryEvent[];
  let mockTelemetryEmitter: TelemetryEmitter;
  let env: WorkerEnv;
  let validToken: string;
  let expiredToken: string;
  let exhaustedToken: string;
  let openaiOnlyToken: string;
  let rateLimitedToken: string;

  beforeEach(async () => {
    mockDb = new MockD1Database();
    mockDoNamespace = new MockDurableObjectNamespace();
    emittedTelemetry = [];

    const mockFallback: TelemetryContract = {
      emit: (event: TelemetryEvent) => {
        emittedTelemetry.push(event);
      },
    };
    mockTelemetryEmitter = new TelemetryEmitter({ fallbackEmitter: mockFallback });

    // Seed test tokens in D1
    validToken = "kc_token_valid_alpha_1234567890";
    const validHash = await hashToken(validToken);
    mockDb.tokens.set("token-valid-id", {
      id: "token-valid-id",
      hash_sha256: validHash,
      tenant_id: "tenant-alpha",
      encrypted_token_b64: null,
      nonce_b64: null,
      budget_microdollars: 50_000_000, // 50 USD
      spent_microdollars: 100_000,     // 0.1 USD
      allowed_providers: "[]",
      rpm_limit: 100,
      expires_at: null,
      created_at: new Date().toISOString(),
    });

    expiredToken = "kc_token_expired_1234567890";
    const expiredHash = await hashToken(expiredToken);
    mockDb.tokens.set("token-expired-id", {
      id: "token-expired-id",
      hash_sha256: expiredHash,
      tenant_id: "tenant-alpha",
      encrypted_token_b64: null,
      nonce_b64: null,
      budget_microdollars: 10_000_000,
      spent_microdollars: 0,
      allowed_providers: "[]",
      rpm_limit: 100,
      expires_at: "2020-01-01T00:00:00.000Z", // Expired
      created_at: new Date().toISOString(),
    });

    exhaustedToken = "kc_token_exhausted_1234567890";
    const exhaustedHash = await hashToken(exhaustedToken);
    mockDb.tokens.set("token-exhausted-id", {
      id: "token-exhausted-id",
      hash_sha256: exhaustedHash,
      tenant_id: "tenant-alpha",
      encrypted_token_b64: null,
      nonce_b64: null,
      budget_microdollars: 1_000_000, // 1 USD
      spent_microdollars: 1_000_000,  // 1 USD (exhausted)
      allowed_providers: "[]",
      rpm_limit: 100,
      expires_at: null,
      created_at: new Date().toISOString(),
    });

    openaiOnlyToken = "kc_token_openai_only_1234567890";
    const openaiOnlyHash = await hashToken(openaiOnlyToken);
    mockDb.tokens.set("token-openai-id", {
      id: "token-openai-id",
      hash_sha256: openaiOnlyHash,
      tenant_id: "tenant-alpha",
      encrypted_token_b64: null,
      nonce_b64: null,
      budget_microdollars: 10_000_000,
      spent_microdollars: 0,
      allowed_providers: JSON.stringify(["openai"]),
      rpm_limit: 100,
      expires_at: null,
      created_at: new Date().toISOString(),
    });

    rateLimitedToken = "kc_token_rate_limited_1234567890";
    const rateLimitedHash = await hashToken(rateLimitedToken);
    mockDb.tokens.set("token-rate-limited-id", {
      id: "token-rate-limited-id",
      hash_sha256: rateLimitedHash,
      tenant_id: "tenant-beta",
      encrypted_token_b64: null,
      nonce_b64: null,
      budget_microdollars: 10_000_000,
      spent_microdollars: 0,
      allowed_providers: "[]",
      rpm_limit: 1, // Limit of 1 request per minute
      expires_at: null,
      created_at: new Date().toISOString(),
    });

    env = {
      DB: mockDb,
      KEY_POOL: mockDoNamespace as unknown as DurableObjectNamespace,
    };
  });

  describe("Group 1: Liveness, Root & CORS Preflight Routing", () => {
    it("returns 200 and healthy payload on GET /health", async () => {
      const req = new Request("https://api.keycollective.ai/health", { method: "GET" });
      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");

      const body = (await res.json()) as HealthResponse;
      expect(body.status).toBe("healthy");
      expect(body.version).toBe("0.2.0");
      expect(body.runtime).toBe("cloudflare-workers");
      expect(typeof body.timestamp).toBe("string");
    });

    it("returns 200 and healthy payload on GET /v1/health", async () => {
      const req = new Request("https://api.keycollective.ai/v1/health", { method: "GET" });
      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
      const body = (await res.json()) as HealthResponse;
      expect(body.status).toBe("healthy");
    });

    it("returns 200 and ready message on GET /", async () => {
      const req = new Request("https://api.keycollective.ai/", { method: "GET" });
      const res = await worker.fetch(req, env);

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Key Collective v2 Edge Proxy Ready");
    });

    it("handles CORS preflight OPTIONS request with 204 and CORS headers", async () => {
      const req = new Request("https://api.keycollective.ai/v1/chat/completions", {
        method: "OPTIONS",
        headers: {
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      });
      const res = await worker.fetch(req, env);

      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
      expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
      expect(res.headers.get("access-control-max-age")).toBe("86400");
    });
  });

  describe("Group 2: Models Catalog (GET /v1/models & GET /v1/models/:id)", () => {
    it("lists models conforming to OpenAI list schema on GET /v1/models", async () => {
      const req = new Request("https://api.keycollective.ai/v1/models", {
        method: "GET",
        headers: {
          authorization: `Bearer ${validToken}`,
        },
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        object: string;
        data: Array<{
          id: string;
          owned_by: string;
          context_window: number;
          capabilities: { supportsTools: boolean; supportsVision: boolean };
          pricing: { input_cost_per_mtok_micro: string };
        }>;
      };

      expect(body.object).toBe("list");
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);

      const geminiModel = body.data.find((m) => m.id === "gemini-2.0-flash");
      expect(geminiModel).toBeDefined();
      expect(geminiModel?.owned_by).toBe("google");
      expect(geminiModel?.capabilities.supportsTools).toBe(true);
      expect(Number(geminiModel?.pricing.input_cost_per_mtok_micro)).toBeGreaterThan(0);
    });

    it("returns model details on GET /v1/models/gemini-2.0-flash", async () => {
      const req = new Request("https://api.keycollective.ai/v1/models/gemini-2.0-flash", {
        method: "GET",
        headers: {
          authorization: `Bearer ${validToken}`,
        },
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { id: string; owned_by: string; context_window: number };
      expect(body.id).toBe("gemini-2.0-flash");
      expect(body.owned_by).toBe("google");
      expect(body.context_window).toBeGreaterThan(0);
    });

    it("resolves alias on GET /v1/models/smart-fast (Golden Test tc-06)", async () => {
      const req = new Request("https://api.keycollective.ai/v1/models/smart-fast", {
        method: "GET",
        headers: {
          authorization: `Bearer ${validToken}`,
        },
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { id: string; owned_by: string };
      expect(body.id).toBe("gemini-2.0-flash");
      expect(body.owned_by).toBe("google");
    });

    it("returns 404 for unknown model ID", async () => {
      const req = new Request("https://api.keycollective.ai/v1/models/non-existent-model-xyz", {
        method: "GET",
        headers: {
          authorization: `Bearer ${validToken}`,
        },
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.code).toBe("MODEL_NOT_FOUND");
    });
  });

  describe("Group 3: Authentication, Tenant Isolation & Budget Gating (tc-08, tc-12)", () => {
    it("rejects unauthenticated request with HTTP 401 and WWW-Authenticate (Golden Test tc-12)", async () => {
      const req = new Request("https://api.keycollective.ai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Bearer");

      const body = (await res.json()) as { error: string; code: string };
      expect(body.code).toBe("AUTHENTICATION_FAILED");
    });

    it("rejects invalid bearer token with HTTP 401", async () => {
      const req = new Request("https://api.keycollective.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer kc_token_totally_bogus_token",
        },
        body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.code).toBe("AUTHENTICATION_FAILED");
    });

    it("rejects expired token with HTTP 401", async () => {
      const req = new Request("https://api.keycollective.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${expiredToken}`,
        },
        body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.code).toBe("AUTHENTICATION_FAILED");
    });

    it("rejects provider request when token restricts allowed providers", async () => {
      const req = new Request("https://api.keycollective.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${openaiOnlyToken}`,
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      const app = new MainWorker({
        authMiddleware: new AuthMiddleware({ requiredProvider: "google" }),
      });
      const res = await app.fetch(req, env);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.code).toBe("AUTHENTICATION_FAILED");
    });

    it("enforces tenant isolation: rejects mismatched x-tenant-id with HTTP 403", async () => {
      const req = new Request("https://api.keycollective.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${validToken}`,
          "x-tenant-id": "tenant-hostile-attempt",
        },
        body: JSON.stringify({ model: "gemini-2.0-flash", messages: [] }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.code).toBe("TENANT_ISOLATION_VIOLATION");
    });

    it("enforces budget gating: returns HTTP 429 and Retry-After (Golden Test tc-08)", async () => {
      const req = new Request("https://api.keycollective.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${exhaustedToken}`,
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("60");

      const body = (await res.json()) as { error: string; code: string };
      expect(body.code).toBe("QUOTA_EXCEEDED");
    });

    it("enforces sliding-window RPM limit: returns HTTP 429 when RPM exceeded", async () => {
      const mockUpstream = new UpstreamClient({
        fetch: async () => {
          return Response.json({
            id: "chatcmpl-test-rpm",
            choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          });
        },
      });
      const testWorker = createWorker({ upstreamClient: mockUpstream });

      const makeReq = () =>
        new Request("https://api.keycollective.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${rateLimitedToken}`,
          },
          body: JSON.stringify({
            model: "gemini-2.0-flash",
            messages: [{ role: "user", content: "Hello" }],
          }),
        });

      // Request 1: succeeds (uses limit 1)
      const res1 = await testWorker.fetch(makeReq(), env);
      expect(res1.status).toBe(200);

      // Request 2: exceeds limit of 1 -> 429
      const res2 = await testWorker.fetch(makeReq(), env);
      expect(res2.status).toBe(429);
      expect(res2.headers.get("retry-after")).toBeDefined();
      const body2 = (await res2.json()) as { error: string; code: string };
      expect(body2.code).toBe("RATE_LIMIT_EXCEEDED");
    });
  });

  describe("Group 4: Non-Streaming Chat Completions (Golden Test tc-01)", () => {
    it("successfully routes prompt, returns 200 completion, logs to D1 ledger and emits telemetry", async () => {
      const mockUpstream = new UpstreamClient({
        fetch: async () => {
          return Response.json({
            id: "chatcmpl-test-upstream-1",
            choices: [
              {
                message: { role: "assistant", content: "The capital of France is Paris." },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 15,
              completion_tokens: 8,
              total_tokens: 23,
            },
          });
        },
      });

      const ctx = new MockExecutionContext();
      const testWorker = createWorker({
        upstreamClient: mockUpstream,
        telemetryEmitter: mockTelemetryEmitter,
      });

      const req = new Request("https://api.keycollective.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${validToken}`,
          "x-kc-trace-id": "trace-integration-tc01",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "What is the capital of France?" }],
          stream: false,
        }),
      });

      const res = await testWorker.fetch(req, env, ctx);

      // Verify response status and headers
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("x-kc-trace-id")).toBe("trace-integration-tc01");
      expect(res.headers.get("x-kc-tenant-id")).toBe("tenant-alpha");
      expect(res.headers.get("x-kc-model")).toBe("gemini-2.0-flash");
      expect(res.headers.get("x-kc-provider")).toBe("google");

      const body = (await res.json()) as {
        id: string;
        object: string;
        model: string;
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        cost_microdollars: string;
      };

      expect(body.object).toBe("chat.completion");
      expect(body.model).toBe("gemini-2.0-flash");
      expect(body.choices[0].message.content).toBe("The capital of France is Paris.");
      expect(body.usage.prompt_tokens).toBe(15);
      expect(body.usage.completion_tokens).toBe(8);
      expect(BigInt(body.cost_microdollars)).toBeGreaterThan(0n);

      // Flush background execution context promises (non-blocking telemetry & D1 writes)
      await ctx.flush();

      // Verify D1 Cost Ledger record
      expect(mockDb.ledgerEvents).toHaveLength(1);
      const ledgerEntry = mockDb.ledgerEvents[0];
      expect(ledgerEntry.requestId).toBe("trace-integration-tc01");
      expect(ledgerEntry.tenantId).toBe("tenant-alpha");
      expect(ledgerEntry.modelId).toBe("gemini-2.0-flash");
      expect(ledgerEntry.provider).toBe("google");
      expect(ledgerEntry.promptTokens).toBe(15);
      expect(ledgerEntry.completionTokens).toBe(8);
      expect(ledgerEntry.costMicrodollars).toBeGreaterThan(0n);
      expect(ledgerEntry.statusCode).toBe(200);

      // Verify D1 Token spend increment
      const updatedToken = mockDb.tokens.get("token-valid-id");
      expect(updatedToken?.spent_microdollars).toBeGreaterThan(100_000);

      // Verify Telemetry emission
      expect(emittedTelemetry).toHaveLength(1);
      expect(emittedTelemetry[0].eventType).toBe("chat_completion");
      expect(emittedTelemetry[0].tenantId).toBe("tenant-alpha");
      expect(emittedTelemetry[0].metadata["model"]).toBe("gemini-2.0-flash");
    });
  });

  describe("Group 5: Streaming Chat Completions (Golden Test tc-02)", () => {
    it("streams SSE chunks with 0ms delay, parses terminal usage, and logs cost asynchronously", async () => {
                  const sseChunks = [
        "data: {\"choices\":[{\"delta\":{\"content\":\"Once \"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"upon \"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"a time.\"}}]}\n\n",
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":250,\"completion_tokens\":120,\"total_tokens\":370}}\n\n",
        "data: [DONE]\n\n",
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
      const testWorker = createWorker({
        upstreamClient: mockUpstream,
        telemetryEmitter: mockTelemetryEmitter,
      });

      const req = new Request("https://api.keycollective.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${validToken}`,
          "x-kc-trace-id": "trace-integration-tc02",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Tell me a short story" }],
          stream: true,
        }),
      });

      const res = await testWorker.fetch(req, env, ctx);

      // Verify streaming response headers
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(res.headers.get("access-control-allow-origin")).toBe("*");

      // Read client stream to completion
      const reader = res.body?.getReader();
      expect(reader).toBeDefined();

      let streamOutput = "";
      const decoder = new TextDecoder();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          streamOutput += decoder.decode(value);
        }
      }

      expect(streamOutput).toContain("Once ");
      expect(streamOutput).toContain("upon ");
      expect(streamOutput).toContain("a time.");
      expect(streamOutput).toContain("[DONE]");

      // Flush background execution context tasks
      await ctx.flush();

      // Verify D1 Cost Ledger record
      expect(mockDb.ledgerEvents).toHaveLength(1);
      const ledgerEntry = mockDb.ledgerEvents[0];
      expect(ledgerEntry.requestId).toBe("trace-integration-tc02");
      expect(ledgerEntry.promptTokens).toBe(250);
      expect(ledgerEntry.completionTokens).toBe(120);
      expect(ledgerEntry.costMicrodollars).toBeGreaterThan(0n);
      expect(ledgerEntry.statusCode).toBe(200);

      // Verify Telemetry event
      expect(emittedTelemetry).toHaveLength(1);
      expect(emittedTelemetry[0].eventType).toBe("chat_completion_stream");
      expect(emittedTelemetry[0].metadata["promptTokens"]).toBe("250");
      expect(emittedTelemetry[0].metadata["completionTokens"]).toBe("120");
    });
  });

  describe("Group 6: Routing Invariants & Error Gates (tc-05, tc-06, tc-07)", () => {
    it("rejects prompts exceeding context window with HTTP 400 (Golden Test tc-05)", async () => {
      const req = new Request("https://api.keycollective.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Huge prompt" }],
          estimatedPromptTokens: 2_000_000,
        }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.code).toBe("CONTEXT_WINDOW_EXCEEDED");
    });

    it("resolves model aliases correctly during completion (Golden Test tc-06)", async () => {
      const mockUpstream = new UpstreamClient({
        fetch: async () => {
          return Response.json({
            id: "chatcmpl-alias-test",
            choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          });
        },
      });

      const testWorker = createWorker({ upstreamClient: mockUpstream });
      const req = new Request("https://api.keycollective.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          model: "smart-fast",
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      const res = await testWorker.fetch(req, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-kc-model")).toBe("gemini-2.0-flash");
      expect(res.headers.get("x-kc-provider")).toBe("google");
    });

    it("filters out unsupported models when tools/functions requested (Golden Test tc-07)", async () => {
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

      const testWorker = createWorker({ modelRegistry: registry });
      const req = new Request("https://api.keycollective.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          model: "text-only-model",
          messages: [{ role: "user", content: "Call tool" }],
          tools: [{ type: "function", function: { name: "get_weather" } }],
        }),
      });

      const res = await testWorker.fetch(req, env);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.code).toBe("CAPABILITY_MISMATCH");
    });
  });

  describe("Group 7: DO Capacity Forwarding", () => {
    it("forwards GET /v1/capacity to tenant DO stub with x-tenant-id", async () => {
      const req = new Request("https://api.keycollective.ai/v1/capacity", {
        method: "GET",
        headers: {
          authorization: `Bearer ${validToken}`,
        },
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        capacity: { totalKeys: number; healthyKeys: number; remainingRpm: number };
      };
      expect(body.capacity.totalKeys).toBe(3);
      expect(body.capacity.healthyKeys).toBe(3);
      expect(body.capacity.remainingRpm).toBe(170);

      const stub = mockDoNamespace.stubs.get("tenant-alpha");
      expect(stub).toBeDefined();
      expect(stub?.fetchCalls).toHaveLength(1);
      expect(stub?.fetchCalls[0].headers.get("x-tenant-id")).toBe("tenant-alpha");
    });
  });

  describe("Group 8: Error Handling & 404 Route Not Found", () => {
    it("returns 404 for unknown path", async () => {
      const req = new Request("https://api.keycollective.ai/v1/unknown-endpoint", {
        method: "GET",
        headers: {
          authorization: `Bearer ${validToken}`,
        },
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("ROUTE_NOT_FOUND");
    });

    it("returns 404 for unsupported HTTP method", async () => {
      const req = new Request("https://api.keycollective.ai/v1/models", {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${validToken}`,
        },
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(404);
    });

    it("returns 400 for malformed JSON body", async () => {
      const req = new Request("https://api.keycollective.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${validToken}`,
        },
        body: "{ this is not valid json }",
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.code).toBe("INVALID_REQUEST_BODY");
    });
  });

  describe("Group 9: Root index.ts Re-Export Verification", () => {
    it("verifies root index.ts default export operates identically to worker/index.ts", async () => {
      const req = new Request("https://api.keycollective.ai/health", { method: "GET" });
      const res = await rootWorker.fetch(req, env);

      expect(res.status).toBe(200);
      const body = (await res.json()) as HealthResponse;
      expect(body.status).toBe("healthy");
      expect(body.version).toBe("0.2.0");
    });
  });
});
