/**
 * Key Collective v2 — AC-08 Upstream Header Stripping & Allowlisting Guard Tests
 *
 * Verifies AC-08 requirement:
 * A mocked upstream response carrying `x-goog-*`, `server`, `alt-svc`, `x-envoy-*` and `cf-ray`
 * produces a client response with none of them.
 *
 * Also verifies that UpstreamClient.toClientResponse has been deleted and responses
 * are cleanly constructed by the router handlers.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  RouterHandler,
  DurableObjectStubLike,
  DurableObjectNamespaceLike,
} from "../../../src/worker/router/index";
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
    this.keys.set("groq", "key-groq-test-1");
    this.keys.set("openai", "key-openai-test-1");
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

const FORBIDDEN_HEADERS = [
  "server",
  "alt-svc",
  "cf-ray",
  "x-goog-api-client",
  "x-goog-safety",
  "x-envoy-upstream-service-time",
];

const LEAKY_UPSTREAM_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "x-goog-api-client": "gl-js/1.2.3",
  "x-goog-safety": "block_none",
  "server": "envoy-proxy/1.28.0",
  "alt-svc": 'h3=":443"; ma=86400',
  "x-envoy-upstream-service-time": "42",
  "cf-ray": "1234567890abcdef-IAD",
  "x-goog-custom-trace": "trace-internal-999",
  "x-envoy-decorator-operation": "egress-router",
};

function assertNoLeakedHeaders(res: Response): void {
  for (const forbidden of FORBIDDEN_HEADERS) {
    expect(res.headers.has(forbidden)).toBe(false);
    expect(res.headers.get(forbidden)).toBeNull();
  }

  for (const [key] of res.headers.entries()) {
    const lower = key.toLowerCase();
    expect(lower.startsWith("x-goog-")).toBe(false);
    expect(lower.startsWith("x-envoy-")).toBe(false);
    expect(lower).not.toBe("server");
    expect(lower).not.toBe("alt-svc");
    expect(lower).not.toBe("cf-ray");
  }
}

describe("AC-08 Upstream Header Stripping & Allowlisting", () => {
  let doNamespace: MockDurableObjectNamespace;
  let defaultAuthContext: AuthenticatedContext;
  let env: WorkerEnv;

  beforeEach(() => {
    doNamespace = new MockDurableObjectNamespace();
    defaultAuthContext = {
      tenantId: "tenant-ac08",
      isAuthenticated: true,
      token: {
        id: "token-uuid-ac08",
        hashSha256: "hash123",
        tenantId: "tenant-ac08",
        budgetMicrodollars: 10_000_000n,
        spentMicrodollars: 500_000n,
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

  it("verifies UpstreamClient does not expose deprecated toClientResponse method", () => {
    expect(
      (UpstreamClient.prototype as Record<string, unknown>).toClientResponse
    ).toBeUndefined();
    const client = new UpstreamClient();
    expect(
      (client as unknown as Record<string, unknown>).toClientResponse
    ).toBeUndefined();
  });

  it("strips x-goog-*, server, alt-svc, x-envoy-*, and cf-ray from non-streaming chat responses", async () => {
    const mockUpstream = new UpstreamClient({
      fetch: async () => {
        return new Response(
          JSON.stringify({
            id: "chatcmpl-ac08-nonstream",
            choices: [
              {
                message: { role: "assistant", content: "safe response content" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          {
            status: 200,
            headers: LEAKY_UPSTREAM_HEADERS,
          }
        );
      },
    });

    const handler = new RouterHandler({ upstreamClient: mockUpstream });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    const res = await handler.handle(
      req,
      env,
      new MockExecutionContext(),
      defaultAuthContext
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("x-kc-trace-id")).toBeNull();
    expect(res.headers.get("x-kc-model-used")).toBe("gemini-2.0-flash");
    expect(res.headers.get("x-kc-model")).toBeNull();

    assertNoLeakedHeaders(res);

    const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    expect(body.choices[0].message.content).toBe("safe response content");
  });

  it("strips x-goog-*, server, alt-svc, x-envoy-*, and cf-ray from streaming chat responses", async () => {
    const mockUpstream = new UpstreamClient({
      fetch: async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"chunk1"}}]}\n\n')
            );
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":4,"total_tokens":12}}\n\n'
              )
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            ...LEAKY_UPSTREAM_HEADERS,
            "content-type": "text/event-stream",
          },
        });
      },
    });

    const handler = new RouterHandler({ upstreamClient: mockUpstream });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "stream please" }],
        stream: true,
      }),
    });

    const res = await handler.handle(
      req,
      env,
      new MockExecutionContext(),
      defaultAuthContext
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-kc-trace-id")).toBeNull();
    expect(res.headers.get("x-kc-model-used")).toBe("gemini-2.0-flash");
    expect(res.headers.get("x-kc-model")).toBeNull();

    assertNoLeakedHeaders(res);

    const text = await res.text();
    expect(text).toContain("chunk1");
    expect(text).toContain("[DONE]");
  });

  it("strips upstream headers when responseFormat is kc_api", async () => {
    const mockUpstream = new UpstreamClient({
      fetch: async () => {
        return new Response(
          JSON.stringify({
            id: "chatcmpl-ac08-kc-api",
            choices: [
              {
                message: { role: "assistant", content: "kc_api format response" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
          }),
          {
            status: 200,
            headers: LEAKY_UPSTREAM_HEADERS,
          }
        );
      },
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
        messages: [{ role: "user", content: "format test" }],
      }),
    });

    const res = await handler.handle(
      req,
      env,
      new MockExecutionContext(),
      defaultAuthContext
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    assertNoLeakedHeaders(res);

    const body = (await res.json()) as { data: { choices: Array<{ message: { content: string } }> }; meta: Record<string, unknown> };
    expect(body.data.choices[0].message.content).toBe("kc_api format response");
    expect(body.meta).toBeDefined();
  });

  it("strips upstream headers on error responses routed through handler", async () => {
    const mockUpstream = new UpstreamClient({
      fetch: async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: "Bad request parameter",
              status: "INVALID_ARGUMENT",
            },
          }),
          {
            status: 400,
            headers: LEAKY_UPSTREAM_HEADERS,
          }
        );
      },
    });

    const handler = new RouterHandler({ upstreamClient: mockUpstream });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "cause error" }],
      }),
    });

    const res = await handler.handle(
      req,
      env,
      new MockExecutionContext(),
      defaultAuthContext
    );

    // Error response generated by router/dispatcher
    expect(res.status).toBeGreaterThanOrEqual(400);
    assertNoLeakedHeaders(res);
  });
});
