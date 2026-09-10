/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Model Registry Module (router-model-registry)
 *
 * Conforms to:
 * - LLD 2.1: Manages model definitions, context window limits, and pricing information.
 * - Logical alias lookup (e.g. mapping 'fast-model' or 'smart-fast' to canonical provider model ID).
 * - Context window tracking and token limits.
 * - Fixed-point microdollar pricing math (1 USD = 1,000,000 microdollars) to avoid floating point precision issues.
 * - Exposing methods to calculate estimated or exact costs based on token usage.
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no `any`).
 * - Fixed-Point Microdollars: All costs in int64 / bigint microdollars. Zero floating-point math.
 */

import {
  ModelDef,
  ModelProvider,
  ModelAlias,
  ModelPricing,
  createModelDef,
  isModelDef,
} from "../types/models";
import {
  MICRODOLLAR_MULTIPLIER,
  dollarsToMicrodollars,
  microdollarsToDollars,
  formatMicrodollars,
} from "../constants/financial";
import {
  ModelNotFoundError,
  UnknownModelAliasError,
  DomainError,
  DomainErrorOptions,
} from "../errors";

/**
 * Options for ContextWindowExceededError.
 */
export interface ContextWindowExceededErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  modelId: string;
  contextWindow: number;
  requestedTokens: number;
}

/**
 * ContextWindowExceededError (HTTP 400)
 * Thrown when requested prompt tokens or total estimated tokens exceed the model's maximum context window.
 */
export class ContextWindowExceededError extends DomainError {
  public override readonly name = "ContextWindowExceededError";
  public readonly modelId: string;
  public readonly contextWindow: number;
  public readonly requestedTokens: number;

  constructor(
    modelId: string,
    contextWindow: number,
    requestedTokens: number,
    message?: string,
    options: Omit<
      ContextWindowExceededErrorOptions,
      "modelId" | "contextWindow" | "requestedTokens"
    > = {}
  ) {
    const msg =
      message ??
      `Prompt tokens (${requestedTokens}) exceed model '${modelId}' context window (${contextWindow})`;
    super(msg, {
      ...options,
      statusCode: 400,
      code: "CONTEXT_WINDOW_EXCEEDED",
      details: {
        modelId,
        contextWindow,
        requestedTokens,
        ...options.details,
      },
    });
    this.modelId = modelId;
    this.contextWindow = contextWindow;
    this.requestedTokens = requestedTokens;
    Object.setPrototypeOf(this, ContextWindowExceededError.prototype);
  }
}

/**
 * Type guard for ContextWindowExceededError.
 */
export function isContextWindowExceededError(
  value: unknown
): value is ContextWindowExceededError {
  return (
    value instanceof ContextWindowExceededError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "ContextWindowExceededError")
  );
}

/**
 * Token usage counts reported by upstream or estimated for pre-flight routing.
 */
export interface TokenUsage {
  /** Prompt / input tokens consumed */
  promptTokens: number;
  /** Completion / output tokens generated */
  completionTokens: number;
  /** Cached tokens read from prompt cache */
  cachedTokens?: number;
  /** Reasoning / thought tokens consumed (billed at completion rate) */
  reasoningTokens?: number;
}

/**
 * Detailed breakdown of transaction costs in fixed-point microdollars.
 */
export interface CostBreakdown {
  /** Cost for prompt / input tokens in microdollars */
  promptCostMicrodollars: bigint;
  /** Cost for completion / output tokens in microdollars */
  completionCostMicrodollars: bigint;
  /** Cost for cached prompt tokens in microdollars */
  cacheReadCostMicrodollars: bigint;
  /** Cost for reasoning / thought tokens in microdollars */
  reasoningCostMicrodollars: bigint;
  /** Total transaction cost in microdollars */
  totalCostMicrodollars: bigint;
}

/**
 * Result of context window validation.
 */
export interface ContextValidationResult {
  /** Whether the requested tokens fit within the model's limits */
  valid: boolean;
  /** Maximum context window supported by the model */
  contextWindow: number;
  /** Maximum output tokens supported by the model */
  maxOutputTokens: number;
  /** Prompt tokens evaluated */
  promptTokens: number;
  /** Max completion tokens evaluated */
  maxCompletionTokens: number;
  /** Total estimated tokens (prompt + max completion) */
  totalEstimatedTokens: number;
  /** Remaining context capacity in tokens */
  remainingTokens: number;
  /** Human-readable reason if validation failed */
  errorReason?: string;
}

/**
 * Filter criteria for finding candidate models in the registry.
 */
