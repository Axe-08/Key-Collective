/**
 * Key Collective v2 — Chat Request Passthrough Unit Tests
 *
 * Verifies that ChatHandler forwards unknown client body fields (such as
 * safetySettings, generationConfig, extra_body, seed, top_p, logprobs, and arbitrary fields)
 * to upstream, injects stream_options: { include_usage: true } on streaming requests when not
 * explicitly provided, preserves client stream_options when specified, omits KC-only fields
 * (modelAlias, estimatedPromptTokens), and resolves model to candidate.id.
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
import { ALL_MODEL_DEFINITIONS, ModelRegistry } from "../../../src/router/registry/index";

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

describe("Chat Request Passthrough & stream_options Unit Tests", () => {
  let doNamespace: MockDurableObjectNamespace;
  let defaultAuthContext: AuthenticatedContext;
  let env: WorkerEnv;

  beforeEach(() => {
    doNamespace = new MockDurableObjectNamespace();
    defaultAuthContext = {
      tenantId: "tenant-alpha",
      isAuthenticated: true,
      token: {
        id: "token-uuid-1",
        hashSha256: "hash123",
        tenantId: "tenant-alpha",
        budgetCeilingCu: 10_000_000n,
        spentTotalCu: 500_000n,
        allowedProviders: [],
        rpmLimit: 60,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
      rpmLimit: 60,
      currentRpm: 1,
      remainingRpm: 59,
      budgetCeilingCu: 10_000_000n,
      spentTotalCu: 500_000n,
      budgetRemainingCu: 9_500_000n,
    };
    env = {
      KEY_POOL: doNamespace as unknown as DurableObjectNamespace,
    };
  });

  it("passes arbitrary field {'foo': 1} and safetySettings to mocked upstream body", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const mockUpstream = new UpstreamClient({
      fetch: async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return Response.json({
          id: "chatcmpl-mock-1",
          choices: [
            {
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      },
    });

    const handler = new RouterHandler({ upstreamClient: mockUpstream });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "hello" }],
        foo: 1,
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        ],
        generationConfig: { topK: 40 },
        modelAlias: "my-alias",
        estimatedPromptTokens: 999,
      }),
    });

    const res = await handler.handle(req, env, new MockExecutionContext(), defaultAuthContext);
    expect(res.status).toBe(200);

    expect(capturedBody).not.toBeNull();
    // Arbitrary fields reach upstream body
    expect(capturedBody?.foo).toBe(1);
    expect(capturedBody?.safetySettings).toEqual([
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    ]);
    expect(capturedBody?.generationConfig).toEqual({ topK: 40 });

    // Model resolved to candidate.id
    expect(capturedBody?.model).toBe("gemini-2.0-flash");

    // KC-only fields stripped
    expect(capturedBody?.modelAlias).toBeUndefined();
    expect(capturedBody?.estimatedPromptTokens).toBeUndefined();
  });

  it("streaming request automatically carries stream_options with include_usage", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const mockUpstream = new UpstreamClient({
      fetch: async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')
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
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        });
      },
    });

    const handler = new RouterHandler({ upstreamClient: mockUpstream });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "stream me" }],
        stream: true,
      }),
    });

    const res = await handler.handle(req, env, new MockExecutionContext(), defaultAuthContext);
    expect(res.status).toBe(200);

    expect(capturedBody).not.toBeNull();
    expect(capturedBody?.stream).toBe(true);
    expect(capturedBody?.stream_options).toEqual({ include_usage: true });
  });

  it("preserves explicit client stream_options when specified", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const mockUpstream = new UpstreamClient({
      fetch: async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        });
      },
    });

    const handler = new RouterHandler({ upstreamClient: mockUpstream });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "stream custom" }],
        stream: true,
        stream_options: { include_usage: false, custom_flag: true },
      }),
    });

    const res = await handler.handle(req, env, new MockExecutionContext(), defaultAuthContext);
    expect(res.status).toBe(200);

    expect(capturedBody).not.toBeNull();
    expect(capturedBody?.stream_options).toEqual({ include_usage: false, custom_flag: true });
  });

  it("resolves model alias to candidate.id instead of client alias", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const mockUpstream = new UpstreamClient({
      fetch: async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return Response.json({
          id: "chatcmpl-mock-2",
          choices: [
            {
              message: { role: "assistant", content: "smart-fast response" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      },
    });

    const handler = new RouterHandler({ upstreamClient: mockUpstream });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "smart-fast",
        messages: [{ role: "user", content: "hello alias" }],
      }),
    });

    const res = await handler.handle(req, env, new MockExecutionContext(), defaultAuthContext);
    expect(res.status).toBe(200);

    expect(capturedBody).not.toBeNull();
    // 'smart-fast' resolves to the registry's canonical model id
    expect(capturedBody?.model).toBe(new ModelRegistry(ALL_MODEL_DEFINITIONS).resolveAlias("smart-fast"));
    expect(capturedBody?.modelAlias).toBeUndefined();
  });
});
