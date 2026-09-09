/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: CascadeRouter (router-cascade-router)
 *
 * Invariants & Standards Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no `any`).
 * - Fixed-Point Microdollars: zero floating-point math (int64 / bigint microdollars).
 * - Non-blocking hot path: KeyPool usage & result tracking.
 *
 * Conforms to:
 * - LLD 2.3: CascadeRouter orchestration, multi-model cascade, fallback escalation.
 * - LLD 4.0: Unit tests with mock KeyPool and UpstreamClient (success path, fallback escalation path).
 * - Golden Test tc-01: Routes request to provider key with successful 200 response & cost calculation.
 * - Golden Test tc-05: Rejects prompt exceeding context window before network call (HTTP 400).
 * - Golden Test tc-06: Model alias resolution (e.g. 'smart-fast' -> 'gemini-2.0-flash' on google).
 * - Golden Test tc-07: Capability filter excludes unsupported models when tools/vision requested.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CascadeRouter,
  CascadeRouteRequest,
  CascadeRouteResponse,
  isCascadeRouteRequest,
  isCascadeRouteResponse,
} from "./cascade_router";
import {
  ModelRegistry,
  DEFAULT_MODEL_DEFINITIONS,
  ContextWindowExceededError,
} from "./model_registry";
import { CapabilityFilter } from "./capability_filter";
import {
  UpstreamClient,
  UpstreamChatResponse,
  UpstreamResponse,
} from "../proxy/upstream_client";
import type { KeyPoolContract } from "../contracts/key_pool";
import type { ModelDef } from "../types/models";
import {
  RateLimitExceededError,
  CircuitBreakerTrippedError,
  ProviderRoutingError,
  ProviderTimeoutError,
  FallbackExhaustedError,
  CapabilityMismatchError,
  ModelNotFoundError,
} from "../errors";