export interface ModelFilterCriteria {
  /** Upstream provider to filter by */
  provider?: ModelProvider;
  /** Only return active models (default: true) */
  onlyActive?: boolean;
  /** Minimum context window in tokens */
  minContextWindow?: number;
  /** Maximum allowable input token cost in microdollars */
  maxCostPerMTokMicro?: bigint | number;
  /** Require tool / function calling capability */
  supportsTools?: boolean;
  /** Require multimodal vision capability */
  supportsVision?: boolean;
  /** Require JSON schema structured outputs */
  supportsJsonSchema?: boolean;
}

/**
 * Options for configuring ModelRegistry instantiation.
 */
export interface ModelRegistryOptions {
  /** Initial models to register. If omitted, DEFAULT_MODEL_DEFINITIONS are loaded */
  models?: readonly (ModelDef<bigint> | ModelDef<number>)[];
  /** Custom alias mapping overrides (e.g. { 'my-fast': 'gemini-2.0-flash' }) */
  aliases?: Record<string, string>;
}

/**
 * Contract interface for the Model Registry.
 */
export interface IModelRegistry {
  registerModel(model: ModelDef<bigint> | ModelDef<number>): void;
  registerModels(models: readonly (ModelDef<bigint> | ModelDef<number>)[]): void;
  unregisterModel(modelId: string): boolean;
  hasModel(modelId: string): boolean;
  getModel(modelId: string): ModelDef<bigint> | undefined;
  getModelOrThrow(modelId: string): ModelDef<bigint>;
  getAllModels(onlyActive?: boolean): ModelDef<bigint>[];
  getActiveModels(): ModelDef<bigint>[];
  getModelsByProvider(provider: ModelProvider, onlyActive?: boolean): ModelDef<bigint>[];

  registerAlias(alias: string, canonicalModelId: string): void;
  unregisterAlias(alias: string): boolean;
  hasAlias(alias: string): boolean;
  resolveAlias(alias: string): string | undefined;
  resolveModel(idOrAlias: string, onlyActive?: boolean): ModelDef<bigint> | undefined;
  resolveModelOrThrow(idOrAlias: string, onlyActive?: boolean): ModelDef<bigint>;
  getAliasesForModel(modelId: string): string[];
  getAliasMap(onlyActive?: boolean): Map<string, string>;

  getContextWindow(modelIdOrAlias: string): number;
  getMaxOutputTokens(modelIdOrAlias: string): number;
  fitsContextWindow(
    modelIdOrAlias: string,
    promptTokens: number,
    maxOutputTokens?: number
  ): boolean;
  getRemainingContextWindow(modelIdOrAlias: string, promptTokens: number): number;
  validateTokenLimits(
    modelIdOrAlias: string,
    tokens: { promptTokens: number; maxOutputTokens?: number }
  ): ContextValidationResult;
  assertWithinContextWindow(
    modelIdOrAlias: string,
    promptTokens: number,
    maxOutputTokens?: number
  ): void;

  calculateCost(modelIdOrAlias: string, usage: TokenUsage): bigint;
  calculateCostForModel(model: ModelDef<bigint>, usage: TokenUsage): bigint;
  calculateCostBreakdown(modelIdOrAlias: string, usage: TokenUsage): CostBreakdown;
  calculateEstimatedCost(
    modelIdOrAlias: string,
    estimatedPromptTokens: number,
    estimatedCompletionTokens?: number
  ): bigint;
  getPricing(modelIdOrAlias: string): ModelPricing<bigint>;

  findCandidates(criteria?: ModelFilterCriteria): ModelDef<bigint>[];
  getCheapestModel(candidates: ModelDef<bigint>[]): ModelDef<bigint> | undefined;
}

/**
 * Standard default model definitions populated with realistic industry pricing and limits.
 * All pricing strictly in int64 microdollars (bigint).
 */
