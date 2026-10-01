/**
 * Unit Tests: Non-streaming chat completions Credit Units (CU) and cost headers.
 * Task: T-2.2.1 (WP-2.2: Credit Units: API, telemetry and UI)
 *
 * Invariants Tested:
 * 1. Emits x-kc-cu response header equal to recomputed CU from usage.
 * 2. Emits payload.usage.kc_cu equal to the calculated CU number for standard OpenAI and kc_api formats.
 * 3. Preserves x-kc-cost-microdollars header alongside x-kc-cu for backward compatibility.
 */

import { describe, expect, it, vi } from "vitest";
import type { KeyPoolContract } from "../../../src/contracts/key_pool";
import type { CascadeRouteResponse } from "../../../src/router/cascade/index";
import { calculateCu, ModelRegistry } from "../../../src/router/registry/index";
import type { ModelDef } from "../../../src/types/models";
import type { AuthenticatedContext, WorkerEnv } from "../../../src/worker/auth/index";
import type { ChatHandlerDependencies } from "../../../src/worker/router/chat/types";
import type { TelemetryEmitter } from "../../../src/worker/telemetry_emitter";
import * as nonStreamingModule from "../../../src/worker/router/chat/non_streaming";

const handleNonStreamingChat =
  (nonStreamingModule as { handleNonStreamingChat?: typeof nonStreamingModule.handleNonStreamingResponse })
    .handleNonStreamingChat ?? nonStreamingModule.handleNonStreamingResponse;

function createTestModelDef(overrides?: Partial<ModelDef<bigint>>): ModelDef<bigint> {
  return {
    id: "gemini-2.5-flash",
    provider: "google",
    logicalAliases: ["fast"],
    contextWindow: 1_048_576,
    maxOutputTokens: 65536,
    inputCostPerMTokMicro: 75_000n,
    outputCostPerMTokMicro: 300_000n,
    cacheReadCostPerMTokMicro: 18_750n,
    cuBase: 10n,
    cuInPer1k: 1n,
    cuCachedPer1k: 0n,
    cuOutPer1k: 4n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    isActive: true,
    ...overrides,
  };
}

function createTestDependencies(responseFormat: "openai" | "kc_api" = "openai"): ChatHandlerDependencies {
  const registry = new ModelRegistry();
  return {
    options: { responseFormat },
    modelRegistry: registry,
    timeProvider: () => 1_700_000_000_000,
    getKeyPool: vi.fn(),
    getRouter: vi.fn(),
    getCostLedgerRepo: () => undefined,
    getAuthTokensRepo: () => undefined,
    getTelemetryEmitter: () =>
      ({
        emit: vi.fn(),
      } as unknown as TelemetryEmitter),
  };
}

