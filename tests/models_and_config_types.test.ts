import { describe, it, expect } from "vitest";
import {
  KNOWN_MODEL_PROVIDERS,
  KNOWN_MODEL_ALIASES,
  KEY_STATUSES,
  ROUTING_STRATEGIES,
  FALLBACK_TRIGGERS,
  DEFAULT_KEY_ROUTING_CONFIG,
  DEFAULT_FALLBACK_CONFIG,
  DEFAULT_RATE_LIMIT_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  ModelProvider,
  ModelAlias,
  KeyStatus,
  ModelDef,
  APIKey,
  RouterDecision,
  CostLedgerEvent,
  RoutingStrategy,
  FallbackTrigger,
  KeyRoutingConfig,
  FallbackConfig,
  RateLimitConfig,
  CircuitBreakerConfig,
  TenantBudgetConfig,
  TenantConfig,
  createModelDef,
  createTenantConfig,
  isModelProvider,
  isKnownModelProvider,
  isModelAlias,
  isKnownModelAlias,
  isKeyStatus,
  isModelDef,
  isAPIKey,
  isRouterDecision,
  isRoutingStrategy,
  isFallbackTrigger,
  isCircuitBreakerConfig,
  isRateLimitConfig,
  isTenantConfig,
} from "../src/types";