export const DEFAULT_MODEL_DEFINITIONS: readonly ModelDef<bigint>[] = [
  {
    id: "gemini-2.0-flash",
    provider: "google",
    logicalAliases: ["smart-fast", "fast-model", "fast"],
    contextWindow: 1_048_576,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 100_000n, // bash.10 / 1M
    outputCostPerMTokMicro: 400_000n, // bash.40 / 1M
    cacheReadCostPerMTokMicro: 25_000n, // bash.025 / 1M
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "gemini-1.5-pro",
    provider: "google",
    logicalAliases: ["smart-model", "reasoning"],
    contextWindow: 2_097_152,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 1_250_000n, // .25 / 1M
    outputCostPerMTokMicro: 5_000_000n, // .00 / 1M
    cacheReadCostPerMTokMicro: 312_500n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "gpt-4o",
    provider: "openai",
    logicalAliases: ["smart-model", "reasoning", "vision"],
    contextWindow: 128_000,
    maxOutputTokens: 16384,
    inputCostPerMTokMicro: 2_500_000n, // .50 / 1M
    outputCostPerMTokMicro: 10_000_000n, // 0.00 / 1M
    cacheReadCostPerMTokMicro: 1_250_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    logicalAliases: ["fast-model", "economy", "fast"],
    contextWindow: 128_000,
    maxOutputTokens: 16384,
    inputCostPerMTokMicro: 150_000n, // bash.15 / 1M
    outputCostPerMTokMicro: 600_000n, // bash.60 / 1M
    cacheReadCostPerMTokMicro: 75_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "claude-3-5-sonnet",
    provider: "anthropic",
    logicalAliases: ["smart-model", "reasoning", "code"],
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 3_000_000n, // .00 / 1M
    outputCostPerMTokMicro: 15_000_000n, // 5.00 / 1M
    cacheReadCostPerMTokMicro: 300_000n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "claude-3-5-haiku",
    provider: "anthropic",
    logicalAliases: ["fast-model", "economy"],
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 800_000n, // bash.80 / 1M
    outputCostPerMTokMicro: 4_000_000n, // .00 / 1M
    cacheReadCostPerMTokMicro: 80_000n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "deepseek-chat",
    provider: "deepseek",
    logicalAliases: ["economy", "fast"],
    contextWindow: 64_000,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 140_000n, // bash.14 / 1M
    outputCostPerMTokMicro: 280_000n, // bash.28 / 1M
    cacheReadCostPerMTokMicro: 14_000n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
  {
    id: "llama-3.3-70b-versatile",
    provider: "groq",
    logicalAliases: ["fast-model", "smart-fast"],
    contextWindow: 128_000,
    maxOutputTokens: 32768,
    inputCostPerMTokMicro: 590_000n, // bash.59 / 1M
    outputCostPerMTokMicro: 790_000n, // bash.79 / 1M
    cacheReadCostPerMTokMicro: 0n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-09T00:00:00.000Z",
  },
];

/**
 * Additional Cardless Free-Tier Model Definitions (Gemini 2.5/3.8, Groq Llama 3.1, Qwen 3.6, GPT-OSS).
 * Configured with zero microdollar costs and official provider context limits.
 */
export const FREE_TIER_MODEL_DEFINITIONS: readonly ModelDef<bigint>[] = [
  {
    id: "gemini-2.5-flash",
    provider: "google",
    logicalAliases: ["gemini-flash", "google-flash", "flash-2.5"],
    contextWindow: 1_048_576,
    maxOutputTokens: 65536,
    inputCostPerMTokMicro: 0n,
    outputCostPerMTokMicro: 0n,
    cacheReadCostPerMTokMicro: 0n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    logicalAliases: ["gemini-pro", "google-pro", "pro-2.5"],
    contextWindow: 2_097_152,
    maxOutputTokens: 65536,
    inputCostPerMTokMicro: 0n,
    outputCostPerMTokMicro: 0n,
    cacheReadCostPerMTokMicro: 0n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "gemini-3.8-flash",
    provider: "google",
    logicalAliases: ["smart-fast-next", "gemini-3.8", "flash-3.8"],
    contextWindow: 1_048_576,
    maxOutputTokens: 65536,
    inputCostPerMTokMicro: 0n,
    outputCostPerMTokMicro: 0n,
    cacheReadCostPerMTokMicro: 0n,
    supportsTools: true,
    supportsVision: true,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "llama-3.1-8b-instant",
    provider: "groq",
    logicalAliases: ["groq-fast", "llama-8b", "llama-instant"],
    contextWindow: 131_072,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 0n,
    outputCostPerMTokMicro: 0n,
    cacheReadCostPerMTokMicro: 0n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "qwen/qwen3.6-27b",
    provider: "groq",
    logicalAliases: ["groq-code", "qwen-27b", "qwen/qwen3.8-27b"],
    contextWindow: 131_072,
    maxOutputTokens: 8192,
    inputCostPerMTokMicro: 0n,
    outputCostPerMTokMicro: 0n,
    cacheReadCostPerMTokMicro: 0n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
  {
    id: "openai/gpt-oss-120b",
    provider: "groq",
    logicalAliases: ["groq-oss", "gpt-oss", "gpt-oss-120b"],
    contextWindow: 131_072,
    maxOutputTokens: 65536,
    inputCostPerMTokMicro: 0n,
    outputCostPerMTokMicro: 0n,
    cacheReadCostPerMTokMicro: 0n,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: true,
    deprecatedAt: null,
    sunsetAt: null,
    isActive: true,
    lastSyncedAt: "2026-09-10T00:00:00.000Z",
  },
];

/**
 * All known model definitions combining default paid benchmarks and free-tier models.
 */
export const ALL_MODEL_DEFINITIONS: readonly ModelDef<bigint>[] = [
  ...DEFAULT_MODEL_DEFINITIONS,
  ...FREE_TIER_MODEL_DEFINITIONS,
];


/**
 * Normalizes input cost to bigint microdollars.
 */
function toBigIntMicro(value: bigint | number | undefined, defaultValue = 0n): bigint {
  if (value === undefined) return defaultValue;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Invalid cost number: ${value}`);
    }
    return BigInt(Math.trunc(value));
  }
  return defaultValue;
}

/**
 * Normalizes any ModelDef input to ModelDef<bigint>.
 */
function normalizeModelDef(
  model: ModelDef<bigint> | ModelDef<number>
): ModelDef<bigint> {
  return {
    ...model,
    inputCostPerMTokMicro: toBigIntMicro(model.inputCostPerMTokMicro),
    outputCostPerMTokMicro: toBigIntMicro(model.outputCostPerMTokMicro),
    cacheReadCostPerMTokMicro: toBigIntMicro(model.cacheReadCostPerMTokMicro, 0n),
    contextWindow: Math.trunc(model.contextWindow),
    maxOutputTokens: Math.trunc(model.maxOutputTokens),
    logicalAliases: (model.logicalAliases ?? []).map((a) => String(a).trim()).filter(Boolean),
    isActive: model.isActive ?? true,
  };
}

/**
 * ModelRegistry manages model definitions, context window limits, and pricing math.
 * Implements high-performance in-memory lookup, alias resolution, and fixed-point pricing.
 */
export class ModelRegistry implements IModelRegistry {
  /** Internal storage of models keyed by canonical ID (lowercase) */
  private readonly models = new Map<string, ModelDef<bigint>>();

  /** Explicit alias overrides: alias (lowercase) -> canonical model ID */
  private readonly aliasOverrides = new Map<string, string>();

  constructor(options: ModelRegistryOptions | readonly (ModelDef<bigint> | ModelDef<number>)[] = {}) {
    let initialModels: readonly (ModelDef<bigint> | ModelDef<number>)[] | undefined;
    let initialAliases: Record<string, string> | undefined;

    if (Array.isArray(options)) {
      initialModels = options;
    } else {
      const opt = options as ModelRegistryOptions;
      initialModels = opt.models;
      initialAliases = opt.aliases;
    }

    if (initialModels !== undefined) {
      this.registerModels(initialModels);
    } else {
      // Load default catalog
      this.registerModels(DEFAULT_MODEL_DEFINITIONS);
    }

    if (initialAliases) {
      for (const [alias, modelId] of Object.entries(initialAliases)) {
        this.registerAlias(alias, modelId);
      }
    }
  }

  // ==========================================
  // Model Management
  // ==========================================

  /**
   * Registers or updates a model definition in the registry.
   */
  public registerModel(model: ModelDef<bigint> | ModelDef<number>): void {
    if (!model.id || typeof model.id !== "string" || !model.id.trim()) {
      throw new TypeError("Model must have a valid non-empty id");
    }
    const normalized = normalizeModelDef(model);
    this.models.set(normalized.id.toLowerCase().trim(), normalized);
  }

  /**
   * Registers multiple model definitions in batch.
   */
  public registerModels(models: readonly (ModelDef<bigint> | ModelDef<number>)[]): void {
    for (const model of models) {
      this.registerModel(model);
    }
  }

  /**
   * Unregisters a model by ID. Returns true if removed, false if not present.
   */
  public unregisterModel(modelId: string): boolean {
    const key = modelId.toLowerCase().trim();
    const removed = this.models.delete(key);

    // Clean up any explicit aliases pointing to this model
    for (const [alias, targetId] of this.aliasOverrides.entries()) {
      if (targetId.toLowerCase().trim() === key) {
        this.aliasOverrides.delete(alias);
      }
    }

    return removed;
  }

  /**
   * Checks whether a model ID is registered.
   */
  public hasModel(modelId: string): boolean {
    return this.models.has(modelId.toLowerCase().trim());
  }

  /**
   * Retrieves a model definition by canonical ID.
   */
  public getModel(modelId: string): ModelDef<bigint> | undefined {
    return this.models.get(modelId.toLowerCase().trim());
  }

  /**
   * Retrieves a model definition by canonical ID, throwing ModelNotFoundError if missing.
   */
  public getModelOrThrow(modelId: string): ModelDef<bigint> {
    const model = this.getModel(modelId);
    if (!model) {
      throw new ModelNotFoundError(modelId, undefined, {
        availableModels: Array.from(this.models.keys()),
      });
    }
    return model;
  }

  /**
   * Returns all registered models, optionally filtered by active status.
   */
  public getAllModels(onlyActive = false): ModelDef<bigint>[] {
    const all = Array.from(this.models.values());
    return onlyActive ? all.filter((m) => m.isActive) : all;
  }

  /**
   * Returns all active registered models.
   */
  public getActiveModels(): ModelDef<bigint>[] {
    return this.getAllModels(true);
  }

  /**
   * Returns models belonging to a specific provider.
   */
  public getModelsByProvider(
    provider: ModelProvider,
    onlyActive = true
  ): ModelDef<bigint>[] {
    const target = provider.toLowerCase().trim();
    return this.getAllModels(onlyActive).filter(
      (m) => m.provider.toLowerCase().trim() === target
    );
  }

  // ==========================================
  // Logical Alias Lookup
  // ==========================================

  /**
   * Registers an explicit alias mapping to a canonical model ID.
   * Overrides any implicit alias matching.
   */
  public registerAlias(alias: string, canonicalModelId: string): void {
    const cleanAlias = alias.toLowerCase().trim();
    const cleanId = canonicalModelId.trim();
    if (!cleanAlias) {
      throw new TypeError("Alias must be a non-empty string");
    }
    this.aliasOverrides.set(cleanAlias, cleanId);
  }

  /**
   * Unregisters an explicit alias. Returns true if removed, false if not found.
   */
  public unregisterAlias(alias: string): boolean {
    return this.aliasOverrides.delete(alias.toLowerCase().trim());
  }

  /**
   * Checks whether an alias is explicitly registered or mapped on any model.
   */
  public hasAlias(alias: string): boolean {
    const clean = alias.toLowerCase().trim();
    if (this.aliasOverrides.has(clean)) {
      return true;
    }
    for (const model of this.models.values()) {
      if (model.logicalAliases.some((a) => a.toLowerCase().trim() === clean)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resolves an alias string to its canonical model ID.
   * If multiple models share an implicit alias, picks the cheapest active model.
   */
  public resolveAlias(alias: string): string | undefined {
    const clean = alias.toLowerCase().trim();
    if (!clean) return undefined;

    // 1. Explicit alias override
    if (this.aliasOverrides.has(clean)) {
      return this.aliasOverrides.get(clean);
    }

    // 2. Search model logicalAliases, prioritizing active and lowest cost
    const candidates = Array.from(this.models.values()).filter(
      (m) =>
        m.isActive &&
        m.logicalAliases.some((a) => a.toLowerCase().trim() === clean)
    );

    if (candidates.length > 0) {
      candidates.sort((a, b) =>
        a.inputCostPerMTokMicro < b.inputCostPerMTokMicro
          ? -1
          : a.inputCostPerMTokMicro > b.inputCostPerMTokMicro
          ? 1
          : 0
      );
      return candidates[0].id;
    }

    // Fallback: check inactive models if no active match
    const inactiveCandidates = Array.from(this.models.values()).filter((m) =>
      m.logicalAliases.some((a) => a.toLowerCase().trim() === clean)
    );
    return inactiveCandidates[0]?.id;
  }

  /**
   * Resolves an identifier that may be either a canonical model ID or a logical alias.
   */
  public resolveModel(
    idOrAlias: string,
    onlyActive = true
  ): ModelDef<bigint> | undefined {
    const clean = idOrAlias.toLowerCase().trim();
    if (!clean) return undefined;

    // 1. Direct canonical model ID match
    const direct = this.models.get(clean);
    if (direct) {
      if (!onlyActive || direct.isActive) {
        return direct;
      }
      return undefined;
    }

    // 2. Resolve via alias
    const canonicalId = this.resolveAlias(clean);
    if (canonicalId) {
      const model = this.models.get(canonicalId.toLowerCase().trim());
      if (model && (!onlyActive || model.isActive)) {
        return model;
      }
    }

    return undefined;
  }

  /**
   * Resolves a model ID or alias, throwing ModelNotFoundError or UnknownModelAliasError if unresolved.
   */
  public resolveModelOrThrow(
    idOrAlias: string,
    onlyActive = true
  ): ModelDef<bigint> {
    const resolved = this.resolveModel(idOrAlias, onlyActive);
    if (!resolved) {
      const knownAliases = Array.from(this.getAliasMap(onlyActive).keys());
      const knownModels = Array.from(this.models.keys());

      // If it resembles an alias request, provide configured aliases
      if (idOrAlias.includes("-") || knownAliases.includes(idOrAlias.toLowerCase())) {
        throw new UnknownModelAliasError(idOrAlias, undefined, {
          configuredAliases: knownAliases,
        });
      }

      throw new ModelNotFoundError(idOrAlias, undefined, {
        availableModels: knownModels,
      });
    }
    return resolved;
  }

  /**
   * Returns all logical aliases associated with a specific model ID.
   */
  public getAliasesForModel(modelId: string): string[] {
    const cleanId = modelId.toLowerCase().trim();
    const model = this.models.get(cleanId);
    const aliases = new Set<string>();

    if (model) {
      for (const a of model.logicalAliases) {
        aliases.add(a);
      }
    }

    // Also include explicit overrides pointing to this model
    for (const [alias, targetId] of this.aliasOverrides.entries()) {
      if (targetId.toLowerCase().trim() === cleanId) {
        aliases.add(alias);
      }
    }

    return Array.from(aliases);
  }

  /**
   * Returns a complete map of all aliases pointing to their canonical model IDs.
   */
  public getAliasMap(onlyActive = true): Map<string, string> {
    const map = new Map<string, string>();

    // 1. Implicit model aliases (sorted by cost ascending so cheapest wins)
    const activeModels = this.getAllModels(onlyActive).sort((a, b) =>
      a.inputCostPerMTokMicro < b.inputCostPerMTokMicro
        ? -1
        : a.inputCostPerMTokMicro > b.inputCostPerMTokMicro
        ? 1
        : 0
    );

    for (const model of activeModels) {
      for (const alias of model.logicalAliases) {
        const clean = alias.toLowerCase().trim();
        if (!map.has(clean)) {
          map.set(clean, model.id);
        }
      }
    }

    // 2. Explicit overrides take precedence
    for (const [alias, targetId] of this.aliasOverrides.entries()) {
      const targetModel = this.models.get(targetId.toLowerCase().trim());
      if (!onlyActive || (targetModel && targetModel.isActive)) {
        map.set(alias, targetId);
      }
    }

    return map;
  }

  // ==========================================
  // Context Window Tracking & Token Limits
  // ==========================================

  /**
   * Returns the maximum context window in tokens for a given model or alias.
   */
  public getContextWindow(modelIdOrAlias: string): number {
    const model = this.resolveModelOrThrow(modelIdOrAlias);
    return model.contextWindow;
  }

  /**
   * Returns the maximum output / completion tokens supported by a model.
   */
  public getMaxOutputTokens(modelIdOrAlias: string): number {
    const model = this.resolveModelOrThrow(modelIdOrAlias);
    return model.maxOutputTokens;
  }

  /**
   * Checks whether the prompt tokens (and optional output tokens) fit within the context window.
   */
  public fitsContextWindow(
    modelIdOrAlias: string,
    promptTokens: number,
    maxOutputTokens = 0
  ): boolean {
    const model = this.resolveModel(modelIdOrAlias);
    if (!model) return false;

    const pTokens = Math.max(0, Math.trunc(promptTokens));
    const outTokens = Math.max(0, Math.trunc(maxOutputTokens));

    return pTokens + outTokens <= model.contextWindow;
  }

  /**
   * Returns the remaining tokens available in the model's context window after prompt tokens.
   */
  public getRemainingContextWindow(
    modelIdOrAlias: string,
    promptTokens: number
  ): number {
    const model = this.resolveModelOrThrow(modelIdOrAlias);
    const pTokens = Math.max(0, Math.trunc(promptTokens));
    return Math.max(0, model.contextWindow - pTokens);
  }

  /**
   * Performs full validation against context window and output token limits.
   */
  public validateTokenLimits(
    modelIdOrAlias: string,
    tokens: { promptTokens: number; maxOutputTokens?: number }
  ): ContextValidationResult {
    const model = this.resolveModelOrThrow(modelIdOrAlias);
    const promptTokens = Math.max(0, Math.trunc(tokens.promptTokens));
    const requestedMaxOutput =
      tokens.maxOutputTokens !== undefined
        ? Math.max(0, Math.trunc(tokens.maxOutputTokens))
        : undefined;

    const maxCompletionTokens = requestedMaxOutput ?? model.maxOutputTokens;
    const totalEstimatedTokens = promptTokens + (requestedMaxOutput ?? 0);
    const remainingTokens = Math.max(0, model.contextWindow - promptTokens);

    let valid = true;
    let errorReason: string | undefined;

    if (promptTokens > model.contextWindow) {
      valid = false;
      errorReason = `Prompt tokens (${promptTokens}) exceed model '${model.id}' context window (${model.contextWindow})`;
    } else if (
      requestedMaxOutput !== undefined &&
      requestedMaxOutput > model.maxOutputTokens
    ) {
      valid = false;
      errorReason = `Requested max output tokens (${requestedMaxOutput}) exceed model '${model.id}' maximum output limit (${model.maxOutputTokens})`;
    } else if (totalEstimatedTokens > model.contextWindow) {
      valid = false;
      errorReason = `Total estimated tokens (${totalEstimatedTokens}) exceed model '${model.id}' context window (${model.contextWindow})`;
    }

    return {
      valid,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      promptTokens,
      maxCompletionTokens,
      totalEstimatedTokens,
      remainingTokens,
      errorReason,
    };
  }

  /**
   * Asserts that prompt tokens fit within the context window.
   * Throws ContextWindowExceededError (HTTP 400) if exceeded (tc-05).
   */
  public assertWithinContextWindow(
    modelIdOrAlias: string,
    promptTokens: number,
    maxOutputTokens = 0
  ): void {
    const model = this.resolveModelOrThrow(modelIdOrAlias);
    const pTokens = Math.max(0, Math.trunc(promptTokens));
    const outTokens = Math.max(0, Math.trunc(maxOutputTokens));

    if (pTokens + outTokens > model.contextWindow) {
      throw new ContextWindowExceededError(
        model.id,
        model.contextWindow,
        pTokens + outTokens
      );
    }
  }

  // ==========================================
  // Fixed-Point Microdollar Pricing Math
  // ==========================================

  /**
   * Calculates the exact total transaction cost in int64 microdollars for a model.
   * Zero floating-point arithmetic:
   * promptCost = (promptTokens * inputCost) // 1_000_000n
   * outputCost = ((completionTokens + reasoningTokens) * outputCost) // 1_000_000n
   * cacheCost = (cachedTokens * cacheReadCost) // 1_000_000n
   */
  public calculateCost(modelIdOrAlias: string, usage: TokenUsage): bigint {
    const model = this.resolveModelOrThrow(modelIdOrAlias);
    return this.calculateCostForModel(model, usage);
  }

  /**
   * Calculates exact cost directly from a ModelDef instance without re-resolving.
   */
  public calculateCostForModel(
    model: ModelDef<bigint>,
    usage: TokenUsage
  ): bigint {
    const promptTokens = BigInt(Math.max(0, Math.trunc(usage.promptTokens)));
    const completionTokens = BigInt(Math.max(0, Math.trunc(usage.completionTokens)));
    const reasoningTokens = BigInt(Math.max(0, Math.trunc(usage.reasoningTokens ?? 0)));
    const cachedTokens = BigInt(Math.max(0, Math.trunc(usage.cachedTokens ?? 0)));

    const inputCost =
      (promptTokens * model.inputCostPerMTokMicro) / MICRODOLLAR_MULTIPLIER;
    const outputCost =
      ((completionTokens + reasoningTokens) * model.outputCostPerMTokMicro) /
      MICRODOLLAR_MULTIPLIER;
    const cacheCost =
      (cachedTokens * model.cacheReadCostPerMTokMicro) / MICRODOLLAR_MULTIPLIER;

    return inputCost + outputCost + cacheCost;
  }

  /**
   * Returns a detailed breakdown of costs across prompt, completion, reasoning, and cache.
   */
  public calculateCostBreakdown(
    modelIdOrAlias: string,
    usage: TokenUsage
  ): CostBreakdown {
    const model = this.resolveModelOrThrow(modelIdOrAlias);

    const promptTokens = BigInt(Math.max(0, Math.trunc(usage.promptTokens)));
    const completionTokens = BigInt(Math.max(0, Math.trunc(usage.completionTokens)));
    const reasoningTokens = BigInt(Math.max(0, Math.trunc(usage.reasoningTokens ?? 0)));
    const cachedTokens = BigInt(Math.max(0, Math.trunc(usage.cachedTokens ?? 0)));

    const promptCost =
      (promptTokens * model.inputCostPerMTokMicro) / MICRODOLLAR_MULTIPLIER;
    const reasoningCost =
      (reasoningTokens * model.outputCostPerMTokMicro) / MICRODOLLAR_MULTIPLIER;
    const completionCost =
      (completionTokens * model.outputCostPerMTokMicro) / MICRODOLLAR_MULTIPLIER;
    const cacheCost =
      (cachedTokens * model.cacheReadCostPerMTokMicro) / MICRODOLLAR_MULTIPLIER;

    // Total combines total output tokens (completion + reasoning) cleanly
    const totalOutputCost =
      ((completionTokens + reasoningTokens) * model.outputCostPerMTokMicro) /
      MICRODOLLAR_MULTIPLIER;
    const totalCost = promptCost + totalOutputCost + cacheCost;

    return {
      promptCostMicrodollars: promptCost,
      completionCostMicrodollars: completionCost,
      reasoningCostMicrodollars: reasoningCost,
      cacheReadCostMicrodollars: cacheCost,
      totalCostMicrodollars: totalCost,
    };
  }

  /**
   * Calculates estimated cost in microdollars based on expected token counts.
   * Useful for pre-flight budget checks before executing upstream calls.
   */
  public calculateEstimatedCost(
    modelIdOrAlias: string,
    estimatedPromptTokens: number,
    estimatedCompletionTokens = 0
  ): bigint {
    return this.calculateCost(modelIdOrAlias, {
      promptTokens: estimatedPromptTokens,
      completionTokens: estimatedCompletionTokens,
    });
  }

  /**
   * Retrieves pricing structure for a model or alias.
   */
  public getPricing(modelIdOrAlias: string): ModelPricing<bigint> {
    const model = this.resolveModelOrThrow(modelIdOrAlias);
    return {
      inputCostPerMTokMicro: model.inputCostPerMTokMicro,
      outputCostPerMTokMicro: model.outputCostPerMTokMicro,
      cacheReadCostPerMTokMicro: model.cacheReadCostPerMTokMicro,
    };
  }

  // ==========================================
  // Filtering & Cost-Optimal Selection
  // ==========================================

  /**
   * Finds candidate models matching the given criteria, sorted by input cost ascending.
   */
  public findCandidates(criteria: ModelFilterCriteria = {}): ModelDef<bigint>[] {
    const onlyActive = criteria.onlyActive ?? true;
    let candidates = this.getAllModels(onlyActive);

    if (criteria.provider) {
      const p = criteria.provider.toLowerCase().trim();
      candidates = candidates.filter((m) => m.provider.toLowerCase().trim() === p);
    }
    if (criteria.minContextWindow !== undefined) {
      candidates = candidates.filter(
        (m) => m.contextWindow >= criteria.minContextWindow!
      );
    }
    if (criteria.maxCostPerMTokMicro !== undefined) {
      const maxCost = toBigIntMicro(criteria.maxCostPerMTokMicro);
      candidates = candidates.filter(
        (m) => m.inputCostPerMTokMicro <= maxCost
      );
    }
    if (criteria.supportsTools) {
      candidates = candidates.filter((m) => m.supportsTools);
    }
    if (criteria.supportsVision) {
      candidates = candidates.filter((m) => m.supportsVision);
    }
    if (criteria.supportsJsonSchema) {
      candidates = candidates.filter((m) => m.supportsJsonSchema);
    }

    // Sort by input cost ascending (cost-optimal)
    return candidates.sort((a, b) =>
      a.inputCostPerMTokMicro < b.inputCostPerMTokMicro
        ? -1
        : a.inputCostPerMTokMicro > b.inputCostPerMTokMicro
        ? 1
        : 0
    );
  }

  /**
   * Selects the cheapest model from candidate array.
   */
  public getCheapestModel(
    candidates: ModelDef<bigint>[]
  ): ModelDef<bigint> | undefined {
    if (candidates.length === 0) return undefined;
    let cheapest = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].inputCostPerMTokMicro < cheapest.inputCostPerMTokMicro) {
        cheapest = candidates[i];
      }
    }
    return cheapest;
  }

  /**
   * Compares two models by input cost for sorting.
   */
  public compareByCost(a: ModelDef<bigint>, b: ModelDef<bigint>): number {
    if (a.inputCostPerMTokMicro < b.inputCostPerMTokMicro) return -1;
    if (a.inputCostPerMTokMicro > b.inputCostPerMTokMicro) return 1;
    return 0;
  }

  // ==========================================
  // Static Financial Utilities
  // ==========================================

  /**
   * Computes token cost in microdollars using fixed-point integer math.
   * (tokens * costPerMTokMicro) // 1_000_000n
   */
  public static calculateTokenCost(
    tokens: bigint | number,
    costPerMTokMicro: bigint
  ): bigint {
    const tok = typeof tokens === "bigint" ? tokens : BigInt(Math.max(0, Math.trunc(tokens)));
    return (tok * costPerMTokMicro) / MICRODOLLAR_MULTIPLIER;
  }

  /**
   * Converts USD dollar amount to microdollars (bigint).
   */
  public static dollarsToMicrodollars(dollars: number | string): bigint {
    return dollarsToMicrodollars(dollars);
  }

  /**
   * Converts microdollars to USD dollars (number, for presentation only).
   */
  public static microdollarsToDollars(microdollars: bigint): number {
    return microdollarsToDollars(microdollars);
  }

  /**
   * Formats microdollars into human-readable USD string.
   */
  public static formatMicrodollars(
    microdollars: bigint,
    options?: {
      includeSymbol?: boolean;
      precision?: "cents" | "microdollars" | "auto";
    }
  ): string {
    return formatMicrodollars(microdollars, options);
  }
}
