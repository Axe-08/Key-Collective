/**
 * Key Collective v2 — Chat Streaming Response Unit Tests
 * Task T-2.3.3: Emit kc.usage event before DONE and sanitize mid-stream SSE errors
 */

import { describe, expect, it, vi } from "vitest";
import { handleStreamingResponse } from "../../../src/worker/router/chat/stream";
import type { ChatHandlerDependencies } from "../../../src/worker/router/chat/types";
import type { CascadeRouteResponse } from "../../../src/router/cascade/types";
import type { AuthenticatedContext, WorkerEnv } from "../../../src/worker/auth/types";
import type { KeyPoolContract } from "../../../src/contracts/key_pool";
import { ModelRegistry } from "../../../src/router/registry/registry";
import { DEFAULT_MODEL_DEFINITIONS } from "../../../src/router/registry/catalog";
import type { ExecutionContextLike } from "../../../src/worker/telemetry_emitter";

describe("T-2.3.3: Chat Streaming kc.usage and Mid-Stream Error Sanitization", () => {
  const modelRegistry = new ModelRegistry(DEFAULT_MODEL_DEFINITIONS);

  const mockDeps: ChatHandlerDependencies = {
    options: { responseFormat: "openai" },
    modelRegistry,
    timeProvider: () => 1700000000000,
    getKeyPool: vi.fn(),
    getRouter: vi.fn(),
    getCostLedgerRepo: () => undefined,
    getAuthTokensRepo: () => undefined,
    getTelemetryEmitter: () => ({ emit: vi.fn() } as any),
  };

  const mockAuthContext: AuthenticatedContext = {
    tenantId: "tenant-test-123",
    authMethod: "token",
    token: {
      id: "tok_123",
      tenantId: "tenant-test-123",
      name: "Test Token",
      prefix: "kc_live_test",
      hash: "abc",
      createdAt: 1700000000000,
      revoked: false,
    },
  };

  const mockKeyPool: KeyPoolContract = {
    recordUsage: vi.fn().mockResolvedValue(undefined),
    recordResult: vi.fn().mockResolvedValue(undefined),
    getKey: vi.fn(),
    addKey: vi.fn(),
    removeKey: vi.fn(),
    listKeys: vi.fn(),
    getMetrics: vi.fn(),
  } as unknown as KeyPoolContract;

  const mockEnv: WorkerEnv = {} as WorkerEnv;

  const mockCtx: ExecutionContextLike = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  };

  it("emits kc.usage event before final [DONE] with correct calculated CU", async () => {
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

    const modelDef = modelRegistry.getModelOrThrow("gemini-3.1-pro-preview");
    const cascadeRes: CascadeRouteResponse = {
      content: "",
      costCu: 0n,
      model: "gemini-3.1-pro-preview",
      provider: "google",
      modelDef,
      attempts: [],
      usage: null,
      response: {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: mockStream,
      } as any,
    };

    const res = handleStreamingResponse(
      mockDeps,
      cascadeRes,
      mockAuthContext,
      mockKeyPool,
      mockEnv,
      mockCtx,
      "trace-stream-1"
    );

    expect(res.status).toBe(200);
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    let output = "";
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      output += typeof value === "string" ? value : decoder.decode(value);
    }

    // Assert chunks forwarded
    expect(output).toContain("Hello");
    expect(output).toContain(" world!");

    // Calculate expected CU for gemini-3.1-pro-preview: cuBase 50, cuInPer1k 5, cuOutPer1k 20
    // prompt: 1000 -> ceil(1000*5/1000) = 5
    // output: 500 -> ceil(500*20/1000) = 10
    // total: 50 + 5 + 10 = 65
    expect(output).toContain("event: kc.usage\n");
    expect(output).toContain('"cu":65');

    // Assert order: kc.usage event MUST be emitted before [DONE]
    const kcUsageIndex = output.indexOf("event: kc.usage");
    const doneIndex = output.lastIndexOf("data: [DONE]");
    expect(kcUsageIndex).toBeGreaterThan(-1);
    expect(doneIndex).toBeGreaterThan(-1);
    expect(kcUsageIndex).toBeLessThan(doneIndex);

    // Final events are kc.usage then [DONE]
    const trimmed = output.trim();
    expect(trimmed.endsWith("data: [DONE]")).toBe(true);
  });

  it("emits kc.usage and [DONE] even if upstream stream closes without explicit [DONE]", async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":200,"completion_tokens":100,"total_tokens":300}}\n\n',
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

    const modelDef = modelRegistry.getModelOrThrow("gemini-3.5-flash");
    const cascadeRes: CascadeRouteResponse = {
      content: "",
      costCu: 0n,
      model: "gemini-3.5-flash",
      provider: "google",
      modelDef,
      attempts: [],
      usage: null,
      response: {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: mockStream,
      } as any,
    };

    const res = handleStreamingResponse(
      mockDeps,
      cascadeRes,
      mockAuthContext,
      mockKeyPool,
      mockEnv,
      mockCtx,
      "trace-stream-2"
    );

    const reader = res.body?.getReader();
    let output = "";
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      output += typeof value === "string" ? value : decoder.decode(value);
    }

    expect(output).toContain("event: kc.usage\n");
    expect(output).toContain("data: [DONE]\n\n");
    expect(output.indexOf("event: kc.usage")).toBeLessThan(output.indexOf("data: [DONE]"));
  });

  it("catches mid-stream upstream exceptions and emits sanitized SSE error event", async () => {
    const encoder = new TextEncoder();
    let pulled = false;
    const mockStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!pulled) {
          pulled = true;
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"Partial stream"}}]}\n\n')
          );
        } else {
          controller.error(
            new Error(
              "Upstream failure with key sk-123456789012345678901234567890 at 192.168.1.100 and billingAccounts/BILLING-99"
            )
          );
        }
      },
    });

    const modelDef = modelRegistry.getModelOrThrow("gemini-3.5-flash");
    const cascadeRes: CascadeRouteResponse = {
      content: "",
      costCu: 0n,
      model: "gemini-3.5-flash",
      provider: "google",
      modelDef,
      attempts: [],
      usage: null,
      response: {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: mockStream,
      } as any,
    };

    const res = handleStreamingResponse(
      mockDeps,
      cascadeRes,
      mockAuthContext,
      mockKeyPool,
      mockEnv,
      mockCtx,
      "trace-stream-err"
    );

    const reader = res.body?.getReader();
    let output = "";
    const decoder = new TextDecoder();

    // Reading should not crash
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      output += typeof value === "string" ? value : decoder.decode(value);
    }

    expect(output).toContain("Partial stream");
    expect(output).toContain("event: error\n");

    // Verify sanitization
    expect(output).toContain("[REDACTED_SECRET]");
    expect(output).toContain("[REDACTED_IP]");
    expect(output).toContain("[BILLING_REDACTED]");
    expect(output).not.toContain("sk-123456789012345678901234567890");
    expect(output).not.toContain("192.168.1.100");
    expect(output).not.toContain("billingAccounts/BILLING-99");
  });

  it("sanitizes upstream mid-stream SSE error events containing sensitive information", async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Chunk 1"}}]}\n\n',
      'event: error\ndata: {"error":{"message":"Project projects/99887766 failed with Bearer secret-token-abcdef123"}}\n\n',
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

    const modelDef = modelRegistry.getModelOrThrow("gemini-3.5-flash");
    const cascadeRes: CascadeRouteResponse = {
      content: "",
      costCu: 0n,
      model: "gemini-3.5-flash",
      provider: "google",
      modelDef,
      attempts: [],
      usage: null,
      response: {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: mockStream,
      } as any,
    };

    const res = handleStreamingResponse(
      mockDeps,
      cascadeRes,
      mockAuthContext,
      mockKeyPool,
      mockEnv,
      mockCtx,
      "trace-stream-sse-err"
    );

    const reader = res.body?.getReader();
    let output = "";
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      output += typeof value === "string" ? value : decoder.decode(value);
    }

    expect(output).toContain("Chunk 1");
    expect(output).toContain("event: error\n");
    expect(output).toContain("[PROJECT_REDACTED]");
    expect(output).toContain("[REDACTED_SECRET]");
    expect(output).not.toContain("projects/99887766");
    expect(output).not.toContain("Bearer secret-token-abcdef123");
  });
});
