/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: ModelRegistry (router-model-registry)
 *
 * Invariants & Standards:
 * - Fixed-Point Microdollars: All pricing and cost calculations in int64 / bigint microdollars.
 * - Zero floating-point math for financials.
 * - Logical alias lookup: handles direct models, implicit aliases, explicit overrides, and cost-optimal ties.
 * - Context window tracking: enforces context boundaries, token limits, and HTTP 400 error triggers (tc-05).
 * - Exact golden cost assertions (tc-06, tc-09).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ModelRegistry,
  DEFAULT_MODEL_DEFINITIONS,
  ContextWindowExceededError,
  isContextWindowExceededError,
  TokenUsage,
} from "./model_registry";
import { ModelDef, createModelDef } from "../types/models";
import {
  ModelNotFoundError,
  UnknownModelAliasError,
} from "../errors";

describe("ModelRegistry", () => {
  let registry: ModelRegistry;

  const customModel1: ModelDef<bigint> = {
    id: "mock-fast-1",
    provider: "google",
    logicalAliases: ["fast-model", "smart-fast"],
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    inputCostPerMTokMicro: 150_000n, // bash.15 / 1M
    outputCostPerMTokMicro: 600_000n, // bash.60 / 1M
    cacheReadCostPerMTokMicro: 37_500n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    isActive: true,
  };

  const customModel2: ModelDef<bigint> = {
    id: "mock-fast-2",
    provider: "openai",
    logicalAliases: ["fast-model"],
    contextWindow: 64_000,
    maxOutputTokens: 2048,
    inputCostPerMTokMicro: 300_000n, // bash.30 / 1M (more expensive than mock-fast-1)
    outputCostPerMTokMicro: 1_200_000n,
    cacheReadCostPerMTokMicro: 75_000n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    isActive: true,
  };

  const customModel3Inactive: ModelDef<bigint> = {
    id: "mock-inactive",
    provider: "anthropic",
    logicalAliases: ["retired-model", "fast-model"],
    contextWindow: 100_000,
    maxOutputTokens: 4096,
    inputCostPerMTokMicro: 50_000n, // cheapest, but inactive!
    outputCostPerMTokMicro: 200_000n,
    cacheReadCostPerMTokMicro: 10_000n,
    supportsTools: false,
    supportsVision: false,
    supportsJsonSchema: false,
    isActive: false,
  };

  beforeEach(() => {
    // Default registry with default models
    registry = new ModelRegistry();
  });

  describe("Initialization & Default Catalog", () => {
    it("loads default model catalog when instantiated without arguments", () => {
      expect(registry.getAllModels().length).toBe(DEFAULT_MODEL_DEFINITIONS.length);
      expect(registry.hasModel("gemini-2.0-flash")).toBe(true);
      expect(registry.hasModel("gpt-4o")).toBe(true);
      expect(registry.hasModel("claude-3-5-sonnet")).toBe(true);
      expect(registry.hasModel("deepseek-chat")).toBe(true);
      expect(registry.hasModel("llama-3.3-70b-versatile")).toBe(true);
    });

    it("accepts custom models in constructor", () => {
      const customReg = new ModelRegistry([customModel1, customModel2]);
      expect(customReg.getAllModels().length).toBe(2);
      expect(customReg.hasModel("mock-fast-1")).toBe(true);
      expect(customReg.hasModel("mock-fast-2")).toBe(true);
      expect(customReg.hasModel("gpt-4o")).toBe(false);
    });

    it("accepts options object with models and initial alias overrides", () => {
      const customReg = new ModelRegistry({
        models: [customModel1],
        aliases: { "my-alias": "mock-fast-1" },
      });
      expect(customReg.hasModel("mock-fast-1")).toBe(true);
      expect(customReg.resolveAlias("my-alias")).toBe("mock-fast-1");
    });

    it("normalizes number costs to bigint microdollars without floating-point errors", () => {
      const numberModel: ModelDef<number> = {
        id: "number-model",
        provider: "google",
        logicalAliases: ["num-alias"],
        contextWindow: 32000,
        maxOutputTokens: 4096,
        inputCostPerMTokMicro: 500000,
        outputCostPerMTokMicro: 1500000,
        cacheReadCostPerMTokMicro: 100000,
        supportsTools: true,
        supportsVision: false,
        supportsJsonSchema: true,
        isActive: true,
      };

      const numReg = new ModelRegistry([numberModel]);
      const stored = numReg.getModel("number-model");
      expect(stored).toBeDefined();
      expect(typeof stored?.inputCostPerMTokMicro).toBe("bigint");
      expect(stored?.inputCostPerMTokMicro).toBe(500000n);
      expect(stored?.outputCostPerMTokMicro).toBe(1500000n);
      expect(stored?.cacheReadCostPerMTokMicro).toBe(100000n);
    });
  });

  describe("Model Management CRUD", () => {
    it("registers and updates a model definition", () => {
      const reg = new ModelRegistry([]);
      expect(reg.hasModel("mock-fast-1")).toBe(false);

      reg.registerModel(customModel1);
      expect(reg.hasModel("mock-fast-1")).toBe(true);

      const updated = { ...customModel1, contextWindow: 256_000 };
      reg.registerModel(updated);
      expect(reg.getModel("mock-fast-1")?.contextWindow).toBe(256_000);
    });

    it("throws TypeError when registering model with invalid ID", () => {
      const reg = new ModelRegistry([]);
      expect(() =>
        reg.registerModel({ ...customModel1, id: "   " })
      ).toThrow(TypeError);
    });

    it("registers multiple models in batch", () => {
      const reg = new ModelRegistry([]);
      reg.registerModels([customModel1, customModel2]);
      expect(reg.getAllModels().length).toBe(2);
    });

    it("unregisters a model and removes pointing alias overrides", () => {
      const reg = new ModelRegistry([customModel1]);
      reg.registerAlias("fast", "mock-fast-1");
      expect(reg.hasModel("mock-fast-1")).toBe(true);
      expect(reg.resolveAlias("fast")).toBe("mock-fast-1");

      const removed = reg.unregisterModel("mock-fast-1");
      expect(removed).toBe(true);
      expect(reg.hasModel("mock-fast-1")).toBe(false);
      expect(reg.resolveAlias("fast")).toBeUndefined();
    });

    it("getModelOrThrow returns model or throws ModelNotFoundError", () => {
      expect(registry.getModelOrThrow("gemini-2.0-flash").id).toBe("gemini-2.0-flash");
      expect(() => registry.getModelOrThrow("non-existent-model")).toThrow(
        ModelNotFoundError
      );
    });

    it("filters active vs inactive models", () => {
      const reg = new ModelRegistry([customModel1, customModel3Inactive]);
      expect(reg.getAllModels(false).length).toBe(2);
      expect(reg.getAllModels(true).length).toBe(1);
      expect(reg.getActiveModels().map((m) => m.id)).toEqual(["mock-fast-1"]);
    });

    it("retrieves models by provider", () => {
      const googleModels = registry.getModelsByProvider("google");
      expect(googleModels.length).toBeGreaterThanOrEqual(2);
      for (const m of googleModels) {
        expect(m.provider).toBe("google");
      }

      const anthropicModels = registry.getModelsByProvider("anthropic");
      expect(anthropicModels.some((m) => m.id === "claude-3-5-sonnet")).toBe(true);
    });
  });

  describe("Logical Alias Resolution", () => {
    it("resolves canonical model ID directly (case-insensitive)", () => {
      const resolved = registry.resolveModel("gemini-2.0-flash");
      expect(resolved?.id).toBe("gemini-2.0-flash");

      const resolvedUpper = registry.resolveModel("GEMINI-2.0-FLASH");
      expect(resolvedUpper?.id).toBe("gemini-2.0-flash");
    });

    it("resolves logical aliases to canonical models (tc-06)", () => {
      // 'smart-fast' maps to 'gemini-2.0-flash'
      const resolved = registry.resolveModel("smart-fast");
      expect(resolved).toBeDefined();
      expect(resolved?.id).toBe("gemini-2.0-flash");
      expect(resolved?.provider).toBe("google");
    });

    it("resolves shared alias to the cheapest active model", () => {
      // Both mock-fast-1 (bash.15) and mock-fast-2 (bash.30) share 'fast-model'
      // Inactive mock-inactive (bash.05) also shares 'fast-model'
      const reg = new ModelRegistry([
        customModel2,
        customModel1,
        customModel3Inactive,
      ]);

      const resolved = reg.resolveModel("fast-model");
      expect(resolved?.id).toBe("mock-fast-1"); // Picks cheapest active model
    });

    it("allows explicit alias overrides that take precedence", () => {
      const reg = new ModelRegistry([customModel1, customModel2]);
      expect(reg.resolveAlias("fast-model")).toBe("mock-fast-1");

      // Explicitly override 'fast-model' to point to mock-fast-2
      reg.registerAlias("fast-model", "mock-fast-2");
      expect(reg.resolveAlias("fast-model")).toBe("mock-fast-2");
      expect(reg.resolveModel("fast-model")?.id).toBe("mock-fast-2");

      // Unregister override returns to implicit cheapest
      reg.unregisterAlias("fast-model");
      expect(reg.resolveAlias("fast-model")).toBe("mock-fast-1");
    });

    it("hasAlias correctly identifies configured aliases", () => {
      expect(registry.hasAlias("smart-fast")).toBe(true);
      expect(registry.hasAlias("fast-model")).toBe(true);
      expect(registry.hasAlias("unknown-alias-xyz")).toBe(false);

      registry.registerAlias("custom-alias", "gpt-4o");
      expect(registry.hasAlias("custom-alias")).toBe(true);
    });

    it("resolveModelOrThrow throws UnknownModelAliasError for hyphenated aliases", () => {
      expect(() => registry.resolveModelOrThrow("turbo-mega-ultra")).toThrow(
        UnknownModelAliasError
      );
    });

    it("resolveModelOrThrow throws ModelNotFoundError for raw identifiers", () => {
      expect(() => registry.resolveModelOrThrow("nonexistentmodel")).toThrow(
        ModelNotFoundError
      );
    });

    it("getAliasesForModel returns all aliases associated with model", () => {
      const aliases = registry.getAliasesForModel("gemini-2.0-flash");
      expect(aliases).toContain("smart-fast");
      expect(aliases).toContain("fast-model");
      expect(aliases).toContain("fast");
    });

    it("getAliasMap returns a consolidated mapping of all active aliases", () => {
      const aliasMap = registry.getAliasMap(true);
      expect(aliasMap.has("smart-fast")).toBe(true);
      expect(aliasMap.get("smart-fast")).toBe("gemini-2.0-flash");
      expect(aliasMap.has("smart-model")).toBe(true);
    });
  });

  describe("Context Window Tracking & Token Limits (tc-05)", () => {
    it("retrieves context window and max output tokens for models and aliases", () => {
      expect(registry.getContextWindow("gemini-2.0-flash")).toBe(1_048_576);
      expect(registry.getContextWindow("smart-fast")).toBe(1_048_576);
      expect(registry.getMaxOutputTokens("gpt-4o")).toBe(16384);
    });

    it("fitsContextWindow evaluates token fits accurately", () => {
      // Gemini 2.0 Flash context window: 1_048_576
      expect(registry.fitsContextWindow("gemini-2.0-flash", 100_000)).toBe(true);
      expect(registry.fitsContextWindow("gemini-2.0-flash", 1_048_576)).toBe(true);
      expect(registry.fitsContextWindow("gemini-2.0-flash", 1_048_577)).toBe(false);

      // DeepSeek context window: 64_000
      expect(registry.fitsContextWindow("deepseek-chat", 50_000)).toBe(true);
      expect(registry.fitsContextWindow("deepseek-chat", 65_000)).toBe(false);
      expect(registry.fitsContextWindow("deepseek-chat", 50_000, 20_000)).toBe(false); // 50k + 20k > 64k
    });

    it("getRemainingContextWindow returns remaining capacity", () => {
      const remaining = registry.getRemainingContextWindow("deepseek-chat", 14_000);
      expect(remaining).toBe(50_000);

      const overflowRemaining = registry.getRemainingContextWindow("deepseek-chat", 70_000);
      expect(overflowRemaining).toBe(0);
    });

    it("validateTokenLimits reports comprehensive limits assessment", () => {
      // Valid request
      const validRes = registry.validateTokenLimits("gpt-4o", {
        promptTokens: 10_000,
        maxOutputTokens: 4096,
      });
      expect(validRes.valid).toBe(true);
      expect(validRes.contextWindow).toBe(128_000);
      expect(validRes.maxOutputTokens).toBe(16384);
      expect(validRes.totalEstimatedTokens).toBe(14_096);
      expect(validRes.remainingTokens).toBe(118_000);
      expect(validRes.errorReason).toBeUndefined();

      // Exceeds context window
      const overflowPromptRes = registry.validateTokenLimits("gpt-4o", {
        promptTokens: 130_000,
      });
      expect(overflowPromptRes.valid).toBe(false);
      expect(overflowPromptRes.errorReason).toContain("exceed model 'gpt-4o' context window");

      // Exceeds max output limit
      const overflowOutputRes = registry.validateTokenLimits("gpt-4o", {
        promptTokens: 10_000,
        maxOutputTokens: 20_000, // max is 16384
      });
      expect(overflowOutputRes.valid).toBe(false);
      expect(overflowOutputRes.errorReason).toContain("maximum output limit");
    });

    it("assertWithinContextWindow throws ContextWindowExceededError (HTTP 400) on overflow (tc-05)", () => {
      // Should not throw when valid
      expect(() =>
        registry.assertWithinContextWindow("gemini-2.0-flash", 10_000)
      ).not.toThrow();

      // Should throw ContextWindowExceededError when prompt exceeds limit
      let caughtError: unknown;
      try {
        registry.assertWithinContextWindow("deepseek-chat", 100_000); // 100k > 64k
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError instanceof ContextWindowExceededError).toBe(true);
      expect(isContextWindowExceededError(caughtError)).toBe(true);

      const windowError = caughtError as ContextWindowExceededError;
      expect(windowError.statusCode).toBe(400);
      expect(windowError.code).toBe("CONTEXT_WINDOW_EXCEEDED");
      expect(windowError.modelId).toBe("deepseek-chat");
      expect(windowError.contextWindow).toBe(64_000);
      expect(windowError.requestedTokens).toBe(100_000);

      // Verify toResponse serializes with HTTP 400
      const res = windowError.toResponse();
      expect(res.status).toBe(400);
    });
  });

  describe("Fixed-Point Microdollar Pricing Math (tc-09)", () => {
    it("calculates exact cost matching tc-09 golden test case", () => {
      // tc-09 specification:
      // input_cost: 150_000 microdollars (bash.15/1M)
      // output_cost: 600_000 microdollars (bash.60/1M)
      // prompt_tokens: 1000
      // completion_tokens: 500
      // expected: (1000 * 150_000 / 1_000_000) + (500 * 600_000 / 1_000_000) = 150 + 300 = 450 microdollars
      const testModel: ModelDef<bigint> = {
        id: "tc-09-model",
        provider: "openai",
        logicalAliases: ["tc-09"],
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        inputCostPerMTokMicro: 150_000n,
        outputCostPerMTokMicro: 600_000n,
        cacheReadCostPerMTokMicro: 0n,
        supportsTools: true,
        supportsVision: false,
        supportsJsonSchema: true,
        isActive: true,
      };

      const reg = new ModelRegistry([testModel]);
      const cost = reg.calculateCost("tc-09-model", {
        promptTokens: 1000,
        completionTokens: 500,
      });

      expect(cost).toBe(450n);
    });

    it("calculates cost with cached tokens and reasoning tokens", () => {
      // prompt: 2000 tokens @ 1_000_000 µ$/1M = 2 µ$
      // cached: 5000 tokens @ 200_000 µ$/1M = 1 µ$
      // completion: 1000 tokens @ 3_000_000 µ$/1M = 3 µ$
      // reasoning: 1000 tokens @ 3_000_000 µ$/1M = 3 µ$
      // total expected = 2 + 1 + 3 + 3 = 9 µ$
      const model: ModelDef<bigint> = {
        id: "reasoning-cache-model",
        provider: "google",
        logicalAliases: ["rc-model"],
        contextWindow: 100_000,
        maxOutputTokens: 8192,
        inputCostPerMTokMicro: 1_000_000n,
        outputCostPerMTokMicro: 3_000_000n,
        cacheReadCostPerMTokMicro: 200_000n,
        supportsTools: true,
        supportsVision: true,
        supportsJsonSchema: true,
        isActive: true,
      };

      const reg = new ModelRegistry([model]);
      const cost = reg.calculateCost("reasoning-cache-model", {
        promptTokens: 2000,
        completionTokens: 1000,
        cachedTokens: 5000,
        reasoningTokens: 1000,
      });

      expect(cost).toBe(9000n);
    });

    it("returns detailed cost breakdown with identical sum", () => {
      const usage: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        cachedTokens: 2000,
        reasoningTokens: 300,
      };

      const breakdown = registry.calculateCostBreakdown("gemini-2.0-flash", usage);
      const directCost = registry.calculateCost("gemini-2.0-flash", usage);

      expect(breakdown.totalCostMicrodollars).toBe(directCost);
      expect(
        breakdown.promptCostMicrodollars +
          breakdown.completionCostMicrodollars +
          breakdown.reasoningCostMicrodollars +
          breakdown.cacheReadCostMicrodollars
      ).toBe(breakdown.totalCostMicrodollars);
    });

    it("handles zero tokens without errors", () => {
      const cost = registry.calculateCost("gemini-2.0-flash", {
        promptTokens: 0,
        completionTokens: 0,
      });
      expect(cost).toBe(0n);
    });

    it("enforces zero floating-point math on integer division truncations", () => {
      // 1 token @ 150_000 µ$/1M: 1 * 150_000 / 1_000_000 = 0 (truncated integer division)
      const cost = ModelRegistry.calculateTokenCost(1, 150_000n);
      expect(cost).toBe(0n);

      // 7 tokens @ 150_000 µ$/1M: 7 * 150_000 = 1_050_000 / 1_000_000 = 1 µ$
      const cost7 = ModelRegistry.calculateTokenCost(7, 150_000n);
      expect(cost7).toBe(1n);
    });

    it("calculates pre-flight estimated cost", () => {
      const estimated = registry.calculateEstimatedCost("gpt-4o-mini", 10_000, 2_000);
      // prompt: 10_000 * 150_000 / 1_000_000 = 1500 µ$ (bash.0015)
      // completion: 2_000 * 600_000 / 1_000_000 = 1200 µ$ (bash.0012)
      // total = 2700 µ$
      expect(estimated).toBe(2700n);
    });

    it("getPricing returns correct pricing structure", () => {
      const pricing = registry.getPricing("gemini-2.0-flash");
      expect(pricing.inputCostPerMTokMicro).toBe(100_000n);
      expect(pricing.outputCostPerMTokMicro).toBe(400_000n);
      expect(pricing.cacheReadCostPerMTokMicro).toBe(25_000n);
    });

    it("static financial conversion helpers work accurately", () => {
      expect(ModelRegistry.dollarsToMicrodollars("1.25")).toBe(1_250_000n);
      expect(ModelRegistry.microdollarsToDollars(1_250_000n)).toBe(1.25);
      expect(ModelRegistry.formatMicrodollars(1_250_000n)).toBe("$1.25");
      expect(ModelRegistry.formatMicrodollars(1_500_000n)).toBe("$1.50");
    });
  });

  describe("Candidate Filtering & Cost-Optimal Selection", () => {
    it("findCandidates filters by provider and sorts by cost ascending", () => {
      const googleCandidates = registry.findCandidates({ provider: "google" });
      expect(googleCandidates.length).toBeGreaterThanOrEqual(2);

      // Verify sorted by input cost ascending
      for (let i = 0; i < googleCandidates.length - 1; i++) {
        expect(
          googleCandidates[i].inputCostPerMTokMicro <=
            googleCandidates[i + 1].inputCostPerMTokMicro
        ).toBe(true);
      }
    });

    it("findCandidates filters by capabilities (tools, vision, jsonSchema)", () => {
      const visionCandidates = registry.findCandidates({ supportsVision: true });
      for (const m of visionCandidates) {
        expect(m.supportsVision).toBe(true);
      }

      // Claude 3.5 Haiku lacks vision, should not be included
      expect(visionCandidates.some((m) => m.id === "claude-3-5-haiku")).toBe(false);
    });

    it("findCandidates filters by minimum context window", () => {
      const hugeContextCandidates = registry.findCandidates({
        minContextWindow: 500_000,
      });

      for (const m of hugeContextCandidates) {
        expect(m.contextWindow).toBeGreaterThanOrEqual(500_000);
      }
      expect(hugeContextCandidates.some((m) => m.id === "gpt-4o")).toBe(false); // 128k < 500k
    });

    it("findCandidates filters by max cost", () => {
      const cheapCandidates = registry.findCandidates({
        maxCostPerMTokMicro: 200_000n, // bash.20/1M or less
      });

      for (const m of cheapCandidates) {
        expect(m.inputCostPerMTokMicro <= 200_000n).toBe(true);
      }
      expect(cheapCandidates.some((m) => m.id === "gpt-4o")).toBe(false); // .50 > bash.20
    });

    it("getCheapestModel returns model with lowest input cost", () => {
      const candidates = registry.findCandidates({ provider: "google" });
      const cheapest = registry.getCheapestModel(candidates);
      expect(cheapest?.id).toBe("gemini-2.0-flash");
    });

    it("compareByCost provides a stable comparator", () => {
      const cheap = registry.getModelOrThrow("gemini-2.0-flash");
      const expensive = registry.getModelOrThrow("gpt-4o");

      expect(registry.compareByCost(cheap, expensive)).toBe(-1);
      expect(registry.compareByCost(expensive, cheap)).toBe(1);
      expect(registry.compareByCost(cheap, cheap)).toBe(0);
    });
  });
});
