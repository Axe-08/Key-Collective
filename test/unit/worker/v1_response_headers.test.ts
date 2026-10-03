/**
 * Key Collective v2 — V1 Response Headers Tests
 *
 * Verifies that:
 * - Every /v1 response carries x-kc-request-id matching ^kc_req_[0-9a-f-]+$
 * - Responses carry x-kc-model-used and x-kc-provider
 * - Non-streaming responses carry x-kc-cu and x-kc-attempts
 * - Streaming responses omit x-kc-cu
 * - No response carries x-kc-tenant-id or x-kc-trace-id (or x-kc-model)
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  RouterHandler,
  DurableObjectStubLike,
  DurableObjectNamespaceLike,
} from "../../../src/worker/router/index";
import { applyKcHeaders } from "../../../src/worker/router/headers";
import type { AuthenticatedContext, WorkerEnv } from "../../../src/worker/auth/index";
import type { ExecutionContextLike } from "../../../src/worker/telemetry_emitter";
import { UpstreamClient } from "../../../src/proxy/upstream/index";

class MockExecutionContext implements ExecutionContextLike {
  public promises: Promise<unknown>[] = [];
  waitUntil(promise: Promise<unknown>): void {
    this.promises.push(promise);
  }
}

class MockDurableObjectStub implements DurableObjectStubLike {
  public tenantId: string;
  public keys: Map<string, string> = new Map();

  constructor(tenantId: string) {
    this.tenantId = tenantId;
    this.keys.set("google", "key-gemini-test-1");
  }

  async fetch(urlOrRequest: string | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof urlOrRequest === "string" ? urlOrRequest : urlOrRequest.url);
    if (url.pathname === "/keys/get") {
      const body = (init?.body ? JSON.parse(init.body as string) : {}) as { provider?: string };
      const keyId = this.keys.get(body.provider ?? "google");
      if (!keyId) {
        return new Response("Key not found", { status: 404 });
      }
      return Response.json({ keyId });
    }
    return new Response("Not found", { status: 404 });
  }
}

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

describe("applyKcHeaders Unit Tests", () => {
  it("formats request-id as kc_req_<uuid>, applies non-streaming headers and deletes internal headers", () => {
    const inputRes = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-kc-trace-id": "11111111-2222-3333-4444-555555555555",
        "x-kc-tenant-id": "tenant-secret",
        "x-kc-model": "old-model-name",
      },
    });

    const res = applyKcHeaders(inputRes, {
      requestId: "11111111-2222-3333-4444-555555555555",
      modelUsed: "gemini-3.5-flash",
      provider: "google",
      cu: 42,
      isStream: false,
    });

    expect(res.headers.get("x-kc-request-id")).toBe("kc_req_11111111-2222-3333-4444-555555555555");
    expect(res.headers.get("x-kc-model-used")).toBe("gemini-3.5-flash");
    expect(res.headers.get("x-kc-provider")).toBe("google");
    expect(res.headers.get("x-kc-attempts")).toBe("1");
    expect(res.headers.get("x-kc-cu")).toBe("42");
    expect(res.headers.get("x-kc-cost-microdollars")).toBeNull();

    // Strictly verify stripped internal headers
    expect(res.headers.get("x-kc-tenant-id")).toBeNull();
    expect(res.headers.get("x-kc-trace-id")).toBeNull();
    expect(res.headers.get("x-kc-model")).toBeNull();
  });

  it("omits x-kc-cu on streaming responses and enforces kc_req_ prefix", () => {
    const inputRes = new Response("data: hello\n\n", {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "x-kc-trace-id": "internal-trace",
        "x-kc-tenant-id": "internal-tenant",
        "x-kc-cu": "99",
      },
    });

    const res = applyKcHeaders(inputRes, {
      modelUsed: "gemini-3.5-flash",
      provider: "google",
      isStream: true,
    });

    expect(res.headers.get("x-kc-request-id")).toMatch(/^kc_req_[0-9a-f-]+$/);
    expect(res.headers.get("x-kc-model-used")).toBe("gemini-3.5-flash");
    expect(res.headers.get("x-kc-provider")).toBe("google");
    expect(res.headers.get("x-kc-attempts")).toBe("1");
    expect(res.headers.get("x-kc-cu")).toBeNull();

    expect(res.headers.get("x-kc-tenant-id")).toBeNull();
    expect(res.headers.get("x-kc-trace-id")).toBeNull();
    expect(res.headers.get("x-kc-model")).toBeNull();
  });
});

describe("V1 Response Headers Enforcement via RouterHandler", () => {
  let doNamespace: MockDurableObjectNamespace;
  let defaultAuthContext: AuthenticatedContext;
  let env: WorkerEnv;

  beforeEach(() => {
    doNamespace = new MockDurableObjectNamespace();
    defaultAuthContext = {
      tenantId: "tenant-hdr-test",
      isAuthenticated: true,
      token: {
        id: "token-uuid-1",
        hashSha256: "hash123",
        tenantId: "tenant-hdr-test",
        budgetCeilingCu: 10_000_000n,
        spentTotalCu: 0n,
        allowedProviders: [],
        rpmLimit: 60,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
      rpmLimit: 60,
      currentRpm: 1,
      remainingRpm: 59,
      budgetCeilingCu: 10_000_000n,
      spentTotalCu: 0n,
      budgetRemainingCu: 10_000_000n,
    };
    env = {
      KEY_POOL: doNamespace as unknown as DurableObjectNamespace,
    };
  });

  it("asserts non-streaming /v1 chat response carries x-kc-request-id, model-used, provider, cu, attempts and no trace-id/tenant-id", async () => {
    const mockUpstream = new UpstreamClient({
      fetch: async () => {
        return new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            choices: [
              {
                message: { role: "assistant", content: "Hello from test!" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      },
    });

    const handler = new RouterHandler({ upstreamClient: mockUpstream });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kc-trace-id": "trace-client-sent-this",
      },
      body: JSON.stringify({
        model: "gemini-3.5-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    const res = await handler.handle(req, env, new MockExecutionContext(), defaultAuthContext);

    expect(res.status).toBe(200);
    expect(res.headers.get("x-kc-request-id")).toMatch(/^kc_req_[0-9a-f-]+$/);
    expect(res.headers.get("x-kc-model-used")).toBe("gemini-3.5-flash");
    expect(res.headers.get("x-kc-provider")).toBe("google");
    expect(res.headers.get("x-kc-attempts")).toBe("1");
    expect(res.headers.get("x-kc-cu")).toBeTruthy();
    expect(res.headers.get("x-kc-cost-microdollars")).toBeNull();

    // Verify information boundary: no tenant-id or trace-id leaked
    expect(res.headers.get("x-kc-tenant-id")).toBeNull();
    expect(res.headers.get("x-kc-trace-id")).toBeNull();
    expect(res.headers.get("x-kc-model")).toBeNull();
  });

  it("asserts streaming /v1 chat response carries x-kc-request-id, model-used, provider, attempts, omits cu, and strips internal headers", async () => {
    const mockUpstream = new UpstreamClient({
      fetch: async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"chunk"}}]}\n\n')
            );
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n'
              )
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    const handler = new RouterHandler({ upstreamClient: mockUpstream });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kc-trace-id": "trace-stream-client",
      },
      body: JSON.stringify({
        model: "gemini-3.5-flash",
        messages: [{ role: "user", content: "stream please" }],
        stream: true,
      }),
    });

    const res = await handler.handle(req, env, new MockExecutionContext(), defaultAuthContext);

    expect(res.status).toBe(200);
    expect(res.headers.get("x-kc-request-id")).toMatch(/^kc_req_[0-9a-f-]+$/);
    expect(res.headers.get("x-kc-model-used")).toBe("gemini-3.5-flash");
    expect(res.headers.get("x-kc-provider")).toBe("google");
    expect(res.headers.get("x-kc-attempts")).toBe("1");
    expect(res.headers.get("x-kc-cu")).toBeNull();

    // Verify information boundary: no tenant-id or trace-id leaked
    expect(res.headers.get("x-kc-tenant-id")).toBeNull();
    expect(res.headers.get("x-kc-trace-id")).toBeNull();
    expect(res.headers.get("x-kc-model")).toBeNull();
  });

  it("asserts /v1/models response carries x-kc-request-id and no internal trace-id or tenant-id", async () => {
    const handler = new RouterHandler();
    const req = new Request("http://localhost/v1/models", {
      method: "GET",
      headers: {
        "x-kc-trace-id": "trace-models-client",
      },
    });

    const res = await handler.handle(req, env, new MockExecutionContext());

    expect(res.status).toBe(200);
    expect(res.headers.get("x-kc-request-id")).toMatch(/^kc_req_[0-9a-f-]+$/);
    expect(res.headers.get("x-kc-tenant-id")).toBeNull();
    expect(res.headers.get("x-kc-trace-id")).toBeNull();
    expect(res.headers.get("x-kc-model")).toBeNull();
  });

  it("asserts 404 route not found response carries x-kc-request-id and no trace-id or tenant-id", async () => {
    const handler = new RouterHandler();
    const req = new Request("http://localhost/v1/nonexistent", {
      method: "GET",
    });

    const res = await handler.handle(req, env, new MockExecutionContext(), defaultAuthContext);

    expect(res.status).toBe(404);
    expect(res.headers.get("x-kc-request-id")).toMatch(/^kc_req_[0-9a-f-]+$/);
    expect(res.headers.get("x-kc-tenant-id")).toBeNull();
    expect(res.headers.get("x-kc-trace-id")).toBeNull();
  });
});
