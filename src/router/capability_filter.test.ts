/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: CapabilityFilter (router-capability-filter)
 *
 * Invariants & Standards:
 * - TypeScript (strict mode, no `any`).
 * - Fixed-Point Microdollars: zero floating-point math.
 * - Conforms to LLD 2.2:
 *   - Evaluates candidates based on context length needed.
 *   - Filters based on required capabilities (tools, vision, JSON schema).
 *   - Returns sorted viable candidates (cost-optimal).
 * - Conforms to Golden Test tc-07:
 *   - Requests with tools parameter filter out text-only models.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  CapabilityFilter,
  CapabilityRequirements,
  isCapabilityRequirements,
} from "./capability_filter";
import {
  ModelRegistry,
  DEFAULT_MODEL_DEFINITIONS,
} from "./model_registry";
import { ModelDef } from "../types/models";
import { CapabilityMismatchError } from "../errors/routing_errors";

describe("CapabilityFilter", () => {
  // Test Models
  const textOnlyCheapModel: ModelDef<bigint> = {
    id: "cheap-text-model",
    provider: "openai",
    logicalAliases: ["economy-text"],
    contextWindow: 32_000,
    maxOutputTokens: 4096,
    inputCostPerMTokMicro: 50_000n, // cheapest
    outputCostPerMTokMicro: 150_000n,
    cacheReadCostPerMTokMicro: 10_000n,
    supportsTools: false,
    supportsVision: false,
    supportsJsonSchema: false,
    isActive: true,
  };

  const toolsOnlyModel: ModelDef<bigint> = {
    id: "tools-text-model",
    provider: "deepseek",
    logicalAliases: ["fast-tools"],
    contextWindow: 64_000,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 140_000n,
    outputCostPerMTokMicro: 280_000n,
    cacheReadCostPerMTokMicro: 14_000n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    isActive: true,
  };

  const multimodalFlashModel: ModelDef<bigint> = {
    id: "multimodal-flash",
    provider: "google",
    logicalAliases: ["smart-fast", "fast-vision"],
    contextWindow: 1_000_000,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 100_000n,
    outputCostPerMTokMicro: 400_000n,
    cacheReadCostPerMTokMicro: 25_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    isActive: true,
  };

  const expensiveFlagshipModel: ModelDef<bigint> = {
    id: "flagship-omni",
    provider: "openai",
    logicalAliases: ["smart-model"],
    contextWindow: 128_000,
    maxOutputTokens: 16384,
    inputCostPerMTokMicro: 2_500_000n,
    outputCostPerMTokMicro: 10_000_000n,
    cacheReadCostPerMTokMicro: 1_250_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    isActive: true,
  };

  const inactiveCapableModel: ModelDef<bigint> = {
    id: "retired-omni",
    provider: "anthropic",
    logicalAliases: ["legacy-claude"],
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 80_000n,
    outputCostPerMTokMicro: 300_000n,
    cacheReadCostPerMTokMicro: 20_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    isActive: false, // Disabled
  };

  const testCandidateSet: ModelDef<bigint>[] = [
    textOnlyCheapModel,
    toolsOnlyModel,
    multimodalFlashModel,
    expensiveFlagshipModel,
    inactiveCapableModel,
  ];

  let filter: CapabilityFilter;

  beforeEach(() => {
    filter = new CapabilityFilter();
  });

  // =========================================================================
  // Capability Validation (isCapable / checkCapabilities)
  // =========================================================================

  describe("Capability Validation (isCapable & checkCapabilities)", () => {
    it("satisfies empty requirements for active models", () => {
      expect(filter.isCapable(textOnlyCheapModel, {})).toBe(true);
      expect(filter.isCapable(multimodalFlashModel, {})).toBe(true);
    });

    it("rejects inactive models when onlyActive is true (default)", () => {
      expect(filter.isCapable(inactiveCapableModel, {})).toBe(false);
      expect(filter.isCapable(inactiveCapableModel, { onlyActive: false })).toBe(true);

      const check = filter.checkCapabilities(inactiveCapableModel, {});
      expect(check.isCapable).toBe(false);
      expect(check.missingCapabilities).toContain("active");
    });

    it("validates tool calling requirement (tc-07)", () => {
      const requirements: CapabilityRequirements = { requiresTools: true };

      expect(filter.isCapable(textOnlyCheapModel, requirements)).toBe(false);
      expect(filter.isCapable(toolsOnlyModel, requirements)).toBe(true);
      expect(filter.isCapable(multimodalFlashModel, requirements)).toBe(true);

      const failedCheck = filter.checkCapabilities(textOnlyCheapModel, requirements);
      expect(failedCheck.isCapable).toBe(false);
      expect(failedCheck.missingCapabilities).toContain("tools");
    });

    it("validates multimodal vision requirement", () => {
      const requirements: CapabilityRequirements = { requiresVision: true };

      expect(filter.isCapable(textOnlyCheapModel, requirements)).toBe(false);
      expect(filter.isCapable(toolsOnlyModel, requirements)).toBe(false);
      expect(filter.isCapable(multimodalFlashModel, requirements)).toBe(true);
      expect(filter.isCapable(expensiveFlagshipModel, requirements)).toBe(true);

      const failedCheck = filter.checkCapabilities(toolsOnlyModel, requirements);
      expect(failedCheck.isCapable).toBe(false);
      expect(failedCheck.missingCapabilities).toContain("vision");
    });

    it("validates structured output / JSON schema requirement", () => {
      const requirements: CapabilityRequirements = { requiresJsonSchema: true };

      expect(filter.isCapable(textOnlyCheapModel, requirements)).toBe(false);
      expect(filter.isCapable(toolsOnlyModel, requirements)).toBe(true);
      expect(filter.isCapable(multimodalFlashModel, requirements)).toBe(true);

      const failedCheck = filter.checkCapabilities(textOnlyCheapModel, requirements);
      expect(failedCheck.isCapable).toBe(false);
      expect(failedCheck.missingCapabilities).toContain("json_schema");
    });

    it("validates context length requirement", () => {
      // 50,000 tokens exceeds textOnlyCheapModel (32k), but fits toolsOnlyModel (64k)
      expect(filter.isCapable(textOnlyCheapModel, { minContextLength: 50_000 })).toBe(false);
      expect(filter.isCapable(toolsOnlyModel, { minContextLength: 50_000 })).toBe(true);

      // Exact boundary tests
      expect(filter.isCapable(toolsOnlyModel, { minContextLength: 64_000 })).toBe(true);
      expect(filter.isCapable(toolsOnlyModel, { minContextLength: 64_001 })).toBe(false);

      // 500,000 tokens only fits multimodalFlashModel (1M)
      expect(filter.isCapable(toolsOnlyModel, { minContextLength: 500_000 })).toBe(false);
      expect(filter.isCapable(expensiveFlagshipModel, { minContextLength: 500_000 })).toBe(false);
      expect(filter.isCapable(multimodalFlashModel, { minContextLength: 500_000 })).toBe(true);

      const failedCheck = filter.checkCapabilities(expensiveFlagshipModel, { minContextLength: 200_000 });
      expect(failedCheck.isCapable).toBe(false);
      expect(failedCheck.missingCapabilities).toContain("context_length");
    });

    it("validates max output tokens limit", () => {
      expect(filter.isCapable(textOnlyCheapModel, { maxOutputTokens: 4096 })).toBe(true);
      expect(filter.isCapable(textOnlyCheapModel, { maxOutputTokens: 8192 })).toBe(false);
      expect(filter.isCapable(expensiveFlagshipModel, { maxOutputTokens: 16384 })).toBe(true);
    });

    it("validates provider filter case-insensitively", () => {
      expect(filter.isCapable(multimodalFlashModel, { provider: "google" })).toBe(true);
      expect(filter.isCapable(multimodalFlashModel, { provider: "Google" })).toBe(true);
      expect(filter.isCapable(multimodalFlashModel, { provider: "openai" })).toBe(false);
    });

    it("validates maximum cost ceiling in microdollars", () => {
      // flash input is 100,000 µ$; flagship is 2,500,000 µ$
      expect(filter.isCapable(multimodalFlashModel, { maxCostPerMTokMicro: 150_000n })).toBe(true);
      expect(filter.isCapable(expensiveFlagshipModel, { maxCostPerMTokMicro: 150_000n })).toBe(false);
      expect(filter.isCapable(expensiveFlagshipModel, { maxCostPerMTokMicro: 3_000_000n })).toBe(true);
    });

    it("aggregates multiple missing capabilities in checkCapabilities result", () => {
      const result = filter.checkCapabilities(textOnlyCheapModel, {
        requiresTools: true,
        requiresVision: true,
        requiresJsonSchema: true,
        minContextLength: 100_000,
        provider: "google",
      });

      expect(result.isCapable).toBe(false);
      expect(result.missingCapabilities).toContain("tools");
      expect(result.missingCapabilities).toContain("vision");
      expect(result.missingCapabilities).toContain("json_schema");
      expect(result.missingCapabilities).toContain("context_length");
      expect(result.missingCapabilities).toContain("provider");
      expect(result.reasons.length).toBe(5);
    });
  });

  // =========================================================================
  // Filtering & Sorting Candidates
  // =========================================================================

  describe("Candidate Filtering & Cost-Optimal Sorting", () => {
    it("filters out unsupported models when tools are required (tc-07)", () => {
      const candidates = filter.filterCandidates(testCandidateSet, { requiresTools: true });

      // textOnlyCheapModel must be excluded
      expect(candidates.some((m) => m.id === "cheap-text-model")).toBe(false);
      // inactiveCapableModel must be excluded by default
      expect(candidates.some((m) => m.id === "retired-omni")).toBe(false);
      // viable models must be present
      expect(candidates.map((m) => m.id)).toEqual([
        "multimodal-flash",     // 100,000 µ$
        "tools-text-model",     // 140,000 µ$
        "flagship-omni",        // 2,500,000 µ$
      ]);
    });

    it("filters out text-only models when vision is required", () => {
      const candidates = filter.filterCandidates(testCandidateSet, { requiresVision: true });

      expect(candidates.map((m) => m.id)).toEqual([
        "multimodal-flash",
        "flagship-omni",
      ]);
    });

    it("filters by both vision and large context length", () => {
      const candidates = filter.filterCandidates(testCandidateSet, {
        requiresVision: true,
        minContextLength: 500_000,
      });

      expect(candidates.length).toBe(1);
      expect(candidates[0].id).toBe("multimodal-flash");
    });

    it("returns empty array if no candidates match and throwIfEmpty is false", () => {
      const candidates = filter.filterCandidates(testCandidateSet, {
        requiresVision: true,
        minContextLength: 2_000_000, // none has 2M
      });

      expect(candidates).toEqual([]);
    });

    it("throws CapabilityMismatchError if throwIfEmpty is true and no candidates match", () => {
      expect(() =>
        filter.filterCandidates(
          testCandidateSet,
          { requiresVision: true, minContextLength: 2_000_000 },
          { throwIfEmpty: true }
        )
      ).toThrow(CapabilityMismatchError);

      try {
        filter.filterCandidates(
          testCandidateSet,
          { requiresVision: true, minContextLength: 2_000_000 },
          { throwIfEmpty: true }
        );
      } catch (err) {
        expect(err).toBeInstanceOf(CapabilityMismatchError);
        const capErr = err as CapabilityMismatchError;
        expect(capErr.statusCode).toBe(400);
        expect(capErr.code).toBe("CAPABILITY_MISMATCH");
        expect(capErr.requiredCapabilities).toContain("vision");
        expect(capErr.requiredCapabilities).toContain("context_length>=2000000");
      }
    });

    it("supports filterCandidatesOrThrow convenience method", () => {
      expect(() =>
        filter.filterCandidatesOrThrow(testCandidateSet, {
          provider: "non-existent-provider",
        })
      ).toThrow(CapabilityMismatchError);
    });

    it("selects optimal (cheapest capable) candidate model", () => {
      const optimal = filter.selectOptimalCandidate(testCandidateSet, {
        requiresTools: true,
      });

      expect(optimal).toBeDefined();
      expect(optimal?.id).toBe("multimodal-flash"); // cheapest input cost among tools-capable (100k < 140k < 2500k)
    });

    it("respects sort strategy options", () => {
      const costDesc = filter.filterCandidates(
        testCandidateSet,
        { requiresTools: true },
        { sortBy: "cost-desc" }
      );
      expect(costDesc[0].id).toBe("flagship-omni");

      const contextDesc = filter.filterCandidates(
        testCandidateSet,
        { requiresTools: true },
        { sortBy: "context-desc" }
      );
      expect(contextDesc[0].id).toBe("multimodal-flash"); // 1M context
    });
  });

  // =========================================================================
  // Request Extraction
  // =========================================================================

  describe("Requirement Extraction from Request Payloads", () => {
    it("extracts tools requirement when 'tools' array is non-empty", () => {
      const req = {
        messages: [{ role: "user", content: "What is the weather?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              parameters: { type: "object" },
            },
          },
        ],
      };

      const extracted = filter.extractRequirements(req);
      expect(extracted.requiresTools).toBe(true);
      expect(extracted.requiresVision).toBe(false);
      expect(extracted.requiresJsonSchema).toBe(false);
    });

    it("extracts tools requirement when legacy 'functions' array is present", () => {
      const req = {
        messages: [{ role: "user", content: "Query DB" }],
        functions: [{ name: "query_db" }],
      };

      const extracted = filter.extractRequirements(req);
      expect(extracted.requiresTools).toBe(true);
    });

    it("does not require tools when tools array is empty", () => {
      const req = {
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
      };

      const extracted = filter.extractRequirements(req);
      expect(extracted.requiresTools).toBe(false);
    });

    it("extracts tools requirement when tool_choice is specified and not 'none'", () => {
      const reqAuto = {
        messages: [{ role: "user", content: "Hello" }],
        tool_choice: "auto",
      };
      expect(filter.extractRequirements(reqAuto).requiresTools).toBe(true);

      const reqObj = {
        messages: [{ role: "user", content: "Hello" }],
        tool_choice: { type: "function", function: { name: "test" } },
      };
      expect(filter.extractRequirements(reqObj).requiresTools).toBe(true);

      const reqNone = {
        messages: [{ role: "user", content: "Hello" }],
        tool_choice: "none",
      };
      expect(filter.extractRequirements(reqNone).requiresTools).toBe(false);
    });

    it("extracts vision requirement from multipart messages with image_url", () => {
      const req = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is in this image?" },
              {
                type: "image_url",
                image_url: { url: "https://example.com/cat.jpg" },
              },
            ],
          },
        ],
      };

      const extracted = filter.extractRequirements(req);
      expect(extracted.requiresVision).toBe(true);
      expect(extracted.requiresTools).toBe(false);
    });

    it("extracts vision requirement from Anthropic-style image parts", () => {
      const req = {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "iVBORw0KGgo...",
                },
              },
            ],
          },
        ],
      };

      const extracted = filter.extractRequirements(req);
      expect(extracted.requiresVision).toBe(true);
    });

    it("extracts vision requirement from inline data URI strings in content", () => {
      const req = {
        messages: [
          {
            role: "user",
            content: "Look at data:image/png;base64,iVBORw0KGgo...",
          },
        ],
      };

      const extracted = filter.extractRequirements(req);
      expect(extracted.requiresVision).toBe(true);
    });

    it("extracts vision requirement from top-level images array", () => {
      const req = {
        prompt: "Describe this",
        images: ["base64image..."],
      };

      const extracted = filter.extractRequirements(req);
      expect(extracted.requiresVision).toBe(true);
    });

    it("extracts JSON schema requirement from response_format object", () => {
      const reqJsonObject = {
        messages: [{ role: "user", content: "Output JSON" }],
        response_format: { type: "json_object" },
      };
      expect(filter.extractRequirements(reqJsonObject).requiresJsonSchema).toBe(true);

      const reqJsonSchema = {
        messages: [{ role: "user", content: "Output JSON Schema" }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "User", schema: {} },
        },
      };
      expect(filter.extractRequirements(reqJsonSchema).requiresJsonSchema).toBe(true);
    });

    it("extracts JSON schema requirement from string response_format or top-level json_schema", () => {
      expect(filter.extractRequirements({ response_format: "json_object" }).requiresJsonSchema).toBe(true);
      expect(filter.extractRequirements({ json_schema: {} }).requiresJsonSchema).toBe(true);
      expect(filter.extractRequirements({ output_schema: {} }).requiresJsonSchema).toBe(true);
    });

    it("extracts streaming requirement when stream: true", () => {
      const req = {
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      };
      expect(filter.extractRequirements(req).requiresStreaming).toBe(true);
    });

    it("estimates context length from messages and max_tokens", () => {
      const req = {
        messages: [
          { role: "user", content: "A".repeat(400) }, // ~100 tokens + framing
        ],
        max_tokens: 500,
      };

      const extracted = filter.extractRequirements(req);
      expect(extracted.maxOutputTokens).toBe(500);
      expect(extracted.minContextLength).toBeGreaterThanOrEqual(600);
    });

    it("supports explicit estimatedPromptTokens and buffer multiplier", () => {
      const req = {
        max_tokens: 1000,
      };

      const extracted = filter.extractRequirements(req, {
        estimatedPromptTokens: 2000,
        contextBufferMultiplier: 1.2,
      });

      // (2000 + 1000) * 1.2 = 3600
      expect(extracted.minContextLength).toBe(3600);
    });

    it("passes through pre-constructed CapabilityRequirements cleanly", () => {
      const preConstructed: CapabilityRequirements = {
        requiresTools: true,
        requiresVision: true,
        minContextLength: 100_000,
      };

      expect(isCapabilityRequirements(preConstructed)).toBe(true);
      const extracted = filter.extractRequirements(preConstructed);
      expect(extracted.requiresTools).toBe(true);
      expect(extracted.requiresVision).toBe(true);
      expect(extracted.minContextLength).toBe(100_000);
    });

    it("handles null, undefined, and non-object inputs safely", () => {
      expect(filter.extractRequirements(null).requiresTools).toBe(false);
      expect(filter.extractRequirements(undefined).requiresVision).toBe(false);
      expect(filter.extractRequirements("string").requiresJsonSchema).toBe(false);
      expect(filter.extractRequirements(12345).onlyActive).toBe(true);
    });
  });

  // =========================================================================
  // Token Estimation Helper
  // =========================================================================

  describe("Token Estimation Helper", () => {
    it("estimates tokens accurately for strings", () => {
      expect(CapabilityFilter.estimateTokens("")).toBe(0);
      expect(CapabilityFilter.estimateTokens("hello")).toBe(2); // ceil(5/4) = 2
      expect(CapabilityFilter.estimateTokens("a".repeat(100))).toBe(25);
    });

    it("estimates tokens for arrays of messages", () => {
      const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello world!" },
      ];

      const tokens = CapabilityFilter.estimateTokens(messages);
      expect(tokens).toBeGreaterThan(15);
    });

    it("allocates standard nominal token count for image parts (~800 tokens)", () => {
      const imagePart = {
        type: "image_url",
        image_url: { url: "https://example.com/test.png" },
      };

      expect(CapabilityFilter.estimateTokens(imagePart)).toBe(800);
    });

    it("handles unexpected objects and primitives gracefully", () => {
      expect(CapabilityFilter.estimateTokens(null)).toBe(0);
      expect(CapabilityFilter.estimateTokens(undefined)).toBe(0);
      expect(CapabilityFilter.estimateTokens(123)).toBe(1);
      expect(CapabilityFilter.estimateTokens(true)).toBe(1);
      expect(CapabilityFilter.estimateTokens({ custom: "data" })).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Integration with ModelRegistry & Default Catalog
  // =========================================================================

  describe("Integration with ModelRegistry & Default Catalog", () => {
    let registry: ModelRegistry;
    let registryFilter: CapabilityFilter;

    beforeEach(() => {
      registry = new ModelRegistry(); // Loads DEFAULT_MODEL_DEFINITIONS
      registryFilter = new CapabilityFilter(registry);
    });

    it("filters default registry models by tools requirement", () => {
      const candidates = registryFilter.filterRegistry({ requiresTools: true });
      // In default catalog, all models currently support tools
      expect(candidates.length).toBe(DEFAULT_MODEL_DEFINITIONS.length);
      expect(candidates.every((m) => m.supportsTools)).toBe(true);
    });

    it("filters default registry models by vision requirement", () => {
      // In default catalog:
      // claude-3-5-haiku, deepseek-chat, and llama-3.3-70b-versatile have supportsVision = false
      const visionCandidates = registryFilter.filterRegistry({ requiresVision: true });

      expect(visionCandidates.length).toBeGreaterThan(0);
      expect(visionCandidates.every((m) => m.supportsVision)).toBe(true);
      expect(visionCandidates.some((m) => m.id === "claude-3-5-haiku")).toBe(false);
      expect(visionCandidates.some((m) => m.id === "deepseek-chat")).toBe(false);
      expect(visionCandidates.some((m) => m.id === "llama-3.3-70b-versatile")).toBe(false);

      // Verify that gemini-2.0-flash, gpt-4o, etc. are included
      expect(visionCandidates.some((m) => m.id === "gemini-2.0-flash")).toBe(true);
      expect(visionCandidates.some((m) => m.id === "gpt-4o")).toBe(true);
    });

    it("orders viable default catalog models cost-optimally (cheapest first)", () => {
      const visionCandidates = registryFilter.filterRegistry({ requiresVision: true });

      // gemini-2.0-flash is 100,000 µ$, gpt-4o-mini is 150,000 µ$, etc.
      expect(visionCandidates[0].id).toBe("gemini-2.0-flash");
      expect(visionCandidates[1].id).toBe("gpt-4o-mini");
      expect(visionCandidates[0].inputCostPerMTokMicro).toBeLessThanOrEqual(
        visionCandidates[1].inputCostPerMTokMicro
      );
    });

    it("filters by large context window in default catalog", () => {
      // 1,500,000 tokens: only gemini-1.5-pro has 2M context window
      const largeContextCandidates = registryFilter.filterRegistry({
        minContextLength: 1_500_000,
      });

      expect(largeContextCandidates.length).toBe(1);
      expect(largeContextCandidates[0].id).toBe("gemini-1.5-pro");
    });

    it("supports universal filter() method with injected registry", () => {
      const requestWithVision = {
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: "test.png" } }],
          },
        ],
      };

      const candidates = registryFilter.filter(requestWithVision);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.every((m) => m.supportsVision)).toBe(true);
    });

    it("supports static methods without instantiating CapabilityFilter", () => {
      const isCap = CapabilityFilter.isCapable(multimodalFlashModel, { requiresVision: true });
      expect(isCap).toBe(true);

      const filtered = CapabilityFilter.filterCandidates(testCandidateSet, {
        requiresTools: true,
      });
      expect(filtered.length).toBe(3);

      const optimal = CapabilityFilter.selectOptimalCandidate(testCandidateSet, {
        requiresTools: true,
      });
      expect(optimal?.id).toBe("multimodal-flash");
    });
  });

  // =========================================================================
  // Golden Test Assertion: tc-07
  // =========================================================================

  describe("Golden Test tc-07: Capability Filter - Tools", () => {
    it("tc-07: request with tools parameter filters out unsupported text-only models", () => {
      // Given: Request includes 'tools' array in body
      const request = {
        model: "smart-model",
        messages: [{ role: "user", content: "Call function X" }],
        tools: [
          {
            type: "function",
            function: { name: "get_data", parameters: {} },
          },
        ],
      };

      // When: Router evaluates candidate models using CapabilityFilter
      const extractedRequirements = CapabilityFilter.extractRequirements(request);
      expect(extractedRequirements.requiresTools).toBe(true);

      const viableCandidates = CapabilityFilter.filterCandidates(
        testCandidateSet,
        extractedRequirements
      );

      // Then: Text-only models (supports_tools=false) are excluded from candidates
      expect(viableCandidates.some((m) => m.id === "cheap-text-model")).toBe(false);

      // Golden assertions:
      // router_decision.capability_filter_passed == true
      // model_def.supports_tools == true
      expect(viableCandidates.length).toBeGreaterThan(0);
      for (const candidate of viableCandidates) {
        expect(candidate.supportsTools).toBe(true);
        expect(filter.isCapable(candidate, extractedRequirements)).toBe(true);
      }
    });
  });
});
