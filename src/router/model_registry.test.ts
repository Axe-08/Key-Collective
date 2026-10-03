/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: ModelRegistry (router-model-registry)
 *
 * Invariants & Standards:
 * - Fixed-Point CreditUnits: All pricing and cost calculations in int64 / bigint credit units.
 * - Zero floating-point math for financials.
 * - Logical alias lookup: handles direct models, implicit aliases, explicit overrides, and cost-optimal ties.
 * - Context window tracking: enforces context boundaries, token limits, and HTTP 400 error triggers (tc-05).
 * - Exact golden cost assertions (tc-06, tc-09).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ModelRegistry,
  DEFAULT_MODEL_DEFINITIONS,
  cuWeight,
  ALL_MODEL_DEFINITIONS,
  ContextWindowExceededError,
  isContextWindowExceededError,
  TokenUsage,
} from "./registry/index";
import { ModelDef, createModelDef } from "../types/models";
import {
  ModelNotFoundError,
  UnknownModelAliasError,
} from "../errors";

describe("ModelRegistry", () => {
  let registry: ModelRegistry;

  const customModel1: ModelDef = {
    id: "mock-fast-1",
    provider: "google",
    logicalAliases: ["fast-model", "smart-fast"],
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    cuBase: 15n,
    cuInPer1k: 1n,
    cuCachedPer1k: 0n,
    cuOutPer1k: 1n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    isActive: true,
  };

  const customModel2: ModelDef = {
    id: "mock-fast-2",
    provider: "openai",
    logicalAliases: ["fast-model"],
    contextWindow: 64_000,
    maxOutputTokens: 2048,
    cuBase: 30n,
    cuInPer1k: 1n,
    cuCachedPer1k: 0n,
    cuOutPer1k: 1n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    isActive: true,
  };

  const customModel3Inactive: ModelDef = {
    id: "mock-inactive",
    provider: "anthropic",
    logicalAliases: ["retired-model", "fast-model"],
    contextWindow: 100_000,
    maxOutputTokens: 4096,
    cuBase: 5n,
    cuInPer1k: 1n,
    cuCachedPer1k: 0n,
    cuOutPer1k: 1n,
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
      expect(registry.hasModel("gemini-3.5-flash")).toBe(true);
      expect(registry.hasModel("gemini-3.1-pro-preview")).toBe(true);
      expect(registry.hasModel("openai/gpt-oss-120b")).toBe(true);
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

    it("stores CU weights as bigint credit units", () => {
      const numberModel: ModelDef = {
        id: "number-model",
        provider: "google",
        logicalAliases: ["num-alias"],
        contextWindow: 32000,
        maxOutputTokens: 4096,
        cuBase: 50n,
        cuInPer1k: 1n,
        cuCachedPer1k: 0n,
        cuOutPer1k: 1n,
        supportsTools: true,
        supportsVision: false,
        supportsJsonSchema: true,
        isActive: true,
      };

      const numReg = new ModelRegistry([numberModel]);
      const stored = numReg.getModel("number-model");
      expect(stored).toBeDefined();
      expect(typeof stored?.cuBase).toBe("bigint");
      expect(stored?.cuBase).toBe(50n);
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
      expect(registry.getModelOrThrow("gemini-3.5-flash").id).toBe("gemini-3.5-flash");
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

      const groqModels = registry.getModelsByProvider("groq");
      expect(groqModels.some((m) => m.id === "openai/gpt-oss-120b")).toBe(true);
    });
  });

  describe("Logical Alias Resolution", () => {
    it("resolves canonical model ID directly (case-insensitive)", () => {
      const resolved = registry.resolveModel("gemini-3.5-flash");
      expect(resolved?.id).toBe("gemini-3.5-flash");

      const resolvedUpper = registry.resolveModel("GEMINI-3.5-FLASH");
      expect(resolvedUpper?.id).toBe("gemini-3.5-flash");
    });

    it("resolves logical aliases to canonical models (tc-06)", () => {
      // 'smart-fast' maps to 'gemini-3.8-flash' (first link of its chain)
      const resolved = registry.resolveModel("smart-fast");
      expect(resolved).toBeDefined();
      expect(resolved?.id).toBe("gemini-3.8-flash");
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
      expect(registry.hasAlias("fast")).toBe(true);
      expect(registry.hasAlias("fast-model")).toBe(false);
      expect(registry.hasAlias("unknown-alias-xyz")).toBe(false);

      registry.registerAlias("custom-alias", "gemini-3.1-pro-preview");
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
      expect(registry.getAliasesForModel("gemini-3.8-flash")).toContain("smart-fast");
      expect(registry.getAliasesForModel("gemini-3.5-flash-lite")).toContain("fast");
    });

    it("getAliasMap returns a consolidated mapping of all active aliases", () => {
      const aliasMap = registry.getAliasMap(true);
      expect(aliasMap.has("smart-fast")).toBe(true);
      expect(aliasMap.get("smart-fast")).toBe("gemini-3.8-flash");
      expect(aliasMap.get("coder-high")).toBe("gemini-3.1-pro-preview");
      expect(aliasMap.get("open-groq")).toBe("openai/gpt-oss-120b");
      expect(aliasMap.get("fast")).toBe("gemini-3.5-flash-lite");
    });

    it("resolves every alias (auto, smart-fast, coder-high, open-groq, fast) against the full catalog", () => {
      const fullRegistry = new ModelRegistry([...ALL_MODEL_DEFINITIONS]);

      for (const alias of ["auto", "smart-fast", "coder-high", "open-groq", "fast"]) {
        const resolved = fullRegistry.resolveModel(alias);
        expect(resolved, `alias '${alias}' should resolve to a catalog model`).toBeDefined();
        expect(
          ALL_MODEL_DEFINITIONS.some((m) => m.id === resolved?.id)
        ).toBe(true);
      }
    });
  });

  describe("Context Window Tracking & Token Limits (tc-05)", () => {
    it("retrieves context window and max output tokens for models and aliases", () => {
      expect(registry.getContextWindow("gemini-3.5-flash")).toBe(1_048_576);
      expect(registry.getContextWindow("smart-fast")).toBe(1_048_576);
      expect(registry.getMaxOutputTokens("gemini-3.1-pro-preview")).toBe(65_536);
    });

    it("fitsContextWindow evaluates token fits accurately", () => {
      // Gemini 3.5 Flash context window: 1_048_576
      expect(registry.fitsContextWindow("gemini-3.5-flash", 100_000)).toBe(true);
      expect(registry.fitsContextWindow("gemini-3.5-flash", 1_048_576)).toBe(true);
      expect(registry.fitsContextWindow("gemini-3.5-flash", 1_048_577)).toBe(false);

      // gpt-oss-120b context window: 131_072
      expect(registry.fitsContextWindow("openai/gpt-oss-120b", 100_000)).toBe(true);
      expect(registry.fitsContextWindow("openai/gpt-oss-120b", 131_073)).toBe(false);
      expect(registry.fitsContextWindow("openai/gpt-oss-120b", 100_000, 32_000)).toBe(false); // 132k > 131,072
    });

    it("getRemainingContextWindow returns remaining capacity", () => {
      const remaining = registry.getRemainingContextWindow("openai/gpt-oss-120b", 31_072);
      expect(remaining).toBe(100_000);

      const overflowRemaining = registry.getRemainingContextWindow("openai/gpt-oss-120b", 140_000);
      expect(overflowRemaining).toBe(0);
    });

    it("validateTokenLimits reports comprehensive limits assessment", () => {
      // Valid request
      const validRes = registry.validateTokenLimits("openai/gpt-oss-120b", {
        promptTokens: 10_000,
        maxOutputTokens: 4096,
      });
      expect(validRes.valid).toBe(true);
      expect(validRes.contextWindow).toBe(131_072);
      expect(validRes.maxOutputTokens).toBe(65_536);
      expect(validRes.totalEstimatedTokens).toBe(14_096);
      expect(validRes.remainingTokens).toBe(121_072);
      expect(validRes.errorReason).toBeUndefined();

      // Exceeds context window
      const overflowPromptRes = registry.validateTokenLimits("openai/gpt-oss-120b", {
        promptTokens: 140_000,
      });
      expect(overflowPromptRes.valid).toBe(false);
      expect(overflowPromptRes.errorReason).toContain("exceed model 'openai/gpt-oss-120b' context window");

      // Exceeds max output limit
      const overflowOutputRes = registry.validateTokenLimits("openai/gpt-oss-120b", {
        promptTokens: 10_000,
        maxOutputTokens: 70_000, // max is 65,536
      });
      expect(overflowOutputRes.valid).toBe(false);
      expect(overflowOutputRes.errorReason).toContain("maximum output limit");
    });

    it("assertWithinContextWindow throws ContextWindowExceededError (HTTP 400) on overflow (tc-05)", () => {
      // Should not throw when valid
      expect(() =>
        registry.assertWithinContextWindow("gemini-3.5-flash", 10_000)
      ).not.toThrow();

      // Should throw ContextWindowExceededError when prompt exceeds limit
      let caughtError: unknown;
      try {
        registry.assertWithinContextWindow("openai/gpt-oss-120b", 150_000); // 150k > 131,072
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError instanceof ContextWindowExceededError).toBe(true);
      expect(isContextWindowExceededError(caughtError)).toBe(true);

      const windowError = caughtError as ContextWindowExceededError;
      expect(windowError.statusCode).toBe(400);
      expect(windowError.code).toBe("CONTEXT_WINDOW_EXCEEDED");
      expect(windowError.modelId).toBe("openai/gpt-oss-120b");
      expect(windowError.contextWindow).toBe(131_072);
      expect(windowError.requestedTokens).toBe(150_000);

      // Verify toResponse serializes with HTTP 400
      const res = windowError.toResponse();
      expect(res.status).toBe(400);
    });
  });

  describe("Model Pricing", () => {
    it("getPricing returns correct pricing structure", () => {
      const pricing = registry.getPricing("gemini-3.5-flash");
      expect(pricing.cuBase).toBe(10n);
      expect(pricing.cuInPer1k).toBe(1n);
      expect(pricing.cuCachedPer1k).toBe(0n);
      expect(pricing.cuOutPer1k).toBe(4n);
    });
  });

  describe("Candidate Filtering & Cost-Optimal Selection", () => {
    it("findCandidates filters by provider and sorts by cost ascending", () => {
      const googleCandidates = registry.findCandidates({ provider: "google" });
      expect(googleCandidates.length).toBeGreaterThanOrEqual(2);

      // Verify sorted by CU weight ascending
      for (let i = 0; i < googleCandidates.length - 1; i++) {
        expect(cuWeight(googleCandidates[i]) <= cuWeight(googleCandidates[i + 1])).toBe(true);
      }
    });

    it("findCandidates filters by capabilities (tools, vision, jsonSchema)", () => {
      const visionCandidates = registry.findCandidates({ supportsVision: true });
      for (const m of visionCandidates) {
        expect(m.supportsVision).toBe(true);
      }

      // Llama 3.3 70B lacks vision, should not be included
      expect(visionCandidates.some((m) => m.id === "openai/gpt-oss-120b")).toBe(false);
    });

    it("findCandidates filters by minimum context window", () => {
      const hugeContextCandidates = registry.findCandidates({
        minContextWindow: 500_000,
      });

      for (const m of hugeContextCandidates) {
        expect(m.contextWindow).toBeGreaterThanOrEqual(500_000);
      }
      expect(hugeContextCandidates.some((m) => m.id === "openai/gpt-oss-120b")).toBe(false); // 128k < 500k
    });

    it("findCandidates filters by max cost", () => {
      const cheapCandidates = registry.findCandidates({
        maxCuWeight: 20n,
      });

      for (const m of cheapCandidates) {
        expect(cuWeight(m) <= 20n).toBe(true);
      }
      expect(cheapCandidates.some((m) => m.id === "gemini-3.1-pro-preview")).toBe(false); // 75 > 20
    });

    it("getCheapestModel returns the model with the lowest CU weight", () => {
      const candidates = registry.findCandidates({ provider: "google" });
      const cheapest = registry.getCheapestModel(candidates);
      expect(cheapest?.id).toBe("gemini-3.5-flash-lite");
    });

    it("compareByCost provides a stable comparator", () => {
      const cheap = registry.getModelOrThrow("gemini-3.5-flash");
      const expensive = registry.getModelOrThrow("gemini-3.1-pro-preview");

      expect(registry.compareByCost(cheap, expensive)).toBe(-1);
      expect(registry.compareByCost(expensive, cheap)).toBe(1);
      expect(registry.compareByCost(cheap, cheap)).toBe(0);
    });
  });
});