describe("CascadeRouter", () => {
  // Custom test models
  const cheapGoogleModel: ModelDef<bigint> = {
    id: "gemini-2.0-flash",
    provider: "google",
    logicalAliases: ["smart-fast", "fast-model", "fast"],
    contextWindow: 1_000_000,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 100_000n, // 0.10 USD
    outputCostPerMTokMicro: 400_000n, // 0.40 USD
    cacheReadCostPerMTokMicro: 25_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    isActive: true,
  };

  const midOpenAIModel: ModelDef<bigint> = {
    id: "gpt-4o-mini",
    provider: "openai",
    logicalAliases: ["openai-fast"],
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    inputCostPerMTokMicro: 150_000n, // 0.15 USD
    outputCostPerMTokMicro: 600_000n, // 0.60 USD
    cacheReadCostPerMTokMicro: 75_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    isActive: true,
  };

  const anthropicModel: ModelDef<bigint> = {
    id: "claude-3-5-haiku",
    provider: "anthropic",
    logicalAliases: ["haiku-fast"],
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 800_000n, // 0.80 USD
    outputCostPerMTokMicro: 4_000_000n, // 4.00 USD
    cacheReadCostPerMTokMicro: 80_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    isActive: true,
  };

  const textOnlyCheapModel: ModelDef<bigint> = {
    id: "cheap-text-legacy",
    provider: "groq",
    logicalAliases: ["legacy-text"],
    contextWindow: 8192,
    maxOutputTokens: 2048,
    inputCostPerMTokMicro: 50_000n, // Cheapest
    outputCostPerMTokMicro: 100_000n,
    cacheReadCostPerMTokMicro: 10_000n,
    supportsTools: false,
    supportsVision: false,
    supportsJsonSchema: false,
    isActive: true,
  };

  let registry: ModelRegistry;
  let capabilityFilter: CapabilityFilter;
  let mockKeyPool: {
    getKey: ReturnType<typeof vi.fn>;
    recordUsage: ReturnType<typeof vi.fn>;
    recordResult: ReturnType<typeof vi.fn>;
  };
  let mockUpstreamClient: UpstreamClient & {
    chat: ReturnType<typeof vi.fn>;
  };

  function createMockUpstreamResponse(overrides?: Partial<UpstreamResponse>): UpstreamResponse {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      rawResponse: new Response(),
      body: null,
      text: async () => "Hello world response",
      json: async <T = unknown>() => ({ choices: [{ message: { content: "Hello world response" } }] } as unknown as T),
      getUsage: async () => ({ promptTokens: 100, completionTokens: 50, totalTokens: 150 }),
      getMetadata: async () => null,
      ...overrides,
    };
  }

  function createSuccessfulChatResponse(
    model: string,
    provider: string,
    content = "Hello world response"
  ): UpstreamChatResponse {
    return {
      content,
      model,
      provider,
      usage: {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      },
      costMicrodollars: 300n,
      response: createMockUpstreamResponse(),
    };
  }

  beforeEach(() => {
    registry = new ModelRegistry([
      cheapGoogleModel,
      midOpenAIModel,
      anthropicModel,
      textOnlyCheapModel,
    ]);
    capabilityFilter = new CapabilityFilter(registry);

    mockKeyPool = {
      getKey: vi.fn().mockImplementation(async (provider: string) => `key-for-${provider}`),
      recordUsage: vi.fn().mockResolvedValue(undefined),
      recordResult: vi.fn().mockResolvedValue(undefined),
    };

    const client = new UpstreamClient({ keyPool: mockKeyPool });
    client.chat = vi.fn();
    mockUpstreamClient = client as UpstreamClient & { chat: ReturnType<typeof vi.fn> };
  });

  describe("Initialization and Accessors", () => {
    it("initializes with default registry and capability filter when none provided", () => {
      const router = new CascadeRouter();
      expect(router.getRegistry()).toBeInstanceOf(ModelRegistry);
      expect(router.getCapabilityFilter()).toBeInstanceOf(CapabilityFilter);
      expect(router.getUpstreamClient()).toBeInstanceOf(UpstreamClient);
      expect(router.getKeyPool()).toBeUndefined();
    });

    it("accepts custom injected components", () => {
      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
        keyPool: mockKeyPool,
        maxFallbacks: 5,
      });

      expect(router.getRegistry()).toBe(registry);
      expect(router.getCapabilityFilter()).toBe(capabilityFilter);
      expect(router.getUpstreamClient()).toBe(mockUpstreamClient);
      expect(router.getKeyPool()).toBe(mockKeyPool);
    });
  });

  describe("Pre-Flight Candidate Resolution (getCandidates & selectPrimaryModel)", () => {
    it("selects cheapest capable model when alias is 'auto'", () => {
      const router = new CascadeRouter({ registry, capabilityFilter });
      const candidates = router.getCandidates({
        modelAlias: "auto",
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
      });

      // cheap-text-legacy is cheapest overall (50_000 input cost) and capable for simple text
      expect(candidates[0].id).toBe("cheap-text-legacy");
      expect(candidates[1].id).toBe("gemini-2.0-flash");
      expect(candidates[2].id).toBe("gpt-4o-mini");
      expect(candidates[3].id).toBe("claude-3-5-haiku");
    });

    it("resolves logical alias to canonical model as primary candidate (tc-06)", () => {
      const router = new CascadeRouter({ registry, capabilityFilter });
      const candidates = router.getCandidates({
        modelAlias: "smart-fast",
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
      });

      // 'smart-fast' maps to 'gemini-2.0-flash'
      expect(candidates[0].id).toBe("gemini-2.0-flash");
      expect(candidates[0].provider).toBe("google");
      // Other capable models follow as fallbacks
      expect(candidates.slice(1).map((m) => m.id)).toContain("gpt-4o-mini");
    });

    it("filters out text-only models when tools are requested (tc-07)", () => {
      const router = new CascadeRouter({ registry, capabilityFilter });
      const candidates = router.getCandidates({
        modelAlias: "auto",
        messages: [{ role: "user", content: "Calculate 2+2" }],
        stream: false,
        tools: [
          {
            type: "function",
            function: { name: "calculator", description: "calc" },
          },
        ],
      } as CascadeRouteRequest);

      // cheap-text-legacy does not support tools and must be excluded
      expect(candidates.some((c) => c.id === "cheap-text-legacy")).toBe(false);
      // Gemini 2.0 Flash is cheapest tool-capable model
      expect(candidates[0].id).toBe("gemini-2.0-flash");
      expect(candidates[0].supportsTools).toBe(true);
    });

    it("throws ContextWindowExceededError (HTTP 400) if prompt exceeds model context window (tc-05)", () => {
      const router = new CascadeRouter({ registry, capabilityFilter });

      // Request explicitly targets cheap-text-legacy (contextWindow: 8192)
      // but estimatedPromptTokens is 100,000
      expect(() =>
        router.getCandidates({
          modelAlias: "cheap-text-legacy",
          messages: [{ role: "user", content: "very large prompt" }],
          stream: false,
          estimatedPromptTokens: 100_000,
        } as CascadeRouteRequest)
      ).toThrow(ContextWindowExceededError);

      try {
        router.getCandidates({
          modelAlias: "cheap-text-legacy",
          messages: [],
          stream: false,
          estimatedPromptTokens: 100_000,
        } as CascadeRouteRequest);
      } catch (err) {
        expect(err).toBeInstanceOf(ContextWindowExceededError);
        expect((err as ContextWindowExceededError).statusCode).toBe(400);
      }
    });

    it("throws ModelNotFoundError (HTTP 404) for unknown model aliases", () => {
      const router = new CascadeRouter({ registry, capabilityFilter });
      expect(() =>
        router.getCandidates({
          modelAlias: "non-existent-model",
          messages: [{ role: "user", content: "Hi" }],
          stream: false,
        })
      ).toThrow(ModelNotFoundError);
    });

    it("throws CapabilityMismatchError if requested explicit model lacks required tools", () => {
      const router = new CascadeRouter({ registry, capabilityFilter });
      expect(() =>
        router.getCandidates({
          modelAlias: "cheap-text-legacy", // supportsTools: false
          messages: [{ role: "user", content: "Hi" }],
          stream: false,
          tools: [{ type: "function" }],
        } as CascadeRouteRequest)
      ).toThrow(CapabilityMismatchError);
    });

    it("respects explicit fallbackModels priority list", () => {
      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        fallbackModels: ["claude-3-5-haiku", "gpt-4o-mini"],
      });

      const candidates = router.getCandidates({
        modelAlias: "gemini-2.0-flash",
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
      });

      expect(candidates[0].id).toBe("gemini-2.0-flash");
      expect(candidates[1].id).toBe("claude-3-5-haiku"); // explicitly prioritized
      expect(candidates[2].id).toBe("gpt-4o-mini");
    });
  });

  describe("Happy Path Routing (tc-01 & LLD 4.0)", () => {
    it("routes successfully to primary model and records key usage", async () => {
      mockUpstreamClient.chat.mockResolvedValueOnce(
        createSuccessfulChatResponse("gemini-2.0-flash", "google", "2+2 is 4")
      );

      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
        keyPool: mockKeyPool,
      });

      const response = await router.route({
        modelAlias: "smart-fast",
        messages: [{ role: "user", content: "What is 2+2?" }],
        stream: false,
      });

      expect(response.content).toBe("2+2 is 4");
      expect(response.model).toBe("gemini-2.0-flash");
      expect(response.provider).toBe("google");
      expect(response.attempts.length).toBe(0);
      expect(response.costMicrodollars).toBeGreaterThan(0n);

      // Verify KeyPool interactions
      expect(mockKeyPool.getKey).toHaveBeenCalledWith("google");
      expect(mockKeyPool.recordResult).toHaveBeenCalledWith("key-for-google", true);
      expect(mockKeyPool.recordUsage).toHaveBeenCalledWith(
        "key-for-google",
        response.costMicrodollars
      );

      // Verify UpstreamClient call arguments
      expect(mockUpstreamClient.chat).toHaveBeenCalledTimes(1);
      const callArgs = mockUpstreamClient.chat.mock.calls[0][0];
      expect(callArgs.provider).toBe("google");
      expect(callArgs.model).toBe("gemini-2.0-flash");
      expect(callArgs.apiKey).toBe("key-for-google");
    });

    it("calculates cost in fixed-point microdollars using ModelRegistry when upstream returns 0n", async () => {
      mockUpstreamClient.chat.mockResolvedValueOnce({
        content: "Exact cost calculation",
        model: "gemini-2.0-flash",
        provider: "google",
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        },
        costMicrodollars: 0n, // simulate uncalculated upstream cost
        response: createMockUpstreamResponse(),
      });

      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
        keyPool: mockKeyPool,
      });

      const response = await router.route({
        modelAlias: "gemini-2.0-flash",
        messages: [{ role: "user", content: "Test prompt" }],
        stream: false,
      });

      // Gemini 2.0 Flash:
      // prompt: 1000 * 100_000 / 1_000_000 = 100 microdollars
      // completion: 500 * 400_000 / 1_000_000 = 200 microdollars
      // total = 300 microdollars
      expect(response.costMicrodollars).toBe(300n);
      expect(mockKeyPool.recordUsage).toHaveBeenCalledWith("key-for-google", 300n);
    });

    it("handles streaming passthrough mode cleanly", async () => {
      mockUpstreamClient.chat.mockResolvedValueOnce({
        content: "",
        model: "gemini-2.0-flash",
        provider: "google",
        usage: null,
        costMicrodollars: 0n,
        response: createMockUpstreamResponse({
          body: new ReadableStream(),
        }),
      });

      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
        keyPool: mockKeyPool,
      });

      const response = await router.route({
        modelAlias: "smart-fast",
        messages: [{ role: "user", content: "Stream me" }],
        stream: true,
      });

      expect(response.content).toBe("");
      expect(response.costMicrodollars).toBe(0n);
      expect(response.response?.body).toBeDefined();
    });
  });

  describe("Fallback Escalation (LLD 4.0: First fails with 429, second succeeds)", () => {
    it("escalates to secondary candidate when primary fails with HTTP 429", async () => {
      // Primary (Gemini on Google) fails with 429
      mockUpstreamClient.chat.mockRejectedValueOnce(
        new RateLimitExceededError("Rate limit exceeded for Google Gemini", {
          provider: "google",
          retryAfterSeconds: 60,
        })
      );

      // Fallback (GPT-4o-mini on OpenAI) succeeds
      mockUpstreamClient.chat.mockResolvedValueOnce(
        createSuccessfulChatResponse("gpt-4o-mini", "openai", "Response from fallback")
      );

      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
        keyPool: mockKeyPool,
      });

      // Request requires tools so textOnlyCheapModel is excluded from candidates
      const response = await router.route({
        modelAlias: "smart-fast", // primary: gemini-2.0-flash
        messages: [{ role: "user", content: "Need answer" }],
        stream: false,
        tools: [{ type: "function", function: { name: "search" } }],
      } as CascadeRouteRequest);

      expect(response.content).toBe("Response from fallback");
      expect(response.model).toBe("gpt-4o-mini");
      expect(response.provider).toBe("openai");

      // Verify attempts history
      expect(response.attempts.length).toBe(1);
      expect(response.attempts[0].provider).toBe("google");
      expect(response.attempts[0].modelId).toBe("gemini-2.0-flash");
      expect(response.attempts[0].error).toContain("Rate limit exceeded");

      // Verify KeyPool tracking: failure recorded on google, success on openai
      expect(mockKeyPool.recordResult).toHaveBeenCalledWith("key-for-google", false);
      expect(mockKeyPool.recordResult).toHaveBeenCalledWith("key-for-openai", true);
      expect(mockKeyPool.recordUsage).toHaveBeenCalledWith(
        "key-for-openai",
        response.costMicrodollars
      );
    });

    it("escalates to secondary candidate when primary key acquisition fails (circuit breaker open)", async () => {
      // Google key acquisition fails with CircuitBreakerTrippedError
      mockKeyPool.getKey.mockRejectedValueOnce(
        new CircuitBreakerTrippedError("google", "Circuit open for google provider", {
          retryAfterSeconds: 60,
        })
      );
      // OpenAI key acquisition succeeds
      mockKeyPool.getKey.mockResolvedValueOnce("key-for-openai");

      // OpenAI chat succeeds
      mockUpstreamClient.chat.mockResolvedValueOnce(
        createSuccessfulChatResponse("gpt-4o-mini", "openai", "Recovered via OpenAI")
      );

      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
        keyPool: mockKeyPool,
      });

      // Request requires tools so textOnlyCheapModel is excluded
      const response = await router.route({
        modelAlias: "smart-fast",
        messages: [{ role: "user", content: "Test circuit breaker escalation" }],
        stream: false,
        tools: [{ type: "function", function: { name: "search" } }],
      } as CascadeRouteRequest);

      expect(response.model).toBe("gpt-4o-mini");
      expect(response.attempts.length).toBe(1);
      expect(response.attempts[0].error).toContain("Key acquisition failed");
      expect(response.attempts[0].provider).toBe("google");
    });

    it("cascades through multiple failures before succeeding", async () => {
      // Candidate 1 (gemini-2.0-flash) fails with 429
      mockUpstreamClient.chat.mockRejectedValueOnce(
        new RateLimitExceededError("Rate limited on gemini")
      );

      // Candidate 2 (gpt-4o-mini) fails with 500 ProviderRoutingError
      mockUpstreamClient.chat.mockRejectedValueOnce(
        new ProviderRoutingError("openai", "OpenAI internal 500 error")
      );

      // Candidate 3 (claude-3-5-haiku) succeeds
      mockUpstreamClient.chat.mockResolvedValueOnce(
        createSuccessfulChatResponse("claude-3-5-haiku", "anthropic", "Anthropic succeeded")
      );

      const onFallback = vi.fn();
      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
        keyPool: mockKeyPool,
        onFallback,
      });

      // Request with tools -> candidates: [gemini-2.0-flash, gpt-4o-mini, claude-3-5-haiku]
      const response = await router.route({
        modelAlias: "smart-fast",
        messages: [{ role: "user", content: "Cascade test" }],
        stream: false,
        tools: [{ type: "function", function: { name: "search" } }],
      } as CascadeRouteRequest);

      expect(response.model).toBe("claude-3-5-haiku");
      expect(response.provider).toBe("anthropic");
      expect(response.attempts.length).toBe(2);
      expect(response.attempts[0].modelId).toBe("gemini-2.0-flash");
      expect(response.attempts[1].modelId).toBe("gpt-4o-mini");

      // Verify onFallback hook fired twice
      expect(onFallback).toHaveBeenCalledTimes(2);
    });

    it("escalates to cheaper text-only model when tools are not required", async () => {
      // Primary (gemini-2.0-flash) fails with 500
      mockUpstreamClient.chat.mockRejectedValueOnce(
        new ProviderRoutingError("google", "Google 500 error")
      );

      // Fallback (cheap-text-legacy) succeeds
      mockUpstreamClient.chat.mockResolvedValueOnce(
        createSuccessfulChatResponse("cheap-text-legacy", "groq", "Response from cheap text model")
      );

      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
        keyPool: mockKeyPool,
      });

      const response = await router.route({
        modelAlias: "gemini-2.0-flash",
        messages: [{ role: "user", content: "Simple text" }],
        stream: false,
      });

      expect(response.model).toBe("cheap-text-legacy");
      expect(response.provider).toBe("groq");
      expect(response.content).toBe("Response from cheap text model");
    });

    it("throws FallbackExhaustedError (HTTP 502) when all candidate models fail", async () => {
      // All candidates fail
      mockUpstreamClient.chat.mockRejectedValue(
        new ProviderRoutingError("test", "Upstream server failure")
      );

      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
        keyPool: mockKeyPool,
        maxFallbacks: 3,
      });

      await expect(
        router.route({
          modelAlias: "smart-fast",
          messages: [{ role: "user", content: "All fail" }],
          stream: false,
        })
      ).rejects.toThrow(FallbackExhaustedError);

      try {
        await router.route({
          modelAlias: "smart-fast",
          messages: [{ role: "user", content: "All fail" }],
          stream: false,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(FallbackExhaustedError);
        const fbErr = err as FallbackExhaustedError;
        expect(fbErr.statusCode).toBe(502);
        expect(fbErr.attemptedRoutes.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("respects maxFallbacks limit and stops attempting further candidates", async () => {
      mockUpstreamClient.chat.mockRejectedValue(
        new RateLimitExceededError("Rate limit exceeded")
      );

      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
        keyPool: mockKeyPool,
        maxFallbacks: 1, // only 1 fallback attempt (total 2 attempts)
      });

      try {
        await router.route({
          modelAlias: "auto",
          messages: [{ role: "user", content: "Test limit" }],
          stream: false,
        });
        expect.fail("Should have thrown FallbackExhaustedError");
      } catch (err) {
        expect(err).toBeInstanceOf(FallbackExhaustedError);
        const fbErr = err as FallbackExhaustedError;
        expect(fbErr.attemptedRoutes.length).toBe(2); // 1 primary + 1 fallback
      }
    });
  });

  describe("Cancellation and Edge Cases", () => {
    it("immediately aborts if request signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
      });

      await expect(
        router.route({
          modelAlias: "smart-fast",
          messages: [{ role: "user", content: "Aborted" }],
          stream: false,
          signal: controller.signal,
        } as CascadeRouteRequest)
      ).rejects.toThrow();

      expect(mockUpstreamClient.chat).not.toHaveBeenCalled();
    });

    it("does not cascade on caller AbortError during fetch", async () => {
      const abortErr = new DOMException("The user aborted a request.", "AbortError");
      mockUpstreamClient.chat.mockRejectedValueOnce(abortErr);

      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
      });

      await expect(
        router.route({
          modelAlias: "smart-fast",
          messages: [{ role: "user", content: "Aborting" }],
          stream: false,
        })
      ).rejects.toThrow();

      // Only 1 attempt made before stopping
      expect(mockUpstreamClient.chat).toHaveBeenCalledTimes(1);
    });

    it("passes custom headers and temperature through to UpstreamClient", async () => {
      mockUpstreamClient.chat.mockResolvedValueOnce(
        createSuccessfulChatResponse("gemini-2.0-flash", "google")
      );

      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
      });

      await router.route({
        modelAlias: "gemini-2.0-flash",
        messages: [{ role: "user", content: "Hello" }],
        stream: false,
        temperature: 0.7,
        maxTokens: 2048,
        headers: { "x-test-header": "test-val" },
      } as CascadeRouteRequest);

      expect(mockUpstreamClient.chat).toHaveBeenCalledTimes(1);
      const call = mockUpstreamClient.chat.mock.calls[0][0];
      expect(call.temperature).toBe(0.7);
      expect(call.maxTokens).toBe(2048);
      expect((call.headers as Record<string, string>)["x-test-header"]).toBe("test-val");
    });

    it("validates type guards isCascadeRouteRequest and isCascadeRouteResponse", () => {
      const validReq = {
        modelAlias: "auto",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      };
      expect(isCascadeRouteRequest(validReq)).toBe(true);
      expect(isCascadeRouteRequest(null)).toBe(false);
      expect(isCascadeRouteRequest({ modelAlias: 123 })).toBe(false);

      const validRes: CascadeRouteResponse = {
        content: "done",
        costMicrodollars: 100n,
        model: "gemini-2.0-flash",
        provider: "google",
        modelDef: cheapGoogleModel,
        attempts: [],
        usage: null,
      };
      expect(isCascadeRouteResponse(validRes)).toBe(true);
      expect(isCascadeRouteResponse({})).toBe(false);
    });
  });

  describe("Additional Edge Cases & Options Coverage", () => {
    it("allows escalation on capability mismatch when allowMismatchEscalation is true", async () => {
      mockUpstreamClient.chat.mockResolvedValueOnce(
        createSuccessfulChatResponse("gemini-2.0-flash", "google", "Escalated to tool model")
      );

      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
        keyPool: mockKeyPool,
        allowMismatchEscalation: true,
      });

      // Target textOnlyCheapModel directly, but request tools
      const response = await router.route({
        modelAlias: "cheap-text-legacy",
        messages: [{ role: "user", content: "Run tool" }],
        stream: false,
        tools: [{ type: "function", function: { name: "test" } }],
      } as CascadeRouteRequest);

      // Successfully escalated to gemini-2.0-flash
      expect(response.model).toBe("gemini-2.0-flash");
      expect(response.content).toBe("Escalated to tool model");
    });

    it("triggers onSuccess callback upon successful route", async () => {
      mockUpstreamClient.chat.mockResolvedValueOnce(
        createSuccessfulChatResponse("gemini-2.0-flash", "google", "Success with hook")
      );

      const onSuccess = vi.fn();
      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
        keyPool: mockKeyPool,
        onSuccess,
      });

      const response = await router.route({
        modelAlias: "smart-fast",
        messages: [{ role: "user", content: "Hook test" }],
        stream: false,
      });

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(response);
    });

    it("bypasses KeyPool when explicit apiKey is provided on request", async () => {
      mockUpstreamClient.chat.mockResolvedValueOnce(
        createSuccessfulChatResponse("gemini-2.0-flash", "google", "Custom key response")
      );

      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        upstreamClient: mockUpstreamClient,
        keyPool: mockKeyPool,
      });

      const response = await router.route({
        modelAlias: "gemini-2.0-flash",
        messages: [{ role: "user", content: "Custom key" }],
        stream: false,
        apiKey: "sk-explicit-user-key",
      } as CascadeRouteRequest);

      expect(mockKeyPool.getKey).not.toHaveBeenCalled();
      expect(mockUpstreamClient.chat).toHaveBeenCalledTimes(1);
      expect(mockUpstreamClient.chat.mock.calls[0][0].apiKey).toBe("sk-explicit-user-key");
      expect(response.content).toBe("Custom key response");
    });

    it("supports selectPrimaryModel and getFallbackCandidates helper methods", () => {
      const router = new CascadeRouter({
        registry,
        capabilityFilter,
        maxFallbacks: 2,
      });

      const req: CascadeRouteRequest = {
        modelAlias: "smart-fast",
        messages: [{ role: "user", content: "test" }],
        stream: false,
        tools: [{ type: "function", function: { name: "test" } }],
      };

      const primary = router.selectPrimaryModel(req);
      expect(primary.id).toBe("gemini-2.0-flash");

      const fallbacks = router.getFallbackCandidates(req);
      expect(fallbacks.length).toBe(2);
      expect(fallbacks[0].id).toBe("gpt-4o-mini");
      expect(fallbacks[1].id).toBe("claude-3-5-haiku");
    });

    it("handles generic routing keywords: cheapest, default, cascade", () => {
      const router = new CascadeRouter({ registry, capabilityFilter });

      for (const kw of ["cheapest", "default", "cascade", ""]) {
        const candidates = router.getCandidates({
          modelAlias: kw,
          messages: [{ role: "user", content: "test" }],
          stream: false,
        });
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates[0].id).toBe("cheap-text-legacy"); // cheapest
      }
    });

    it("throws CapabilityMismatchError if generic route requirements cannot be met", () => {
      const router = new CascadeRouter({ registry, capabilityFilter });

      // Request requiring huge context that exceeds all models (max in test models is 1,000,000)
      expect(() =>
        router.getCandidates({
          modelAlias: "auto",
          messages: [{ role: "user", content: "test" }],
          stream: false,
          estimatedPromptTokens: 2_000_000,
        } as CascadeRouteRequest)
      ).toThrow(CapabilityMismatchError);
    });
  });
});