describe("Chat Non-Streaming Credit Units (CU) - T-2.2.1", () => {
  const authContext: AuthenticatedContext = {
    tenantId: "tenant-cu-test",
    isAuthenticated: true,
  };

  const mockKeyPool = {
    recordUsage: vi.fn().mockResolvedValue(undefined),
  } as unknown as KeyPoolContract;

  const mockEnv = {} as WorkerEnv;

  it("returns x-kc-cu header, usage.kc_cu, and preserves x-kc-cost-microdollars on standard OpenAI completion", async () => {
    const modelDef = createTestModelDef({
      cuBase: 10n,
      cuInPer1k: 1n,
      cuCachedPer1k: 0n,
      cuOutPer1k: 4n,
    });

    const usage = {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    };

    const expectedCu = calculateCu(modelDef, usage);
    expect(expectedCu).toBe(13n); // 10 base + ceil(1000*1/1000) + ceil(500*4/1000) = 10 + 1 + 2 = 13

    const cascadeRes: CascadeRouteResponse = {
      content: "Hello from non-streaming test!",
      costMicrodollars: 5000n,
      model: modelDef.id,
      provider: modelDef.provider,
      modelDef,
      attempts: [],
      usage,
    };

    const deps = createTestDependencies("openai");
    const response = await handleNonStreamingChat(
      deps,
      cascadeRes,
      authContext,
      mockKeyPool,
      mockEnv
    );

    expect(response.status).toBe(200);

    // Verify headers
    expect(response.headers.get("x-kc-cu")).toBe(expectedCu.toString());
    expect(response.headers.get("x-kc-cu")).toBe("13");
    expect(response.headers.get("x-kc-cost-microdollars")).toBe("5000");
    expect(response.headers.get("x-kc-model-used")).toBe(modelDef.id);
    expect(response.headers.get("x-kc-model")).toBeNull();
    expect(response.headers.get("x-kc-provider")).toBe(modelDef.provider);

    // Verify response body
    const body = (await response.json()) as {
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        kc_cu: number;
      };
      cost_microdollars: string;
    };

    expect(body.usage).toBeDefined();
    expect(body.usage.kc_cu).toBe(Number(expectedCu));
    expect(body.usage.kc_cu).toBe(13);
    expect(body.usage.prompt_tokens).toBe(1000);
    expect(body.usage.completion_tokens).toBe(500);
    expect(body.usage.total_tokens).toBe(1500);
    expect(body.cost_microdollars).toBe("5000");
  });

  it("returns x-kc-cu header and payload.usage.kc_cu for kc_api response format", async () => {
    const modelDef = createTestModelDef({
      cuBase: 10n,
      cuInPer1k: 1n,
      cuCachedPer1k: 0n,
      cuOutPer1k: 4n,
    });

    const usage = {
      promptTokens: 2000,
      completionTokens: 1000,
      totalTokens: 3000,
    };

    const expectedCu = calculateCu(modelDef, usage);
    expect(expectedCu).toBe(16n); // 10 base + ceil(2000*1/1000) + ceil(1000*4/1000) = 10 + 2 + 4 = 16

    const cascadeRes: CascadeRouteResponse = {
      content: "KC API formatted test",
      costMicrodollars: 9000n,
      model: modelDef.id,
      provider: modelDef.provider,
      modelDef,
      attempts: [],
      usage,
    };

    const deps = createTestDependencies("kc_api");
    const response = await handleNonStreamingChat(
      deps,
      cascadeRes,
      authContext,
      mockKeyPool,
      mockEnv
    );

    expect(response.status).toBe(200);

    // Verify headers
    expect(response.headers.get("x-kc-cu")).toBe(expectedCu.toString());
    expect(response.headers.get("x-kc-cu")).toBe("16");
    expect(response.headers.get("x-kc-cost-microdollars")).toBe("9000");

    // Verify kc_api response payload
    const body = (await response.json()) as {
      data: {
        usage: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
          kc_cu: number;
        };
      };
      meta: {
        costMicrodollars: string;
      };
    };

    expect(body.data.usage.kc_cu).toBe(Number(expectedCu));
    expect(body.data.usage.kc_cu).toBe(16);
    expect(body.data.usage.prompt_tokens).toBe(2000);
    expect(body.data.usage.completion_tokens).toBe(1000);
  });

  it("calculates CU correctly with reasoning tokens and cached tokens", async () => {
    const modelDef = createTestModelDef({
      id: "gemini-1.5-pro",
      cuBase: 50n,
      cuInPer1k: 5n,
      cuCachedPer1k: 1n,
      cuOutPer1k: 20n,
    });

    const usage = {
      promptTokens: 1500,
      cachedTokens: 1000,
      completionTokens: 250,
      reasoningTokens: 250,
      totalTokens: 2000,
    };

    const expectedCu = calculateCu(modelDef, usage);
    // 50 base + ceil(1500*5/1000) + ceil(1000*1/1000) + ceil((250+250)*20/1000)
    // = 50 + 8 + 1 + 10 = 69
    expect(expectedCu).toBe(69n);

    const cascadeRes: CascadeRouteResponse = {
      content: "Reasoning model completion",
      costMicrodollars: 12000n,
      model: modelDef.id,
      provider: modelDef.provider,
      modelDef,
      attempts: [],
      usage,
    };

    const deps = createTestDependencies("openai");
    const response = await handleNonStreamingChat(
      deps,
      cascadeRes,
      authContext,
      mockKeyPool,
      mockEnv
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-kc-cu")).toBe("69");
    expect(response.headers.get("x-kc-cost-microdollars")).toBe("12000");

    const body = (await response.json()) as {
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        kc_cu: number;
      };
    };

    expect(body.usage.kc_cu).toBe(69);
  });

  it("handles null usage gracefully with zero CU and emits x-kc-cu: '0'", async () => {
    const modelDef = createTestModelDef();

    const cascadeRes: CascadeRouteResponse = {
      content: "No usage test",
      costMicrodollars: 0n,
      model: modelDef.id,
      provider: modelDef.provider,
      modelDef,
      attempts: [],
      usage: null,
    };

    const deps = createTestDependencies("openai");
    const response = await handleNonStreamingChat(
      deps,
      cascadeRes,
      authContext,
      mockKeyPool,
      mockEnv
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-kc-cu")).toBe("0");
    expect(response.headers.get("x-kc-cost-microdollars")).toBe("0");

    const body = (await response.json()) as {
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        kc_cu: number;
      };
    };

    expect(body.usage.kc_cu).toBe(0);
    expect(body.usage.prompt_tokens).toBe(0);
    expect(body.usage.completion_tokens).toBe(0);
    expect(body.usage.total_tokens).toBe(0);
  });
});
