/**
 * Unit Tests: Non-blocking proxy hot-path in non_streaming.ts
 * Task: T-2.1.1 (WP-2.1: Non-Blocking Proxy Hot-Path in `non_streaming.ts`)
 *
 * Invariants Tested:
 * 1. When `KC_ENV === "production"`, `handleChatCompletionNonStreaming` returns HTTP 200 before `workPromise` resolves.
 * 2. `ctx.waitUntil` is passed the background `postWork()` promise.
 * 3. When `KC_ENV === "test"`, `workPromise` is awaited synchronously to preserve integration test assertions.
 * 4. Alias `handleChatCompletionNonStreaming` is exported.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { KeyPoolContract } from "../../../src/contracts/key_pool";
import type { CascadeRouteResponse } from "../../../src/router/cascade/index";
import { LeaseOrchestrator, type LeaseSettleResult } from "../../../src/router/leases/orchestrator";
import { ModelRegistry } from "../../../src/router/registry/index";
import type { ModelDef } from "../../../src/types/models";
import type { AuthenticatedContext, WorkerEnv } from "../../../src/worker/auth/index";
import type { ChatHandlerDependencies } from "../../../src/worker/router/chat/types";
import type { ExecutionContextLike, TelemetryEmitter } from "../../../src/worker/telemetry_emitter";
import type { CostLedgerRepository } from "../../../src/storage/repositories/cost_ledger/index";
import * as nonStreamingModule from "../../../src/worker/router/chat/non_streaming";

const handleChatCompletionNonStreaming =
  (nonStreamingModule as { handleChatCompletionNonStreaming?: typeof nonStreamingModule.handleNonStreamingResponse })
    .handleChatCompletionNonStreaming ?? nonStreamingModule.handleNonStreamingResponse;

function createTestModelDef(overrides?: Partial<ModelDef>): ModelDef {
  return {
    id: "gemini-2.5-flash",
    provider: "google",
    logicalAliases: ["fast"],
    contextWindow: 1_048_576,
    maxOutputTokens: 65536,
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

describe("Non-Blocking Proxy Hot-Path - T-2.1.1", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const authContext: AuthenticatedContext = {
    tenantId: "tenant-hotpath-test",
    isAuthenticated: true,
    rpmLimit: 60,
    currentRpm: 1,
    remainingRpm: 59,
    budgetCeilingCu: 0n,
    spentTotalCu: 0n,
    token: {
      id: "tok_test_123",
      tenantId: "tenant-hotpath-test",
      name: "Test Token",
      tokenHash: "hash",
      preview: "kc_live_...",
      createdAt: 1700000000000,
      revokedAt: null,
      rpmLimit: 60,
      budgetCeilingCu: 0n,
      spentTotalCu: 0n,
    },
  };

  const mockKeyPool = {
    recordUsage: vi.fn().mockResolvedValue(undefined),
  } as unknown as KeyPoolContract;

  it("returns HTTP 200 before workPromise resolves when KC_ENV is production", async () => {
    expect(
      typeof (nonStreamingModule as { handleChatCompletionNonStreaming?: unknown }).handleChatCompletionNonStreaming
    ).toBe("function");

    const modelDef = createTestModelDef();
    const cascadeRes: CascadeRouteResponse = {
      content: "Production non-blocking response",
      costCu: 5000n,
      model: modelDef.id,
      provider: modelDef.provider,
      modelDef,
      attempts: [],
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      lease: {
        leaseId: "lease-prod-1",
        keyId: "key-prod-1",
        source: "own_community",
        ownerTenantId: "tenant-owner",
        provider: "google",
      },
    };

    let settleCompleted = false;
    let resolveSettle!: (value: LeaseSettleResult) => void;
    const settlePromise = new Promise<LeaseSettleResult>((resolve) => {
      resolveSettle = (val: LeaseSettleResult) => {
        settleCompleted = true;
        resolve(val);
      };
    });

    const settleSpy = vi.spyOn(LeaseOrchestrator.prototype, "settle").mockReturnValue(settlePromise);

    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx: ExecutionContextLike = {
      waitUntil: vi.fn().mockImplementation((p: Promise<unknown>) => {
        waitUntilPromises.push(p);
      }),
    };

    const env: WorkerEnv = {
      KC_ENV: "production",
    };

    const deps = createTestDependencies();

    const responsePromise = handleChatCompletionNonStreaming(
      deps,
      cascadeRes,
      authContext,
      mockKeyPool,
      env,
      ctx
    );

    // Timeout race ensures that if handler awaits workPromise synchronously, it fails fast
    const timeoutPromise = new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout: response did not resolve before workPromise settled")), 150)
    );

    const response = await Promise.race([responsePromise, timeoutPromise]);

    expect(response.status).toBe(200);
    // Background work is still pending when response returns
    expect(settleCompleted).toBe(false);
    expect(settleSpy).toHaveBeenCalled();
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);

    // Resolve the background work and ensure clean completion
    resolveSettle({ settled: true, duplicate: false });
    await Promise.all(waitUntilPromises);
    expect(settleCompleted).toBe(true);
  });

  it("passes the background postWork() promise to ctx.waitUntil", async () => {
    const modelDef = createTestModelDef();
    const cascadeRes: CascadeRouteResponse = {
      content: "WaitUntil verification response",
      costCu: 2000n,
      model: modelDef.id,
      provider: modelDef.provider,
      modelDef,
      attempts: [],
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
      },
    };

    let backgroundWorkFinished = false;
    let resolveCostLedger!: () => void;
    const costLedgerPromise = new Promise<void>((resolve) => {
      resolveCostLedger = () => {
        backgroundWorkFinished = true;
        resolve();
      };
    });

    const mockCostLedgerRepo: CostLedgerRepository = {
      recordEvent: vi.fn().mockReturnValue(costLedgerPromise),
    } as unknown as CostLedgerRepository;

    const deps = createTestDependencies();
    deps.getCostLedgerRepo = () => mockCostLedgerRepo;

    let capturedPromise: Promise<unknown> | undefined;
    const ctx: ExecutionContextLike = {
      waitUntil: vi.fn().mockImplementation((p: Promise<unknown>) => {
        capturedPromise = p;
      }),
    };

    const env: WorkerEnv = {
      KC_ENV: "production",
    };

    const responsePromise = handleChatCompletionNonStreaming(
      deps,
      cascadeRes,
      authContext,
      mockKeyPool,
      env,
      ctx
    );

    const timeoutPromise = new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout: response did not resolve before postWork settled")), 150)
    );

    const response = await Promise.race([responsePromise, timeoutPromise]);

    expect(response.status).toBe(200);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(capturedPromise).toBeDefined();
    expect(capturedPromise).toBeInstanceOf(Promise);
    expect(backgroundWorkFinished).toBe(false);

    // Resolving background work allows the waitUntil promise to complete
    resolveCostLedger();
    await capturedPromise;
    expect(backgroundWorkFinished).toBe(true);
    expect(mockCostLedgerRepo.recordEvent).toHaveBeenCalled();
  });

  it("awaits workPromise synchronously before returning when KC_ENV is test", async () => {
    const modelDef = createTestModelDef();
    const cascadeRes: CascadeRouteResponse = {
      content: "Test environment synchronous response",
      costCu: 3000n,
      model: modelDef.id,
      provider: modelDef.provider,
      modelDef,
      attempts: [],
      usage: {
        promptTokens: 200,
        completionTokens: 80,
        totalTokens: 280,
      },
      lease: {
        leaseId: "lease-test-sync",
        keyId: "key-test-sync",
        source: "own_community",
        ownerTenantId: "tenant-owner",
        provider: "google",
      },
    };

    let settleCompleted = false;
    vi.spyOn(LeaseOrchestrator.prototype, "settle").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      settleCompleted = true;
      return { settled: true, duplicate: false };
    });

    let ledgerCompleted = false;
    const mockCostLedgerRepo: CostLedgerRepository = {
      recordEvent: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        ledgerCompleted = true;
      }),
    } as unknown as CostLedgerRepository;

    const deps = createTestDependencies();
    deps.getCostLedgerRepo = () => mockCostLedgerRepo;

    const ctx: ExecutionContextLike = {
      waitUntil: vi.fn(),
    };

    const env: WorkerEnv = {
      KC_ENV: "test",
    };

    const response = await handleChatCompletionNonStreaming(
      deps,
      cascadeRes,
      authContext,
      mockKeyPool,
      env,
      ctx
    );

    expect(response.status).toBe(200);
    // When KC_ENV === "test", workPromise is awaited before handleChatCompletionNonStreaming returns
    expect(settleCompleted).toBe(true);
    expect(ledgerCompleted).toBe(true);
    expect(mockCostLedgerRepo.recordEvent).toHaveBeenCalled();
  });

  it("handles missing execution context gracefully without throwing", async () => {
    const modelDef = createTestModelDef();
    const cascadeRes: CascadeRouteResponse = {
      content: "No ctx response",
      costCu: 1000n,
      model: modelDef.id,
      provider: modelDef.provider,
      modelDef,
      attempts: [],
      usage: null,
    };

    const deps = createTestDependencies();
    const env: WorkerEnv = {
      KC_ENV: "production",
    };

    const response = await handleChatCompletionNonStreaming(
      deps,
      cascadeRes,
      authContext,
      mockKeyPool,
      env
    );

    expect(response.status).toBe(200);
  });
});