describe("Model and Provider Types (LLD 2.2)", () => {
  describe("ModelProvider and ModelAlias", () => {
    it("exports known model providers including openai, anthropic, cohere, google, gemini, groq", () => {
      expect(KNOWN_MODEL_PROVIDERS).toContain("openai");
      expect(KNOWN_MODEL_PROVIDERS).toContain("anthropic");
      expect(KNOWN_MODEL_PROVIDERS).toContain("cohere");
      expect(KNOWN_MODEL_PROVIDERS).toContain("google");
      expect(KNOWN_MODEL_PROVIDERS).toContain("gemini");
      expect(KNOWN_MODEL_PROVIDERS).toContain("groq");
    });

    it("validates known model providers with isKnownModelProvider", () => {
      expect(isKnownModelProvider("openai")).toBe(true);
      expect(isKnownModelProvider("anthropic")).toBe(true);
      expect(isKnownModelProvider("cohere")).toBe(true);
      expect(isKnownModelProvider("unknown-provider")).toBe(false);
      expect(isKnownModelProvider(null)).toBe(false);
      expect(isKnownModelProvider(123)).toBe(false);
    });

    it("validates model providers with isModelProvider", () => {
      expect(isModelProvider("openai")).toBe(true);
      expect(isModelProvider("custom-private-llm")).toBe(true);
      expect(isModelProvider("")).toBe(false);
      expect(isModelProvider("   ")).toBe(false);
      expect(isModelProvider(null)).toBe(false);
      expect(isModelProvider(undefined)).toBe(false);
    });

    it("exports known model aliases including fast-model, smart-model, smart-fast", () => {
      expect(KNOWN_MODEL_ALIASES).toContain("fast-model");
      expect(KNOWN_MODEL_ALIASES).toContain("smart-model");
      expect(KNOWN_MODEL_ALIASES).toContain("smart-fast");
      expect(KNOWN_MODEL_ALIASES).toContain("fast");
    });

    it("validates known model aliases with isKnownModelAlias", () => {
      expect(isKnownModelAlias("fast-model")).toBe(true);
      expect(isKnownModelAlias("smart-model")).toBe(true);
      expect(isKnownModelAlias("smart-fast")).toBe(true);
      expect(isKnownModelAlias("arbitrary-alias")).toBe(false);
    });

    it("validates model aliases with isModelAlias", () => {
      const alias1: ModelAlias = "fast-model";
      const alias2: ModelAlias = "tenant-custom-alias";
      expect(isModelAlias(alias1)).toBe(true);
      expect(isModelAlias(alias2)).toBe(true);
      expect(isModelAlias("")).toBe(false);
      expect(isModelAlias(123)).toBe(false);
    });
  });

  describe("KeyStatus", () => {
    it("supports Healthy, RateLimited, Degraded, and Disabled key statuses", () => {
      expect(KEY_STATUSES).toContain("Healthy");
      expect(KEY_STATUSES).toContain("RateLimited");
      expect(KEY_STATUSES).toContain("Degraded");
      expect(KEY_STATUSES).toContain("Disabled");
    });

    it("validates key statuses with isKeyStatus", () => {
      expect(isKeyStatus("Healthy")).toBe(true);
      expect(isKeyStatus("RateLimited")).toBe(true);
      expect(isKeyStatus("rate_limited")).toBe(true);
      expect(isKeyStatus("Broken")).toBe(false);
      expect(isKeyStatus(null)).toBe(false);
    });
  });

  describe("ModelDef", () => {
    it("instantiates ModelDef with fixed-point microdollar pricing (BigInt)", () => {
      const model: ModelDef = {
        id: "gemini-2.0-flash",
        provider: "google",
        logicalAliases: ["fast-model", "smart-fast"],
        contextWindow: 1_048_576,
        maxOutputTokens: 8192,
        inputCostPerMTokMicro: 100_000n, // $0.10 per 1M input tokens
        outputCostPerMTokMicro: 400_000n, // $0.40 per 1M output tokens
        cacheReadCostPerMTokMicro: 25_000n, // $0.025 per 1M cached tokens
        supportsTools: true,
        supportsVision: true,
        supportsJsonSchema: true,
        isActive: true,
        lastSyncedAt: "2026-09-09T00:00:00.000Z",
      };

      expect(model.id).toBe("gemini-2.0-flash");
      expect(model.provider).toBe("google");
      expect(model.logicalAliases).toEqual(["fast-model", "smart-fast"]);
      expect(typeof model.inputCostPerMTokMicro).toBe("bigint");
      expect(model.inputCostPerMTokMicro).toBe(100_000n);
      expect(model.supportsTools).toBe(true);
      expect(model.isActive).toBe(true);
    });

    it("creates ModelDef via createModelDef factory with defaults", () => {
      const model = createModelDef({
        id: "gpt-4o",
        provider: "openai",
        logicalAliases: ["smart-model"],
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        inputCostPerMTokMicro: 2_500_000n, // $2.50 per 1M tokens
        outputCostPerMTokMicro: 10_000_000n, // $10.00 per 1M tokens
        supportsTools: true,
        supportsVision: true,
        supportsJsonSchema: true,
      });

      expect(model.isActive).toBe(true);
      expect(model.cacheReadCostPerMTokMicro).toBe(0n);
      expect(model.id).toBe("gpt-4o");
    });

    it("validates ModelDef with isModelDef type guard", () => {
      const valid = createModelDef({
        id: "claude-3-5-sonnet",
        provider: "anthropic",
        logicalAliases: ["smart-model"],
        contextWindow: 200_000,
        maxOutputTokens: 8192,
        inputCostPerMTokMicro: 3_000_000n,
        outputCostPerMTokMicro: 15_000_000n,
        supportsTools: true,
        supportsVision: true,
        supportsJsonSchema: true,
      });

      expect(isModelDef(valid)).toBe(true);
      expect(isModelDef(null)).toBe(false);
      expect(isModelDef({})).toBe(false);
      expect(isModelDef({ id: "missing-fields" })).toBe(false);
    });

    it("supports serialized number pricing when parameterized as ModelDef<number>", () => {
      const numericModel: ModelDef<number> = {
        id: "mistral-small",
        provider: "mistral",
        logicalAliases: ["fast"],
        contextWindow: 32_000,
        maxOutputTokens: 2048,
        inputCostPerMTokMicro: 200_000,
        outputCostPerMTokMicro: 600_000,
        cacheReadCostPerMTokMicro: 0,
        supportsTools: true,
        supportsVision: false,
        supportsJsonSchema: true,
        isActive: true,
      };

      expect(numericModel.inputCostPerMTokMicro).toBe(200_000);
      expect(isModelDef(numericModel)).toBe(true);
    });
  });

  describe("APIKey and AES-256-GCM Nonce Invariant", () => {
    it("models an encrypted API key with 12-byte nonce (b64) and masked prefix/suffix", () => {
      const key: APIKey = {
        id: "key-uuid-1",
        tenantId: "tenant-acme",
        label: "Production OpenAI Primary",
        provider: "openai",
        encryptedKeyB64: "YWJjZGVmZ2hpams=",
        nonceB64: "MTIzNDU2Nzg5MDEy", // 12-byte nonce
        keyPrefix: "sk-proj-abc",
        keySuffix: "XYZ1",
        rpmLimit: 500,
        rpdLimit: 10000,
        priority: 10,
        status: "Healthy",
        circuitOpenUntil: null,
        lastUsedAt: "2026-09-09T12:00:00Z",
        createdAt: "2026-09-01T00:00:00Z",
      };

      expect(key.tenantId).toBe("tenant-acme");
      expect(key.provider).toBe("openai");
      expect(key.status).toBe("Healthy");
      expect(key.nonceB64).toBe("MTIzNDU2Nzg5MDEy");
      expect(isAPIKey(key)).toBe(true);
    });

    it("rejects invalid APIKey structures with isAPIKey", () => {
      expect(isAPIKey(null)).toBe(false);
      expect(isAPIKey({})).toBe(false);
      expect(
        isAPIKey({
          id: "k1",
          tenantId: "t1",
          // missing required fields
        })
      ).toBe(false);
    });
  });

  describe("RouterDecision and CostLedgerEvent", () => {
    it("creates and validates RouterDecision", () => {
      const decision: RouterDecision = {
        selectedKeyId: "key-123",
        selectedModelId: "gemini-2.0-flash",
        tenantId: "tenant-99",
        capabilityFilterPassed: true,
        reason: "cost_optimal",
      };

      expect(decision.selectedModelId).toBe("gemini-2.0-flash");
      expect(isRouterDecision(decision)).toBe(true);
      expect(isRouterDecision(null)).toBe(false);
    });

    it("captures financial impact via CostLedgerEvent with BigInt microdollars", () => {
      const event: CostLedgerEvent = {
        id: "evt-001",
        requestId: "req-999",
        tenantId: "tenant-acme",
        keyId: "key-123",
        provider: "google",
        modelId: "gemini-2.0-flash",
        promptTokens: 1000,
        completionTokens: 500,
        cachedTokens: 200,
        reasoningTokens: 0,
        costMicrodollars: 450n, // exact microdollars
        latencyMs: 185,
        statusCode: 200,
        createdAt: "2026-09-09T21:00:00Z",
      };

      expect(event.costMicrodollars).toBe(450n);
      expect(event.promptTokens).toBe(1000);
      expect(event.cachedTokens).toBe(200);
    });
  });
});

