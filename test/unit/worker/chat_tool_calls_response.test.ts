/**
 * Key Collective v2 — Chat Tool Calls Response Round-Trip Unit Tests
 * Task T-2.3.2: Return upstream OpenAI JSON response preserving tool_calls and choices
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

describe("T-2.3.2: OpenAI-Compatible Tool-Call Response Round-Trip", () => {
  let doNamespace: MockDurableObjectNamespace;
  let authContext: AuthenticatedContext;
  let env: WorkerEnv;

  beforeEach(() => {
    doNamespace = new MockDurableObjectNamespace();
    authContext = {
      tenantId: "tenant-tool-calls",
      isAuthenticated: true,
      token: {
        id: "tok-tool-1",
        hashSha256: "hash123",
        tenantId: "tenant-tool-calls",
        budgetCeilingCu: 10_000_000n,
        spentTotalCu: 100_000n,
        allowedProviders: [],
        rpmLimit: 60,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
      rpmLimit: 60,
      currentRpm: 1,
      remainingRpm: 59,
      budgetCeilingCu: 10_000_000n,
      spentTotalCu: 100_000n,
      budgetRemainingCu: 9_900_000n,
    };
    env = {
      KEY_POOL: doNamespace as unknown as DurableObjectNamespace,
    };
  });

  it("round-trips tool_calls and finish_reason: 'tool_calls' intact for Groq upstream fixture", async () => {
    const groqToolCalls = [
      {
        id: "call_groq_weather_99",
        type: "function",
        function: {
          name: "get_current_weather",
          arguments: '{"location":"San Francisco, CA","unit":"celsius"}',
        },
      },
    ];

    const groqFixture = {
      id: "chatcmpl-upstream-groq-xyz",
      object: "chat.completion",
      created: 1720001000,
      model: "llama-3.3-70b-versatile",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: groqToolCalls,
          },
          finish_reason: "tool_calls",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 150,
        completion_tokens: 35,
        total_tokens: 185,
      },
    };

    const mockUpstream = new UpstreamClient({
      fetch: async () => {
        return Response.json(groqFixture);
      },
    });

    const handler = new RouterHandler({ upstreamClient: mockUpstream });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "What is the weather in SF?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_current_weather",
              parameters: { type: "object", properties: { location: { type: "string" } } },
            },
          },
        ],
      }),
    });

    const res = await handler.handle(req, env, new MockExecutionContext(), authContext);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      id: string;
      object: string;
      model: string;
      choices: Array<{
        index: number;
        message: {
          role: string;
          content: string | null;
          tool_calls?: unknown[];
        };
        finish_reason: string;
        logprobs?: unknown;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        kc_cu: number;
      };
    };

    // ID prefixed with chatcmpl-
    expect(body.id).toMatch(/^chatcmpl-/);
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("llama-3.3-70b-versatile");

    // Choices preserved with tool_calls, finish_reason, and logprobs
    expect(body.choices).toHaveLength(1);
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.choices[0].message.tool_calls).toEqual(groqToolCalls);
    expect(body.choices[0].logprobs).toBeNull();

    // Usage preserved and usage.kc_cu added
    expect(body.usage.prompt_tokens).toBe(150);
    expect(body.usage.completion_tokens).toBe(35);
    expect(typeof body.usage.kc_cu).toBe("number");
    expect(body.usage.kc_cu).toBeGreaterThan(0);
  });

  it("round-trips tool_calls and finish_reason: 'tool_calls' intact for Gemini upstream fixture", async () => {
    const geminiToolCalls = [
      {
        id: "call_gemini_calc_42",
        type: "function",
        function: {
          name: "calculate_fibonacci",
          arguments: '{"n":10}',
        },
      },
      {
        id: "call_gemini_calc_43",
        type: "function",
        function: {
          name: "calculate_factorial",
          arguments: '{"n":5}',
        },
      },
    ];

    const geminiFixture = {
      id: "chatcmpl-upstream-gemini-abc",
      object: "chat.completion",
      created: 1720002000,
      model: "gemini-2.0-flash",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: geminiToolCalls,
          },
          finish_reason: "tool_calls",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 80,
        completion_tokens: 50,
        total_tokens: 130,
      },
    };

    const mockUpstream = new UpstreamClient({
      fetch: async () => {
        return Response.json(geminiFixture);
      },
    });

    const handler = new RouterHandler({ upstreamClient: mockUpstream });
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "Compute fib(10) and fact(5)" }],
      }),
    });

    const res = await handler.handle(req, env, new MockExecutionContext(), authContext);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      id: string;
      object: string;
      model: string;
      choices: Array<{
        index: number;
        message: {
          role: string;
          content: string | null;
          tool_calls?: unknown[];
        };
        finish_reason: string;
        logprobs?: unknown;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        kc_cu: number;
      };
    };

    expect(body.id).toMatch(/^chatcmpl-/);
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("gemini-2.0-flash");

    // Choices preserved with tool_calls and finish_reason
    expect(body.choices).toHaveLength(1);
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.choices[0].message.tool_calls).toEqual(geminiToolCalls);
    expect(body.choices[0].logprobs).toBeNull();

    // Usage preserved and usage.kc_cu added
    expect(body.usage.prompt_tokens).toBe(80);
    expect(body.usage.completion_tokens).toBe(50);
    expect(typeof body.usage.kc_cu).toBe("number");
    expect(body.usage.kc_cu).toBeGreaterThan(0);
  });
});
