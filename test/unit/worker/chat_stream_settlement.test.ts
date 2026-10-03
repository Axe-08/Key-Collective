/**
 * Key Collective v2 — Chat Streaming Settlement Unit Tests
 * Task T-2.4.2: Execute single-shot quota and cost settlement on stream flush or abort
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleStreamingResponse } from "../../../src/worker/router/chat/stream";
import type { ChatHandlerDependencies } from "../../../src/worker/router/chat/types";
import type { CascadeRouteResponse } from "../../../src/router/cascade/types";
import type { AuthenticatedContext, WorkerEnv } from "../../../src/worker/auth/types";
import type { KeyPoolContract } from "../../../src/contracts/key_pool";
import { ModelRegistry } from "../../../src/router/registry/registry";
import { DEFAULT_MODEL_DEFINITIONS } from "../../../src/router/registry/catalog";
import type { ExecutionContextLike } from "../../../src/worker/telemetry_emitter";
import { SSEStreamTransformer } from "../../../src/proxy/sse/transformer";
import type { UpstreamResponse } from "../../../src/proxy/upstream/types";
import type { CostLedgerRepository, CostLedgerEvent } from "../../../src/storage/repositories/cost_ledger/index";

describe("T-2.4.2: Stream Settlement on Flush or Abort", () => {
  const modelRegistry = new ModelRegistry(DEFAULT_MODEL_DEFINITIONS);

  let mockCostLedgerRepo: CostLedgerRepository;
  let mockKeyPool: KeyPoolContract;
  let mockDeps: ChatHandlerDependencies;
  let mockAuthContext: AuthenticatedContext;
  let mockEnv: WorkerEnv;
  let mockCtx: ExecutionContextLike;

  beforeEach(() => {
    mockCostLedgerRepo = {
      recordEvent: vi.fn().mockResolvedValue({
        id: "event-settlement-1",
        requestId: "trace-stream-settle",
        tenantId: "tenant-settlement-123",
        keyId: "key_gemini_settle_1",
        provider: "google",
        modelId: "gemini-3.5-flash",
        promptTokens: 10,
        completionTokens: 20,
        cachedTokens: 0,
        reasoningTokens: 0,
        costCu: 5000n,
        latencyMs: 100,
        statusCode: 200,
        createdAt: new Date().toISOString(),
      } as unknown as CostLedgerEvent),
    } as unknown as CostLedgerRepository;

    mockKeyPool = {
      recordUsage: vi.fn().mockResolvedValue(undefined),
      recordResult: vi.fn().mockResolvedValue(undefined),
      getKey: vi.fn().mockResolvedValue("key_gemini_settle_1"),
    } as unknown as KeyPoolContract;

    mockDeps = {
      options: { responseFormat: "openai" },
      modelRegistry,
      timeProvider: () => 1700000000000,
      getKeyPool: vi.fn().mockReturnValue(mockKeyPool),
      getRouter: vi.fn(),
      getCostLedgerRepo: () => mockCostLedgerRepo,
      getAuthTokensRepo: () => undefined,
      getTelemetryEmitter: () => ({ emit: vi.fn() }),
    };

    mockAuthContext = {
      tenantId: "tenant-settlement-123",
      authMethod: "token",
      token: {
        id: "tok_test_settle",
        tenantId: "tenant-settlement-123",
        name: "Test Token",
        prefix: "kc_live_test",
        hash: "hash_123",
        createdAt: 1700000000000,
        revoked: false,
      },
    };

    mockEnv = {} as WorkerEnv;

    mockCtx = {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        void promise;
      }),
      passThroughOnException: vi.fn(),
    };
  });

  it("settles exactly once with exact usage when stream completes with usage chunk", async () => {
    const encoder = new TextEncoder();
    const transformer = new SSEStreamTransformer({ promptTokens: 15 });

    const rawStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"Hello settlement!"}}]}\n\n')
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[],"usage":{"prompt_tokens":15,"completion_tokens":25,"total_tokens":40}}\n\n'
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const transformedStream = rawStream.pipeThrough(transformer);

    const upstreamResponse: UpstreamResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/event-stream" }),
      rawResponse: new Response(),
      body: transformedStream,
      transformer,
      text: async () => "",
      json: async () => ({}),
      getUsage: (timeoutMs) => transformer.getUsage(timeoutMs),
      getMetadata: (timeoutMs) => transformer.getMetadata(timeoutMs),
    };

    const modelDef = modelRegistry.getModelOrThrow("gemini-3.5-flash");
    const cascadeRes: CascadeRouteResponse = {
      content: "",
      costCu: 0n,
      model: "gemini-3.5-flash",
      provider: "google",
      modelDef,
      attempts: [],
      usage: null,
      response: upstreamResponse,
      lease: {
        leaseId: "lease_priv_stream_1",
        keyId: "key_gemini_settle_1",
        provider: "google",
        source: "private",
        ownerTenantId: "tenant-settlement-123",
      },
    };

    const res = handleStreamingResponse(
      mockDeps,
      cascadeRes,
      mockAuthContext,
      mockKeyPool,
      mockEnv,
      mockCtx,
      "trace-settle-exact"
    );

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    while (true) {
      const { done } = await reader!.read();
      if (done) break;
    }

    // Verify settlement ran exactly once with lease.keyId
    expect(mockCostLedgerRepo.recordEvent).toHaveBeenCalledTimes(1);
    expect(mockCostLedgerRepo.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "trace-settle-exact",
        tenantId: "tenant-settlement-123",
        keyId: "key_gemini_settle_1",
        modelId: "gemini-3.5-flash",
        promptTokens: 15,
        completionTokens: 25,
        usage_estimated: 0,
        statusCode: 200,
      })
    );

    // Separate recordUsage call is deleted in WP-4.2 (settlement is the single accounting point)
    expect(mockKeyPool.recordUsage).not.toHaveBeenCalled();
  });

  it("settles exactly once with estimated tokens and usage_estimated = 1 when stream has no usage chunk", async () => {
    const encoder = new TextEncoder();
    const transformer = new SSEStreamTransformer({ promptTokens: 20 });

    const rawStream = new ReadableStream<Uint8Array>({
      start(controller) {
        // 24 characters total across delta chunks
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"First chunk 12ch."}}]}\n\n') // 17 chars
        );
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"Second ch 12."}}]}\n\n') // 13 chars
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const transformedStream = rawStream.pipeThrough(transformer);

    const upstreamResponse: UpstreamResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/event-stream" }),
      rawResponse: new Response(),
      body: transformedStream,
      transformer,
      text: async () => "",
      json: async () => ({}),
      getUsage: (timeoutMs) => transformer.getUsage(timeoutMs),
      getMetadata: (timeoutMs) => transformer.getMetadata(timeoutMs),
    };

    const modelDef = modelRegistry.getModelOrThrow("gemini-3.5-flash");
    const cascadeRes: CascadeRouteResponse = {
      content: "",
      costCu: 0n,
      model: "gemini-3.5-flash",
      provider: "google",
      modelDef,
      attempts: [],
      usage: null,
      response: upstreamResponse,
      lease: {
        leaseId: "lease_priv_stream_2",
        keyId: "key_gemini_settle_1",
        provider: "google",
        source: "private",
        ownerTenantId: "tenant-settlement-123",
      },
    };

    const res = handleStreamingResponse(
      mockDeps,
      cascadeRes,
      mockAuthContext,
      mockKeyPool,
      mockEnv,
      mockCtx,
      "trace-settle-estimated"
    );

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    while (true) {
      const { done } = await reader!.read();
      if (done) break;
    }

    // Total characters = 17 + 13 = 30. ceil(30 / 4) = 8 completion tokens.
    expect(mockCostLedgerRepo.recordEvent).toHaveBeenCalledTimes(1);
    expect(mockCostLedgerRepo.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "trace-settle-estimated",
        tenantId: "tenant-settlement-123",
        keyId: "key_gemini_settle_1",
        modelId: "gemini-3.5-flash",
        promptTokens: 20,
        completionTokens: 8,
        usage_estimated: 1,
        statusCode: 200,
      })
    );

    expect(mockKeyPool.recordUsage).not.toHaveBeenCalled();
  });

  it("settles exactly once with partial usage and usage_estimated = 1 on client abort mid-stream without duplicating on cancel/flush", async () => {
    const encoder = new TextEncoder();
    const transformer = new SSEStreamTransformer({ promptTokens: 12 });

    let controllerRef: ReadableStreamDefaultController<Uint8Array>;
    const rawStream = new ReadableStream<Uint8Array>({
      start(c) {
        controllerRef = c;
        // Enqueue first chunk with 16 characters content
        c.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"1234567890123456"}}]}\n\n')
        );
      },
    });

    const transformedStream = rawStream.pipeThrough(transformer);

    const upstreamResponse: UpstreamResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/event-stream" }),
      rawResponse: new Response(),
      body: transformedStream,
      transformer,
      text: async () => "",
      json: async () => ({}),
      getUsage: (timeoutMs) => transformer.getUsage(timeoutMs),
      getMetadata: (timeoutMs) => transformer.getMetadata(timeoutMs),
    };

    const modelDef = modelRegistry.getModelOrThrow("gemini-3.5-flash");
    const cascadeRes: CascadeRouteResponse = {
      content: "",
      costCu: 0n,
      model: "gemini-3.5-flash",
      provider: "google",
      modelDef,
      attempts: [],
      usage: null,
      response: upstreamResponse,
      lease: {
        leaseId: "lease_priv_stream_3",
        keyId: "key_gemini_settle_1",
        provider: "google",
        source: "private",
        ownerTenantId: "tenant-settlement-123",
      },
    };

    const res = handleStreamingResponse(
      mockDeps,
      cascadeRes,
      mockAuthContext,
      mockKeyPool,
      mockEnv,
      mockCtx,
      "trace-settle-abort"
    );

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    // Read the first chunk
    const firstChunk = await reader!.read();
    expect(firstChunk.done).toBe(false);

    // Downstream client aborts mid-stream
    await reader!.cancel("Client aborted connection mid-stream");

    // Attempt duplicate cancel calls
    await reader!.cancel("Duplicate abort attempt 1");
    await reader!.cancel("Duplicate abort attempt 2");

    // Close controller if still open to avoid unhandled open handles
    try {
      controllerRef!.close();
    } catch {
      // Ignored
    }

    // Verify settlement ran exactly once for the partial stream (16 chars -> ceil(16/4) = 4 tokens)
    expect(mockCostLedgerRepo.recordEvent).toHaveBeenCalledTimes(1);
    expect(mockCostLedgerRepo.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "trace-settle-abort",
        tenantId: "tenant-settlement-123",
        keyId: "key_gemini_settle_1",
        promptTokens: 12,
        completionTokens: 4,
        usage_estimated: 1,
      })
    );

    expect(mockKeyPool.recordUsage).not.toHaveBeenCalled();
  });
});