describe("Configuration Types (LLD 2.3)", () => {
  describe("RoutingStrategy and FallbackTrigger", () => {
    it("defines valid routing strategies", () => {
      expect(ROUTING_STRATEGIES).toContain("cost-optimal");
      expect(ROUTING_STRATEGIES).toContain("lowest-latency");
      expect(ROUTING_STRATEGIES).toContain("priority");
      expect(ROUTING_STRATEGIES).toContain("round-robin");
      expect(ROUTING_STRATEGIES).toContain("cascade");
    });

    it("validates routing strategies with isRoutingStrategy", () => {
      expect(isRoutingStrategy("cost-optimal")).toBe(true);
      expect(isRoutingStrategy("lowest-latency")).toBe(true);
      expect(isRoutingStrategy("invalid-strategy")).toBe(false);
      expect(isRoutingStrategy(null)).toBe(false);
    });

    it("defines valid fallback triggers", () => {
      expect(FALLBACK_TRIGGERS).toContain("rate_limit");
      expect(FALLBACK_TRIGGERS).toContain("circuit_breaker_open");
      expect(FALLBACK_TRIGGERS).toContain("upstream_error");
      expect(FALLBACK_TRIGGERS).toContain("timeout");
      expect(FALLBACK_TRIGGERS).toContain("context_overflow");
    });

    it("validates fallback triggers with isFallbackTrigger", () => {
      expect(isFallbackTrigger("rate_limit")).toBe(true);
      expect(isFallbackTrigger("circuit_breaker_open")).toBe(true);
      expect(isFallbackTrigger("unknown_trigger")).toBe(false);
    });
  });

  describe("TenantConfig with createTenantConfig Factory", () => {
    it("creates TenantConfig with default routing, fallback, and circuit breaker", () => {
      const config = createTenantConfig("tenant-defaults-1");

      expect(config.tenantId).toBe("tenant-defaults-1");
      expect(config.isActive).toBe(true);
      expect(config.routing.strategy).toBe("cost-optimal");
      expect(config.routing.enforceCapabilityFiltering).toBe(true);
      expect(config.fallback.enabled).toBe(true);
      expect(config.fallback.maxRetries).toBe(3);
      expect(config.rateLimits.defaultRpmLimit).toBe(60);
      expect(config.circuitBreaker.failureThreshold).toBe(3);
      expect(config.circuitBreaker.cooldownSeconds).toBe(60);
      expect(isTenantConfig(config)).toBe(true);
    });

    it("applies per-provider RPM limits and custom routing preferences", () => {
      const config = createTenantConfig("tenant-custom-rpm", {
        tenantName: "Enterprise Tier 1",
        routing: {
          strategy: "lowest-latency",
          allowedProviders: ["openai", "anthropic", "google"],
          providerPriority: ["anthropic", "google", "openai"],
          modelMappings: {
            "smart-model": "claude-3-5-sonnet",
            "fast-model": ["gemini-2.0-flash", "gpt-4o-mini"],
          },
        },
        rateLimits: {
          defaultRpmLimit: 120,
          providerRpmLimits: {
            openai: 300,
            anthropic: 200,
            google: 500,
          },
        },
        circuitBreaker: {
          failureThreshold: 5,
          cooldownSeconds: 30,
        },
      });

      expect(config.tenantName).toBe("Enterprise Tier 1");
      expect(config.routing.strategy).toBe("lowest-latency");
      expect(config.routing.allowedProviders).toEqual(["openai", "anthropic", "google"]);
      expect(config.rateLimits.defaultRpmLimit).toBe(120);
      expect(config.rateLimits.providerRpmLimits?.openai).toBe(300);
      expect(config.rateLimits.providerRpmLimits?.anthropic).toBe(200);
      expect(config.rateLimits.providerRpmLimits?.google).toBe(500);
      expect(config.circuitBreaker.failureThreshold).toBe(5);
      expect(config.circuitBreaker.cooldownSeconds).toBe(30);
      expect(isTenantConfig(config)).toBe(true);
    });

    it("configures fallback chains and triggers", () => {
      const config = createTenantConfig("tenant-fallbacks", {
        fallback: {
          enabled: true,
          maxRetries: 2,
          backoffMs: 150,
          fallbackChains: {
            "claude-3-5-sonnet": ["gpt-4o", "gemini-2.0-flash"],
          },
          providerFallbackOrder: ["anthropic", "openai", "google"],
          triggers: ["rate_limit", "circuit_breaker_open"],
        },
      });

      expect(config.fallback.maxRetries).toBe(2);
      expect(config.fallback.fallbackChains?.["claude-3-5-sonnet"]).toEqual([
        "gpt-4o",
        "gemini-2.0-flash",
      ]);
      expect(config.fallback.providerFallbackOrder).toEqual(["anthropic", "openai", "google"]);
      expect(config.fallback.triggers).toEqual(["rate_limit", "circuit_breaker_open"]);
    });

    it("configures tenant financial budget with int64 microdollars", () => {
      const budget: TenantBudgetConfig = {
        maxBudgetMicrodollars: 50_000_000n, // $50 USD
        spentMicrodollars: 12_500_000n, // $12.50 USD
        onExhaustion: "block",
        alertThresholdPercent: 80,
      };

      const config = createTenantConfig("tenant-budget-capped", {
        budget,
      });

      expect(config.budget?.maxBudgetMicrodollars).toBe(50_000_000n);
      expect(config.budget?.spentMicrodollars).toBe(12_500_000n);
      expect(config.budget?.onExhaustion).toBe("block");
      expect(config.budget?.alertThresholdPercent).toBe(80);
      expect(isTenantConfig(config)).toBe(true);
    });
  });

  describe("Configuration Type Guards", () => {
    it("validates CircuitBreakerConfig with isCircuitBreakerConfig", () => {
      const valid: CircuitBreakerConfig = {
        failureThreshold: 3,
        cooldownSeconds: 60,
      };
      expect(isCircuitBreakerConfig(valid)).toBe(true);
      expect(isCircuitBreakerConfig(null)).toBe(false);
      expect(isCircuitBreakerConfig({ failureThreshold: 3 })).toBe(false);
    });

    it("validates RateLimitConfig with isRateLimitConfig", () => {
      const valid: RateLimitConfig = {
        defaultRpmLimit: 60,
      };
      expect(isRateLimitConfig(valid)).toBe(true);
      expect(isRateLimitConfig(null)).toBe(false);
      expect(isRateLimitConfig({})).toBe(false);
    });

    it("rejects malformed TenantConfig objects with isTenantConfig", () => {
      expect(isTenantConfig(null)).toBe(false);
      expect(isTenantConfig(undefined)).toBe(false);
      expect(isTenantConfig("config")).toBe(false);
      expect(isTenantConfig({ tenantId: 123 })).toBe(false);
      expect(
        isTenantConfig({
          tenantId: "t1",
          isActive: true,
          routing: { strategy: "invalid" },
          fallback: { enabled: true, maxRetries: 1 },
          rateLimits: { defaultRpmLimit: 60 },
          circuitBreaker: { failureThreshold: 3, cooldownSeconds: 60 },
        })
      ).toBe(false);
    });
  });
});
