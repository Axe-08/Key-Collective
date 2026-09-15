/**
 * Key Collective v2 — Model Registry Implementation
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
  ModelPricing,
} from "../../types/models";
import {
  MICRODOLLAR_MULTIPLIER,
  dollarsToMicrodollars,
  microdollarsToDollars,
  formatMicrodollars,
} from "../../constants/financial";
import {
  ModelNotFoundError,
  UnknownModelAliasError,
} from "../../errors";
import { ContextWindowExceededError } from "./errors";
import {
  IModelRegistry,
  ModelRegistryOptions,
  ModelFilterCriteria,
  TokenUsage,
  CostBreakdown,
  ContextValidationResult,
} from "./types";
import { DEFAULT_MODEL_DEFINITIONS } from "./catalog";
import { normalizeModelDef, toBigIntMicro } from "./helpers";

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
   * Unregisters an explicit alias.
   */
  public unregisterAlias(alias: string): boolean {
    return this.aliasOverrides.delete(alias.toLowerCase().trim());
  }

  /**
   * Checks whether an alias is configured.
   */
  public hasAlias(alias: string): boolean {
    const clean = alias.toLowerCase().trim();
    if (this.aliasOverrides.has(clean)) {
      return true;
    }
    for (const model of this.models.values()) {
      if (model.logicalAliases.some((a) => a.toLowerCase() === clean)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resolves an alias string to its canonical model ID.
   * Explicit alias overrides take precedence over model-defined logical aliases.
   */
  public resolveAlias(alias: string): string | undefined {
    const clean = alias.toLowerCase().trim();

    // 1. Check explicit overrides first
    const override = this.aliasOverrides.get(clean);
    if (override) {
      return override;
    }

    // 2. Search through registered model logical aliases
    // If multiple models share an alias, pick the cheapest active model
    let cheapestMatch: ModelDef<bigint> | undefined;

    for (const model of this.models.values()) {
      if (!model.isActive) continue;

      const hasAlias = model.logicalAliases.some(
        (a) => a.toLowerCase().trim() === clean
      );
      if (hasAlias) {
        if (
          !cheapestMatch ||
          model.inputCostPerMTokMicro < cheapestMatch.inputCostPerMTokMicro
        ) {
          cheapestMatch = model;
        }
      }
    }

    return cheapestMatch?.id;
  }

  /**
   * Resolves a model identifier or logical alias to a canonical ModelDef.
   * Tries direct ID match first, then alias resolution.
   */
  public resolveModel(
    idOrAlias: string,
    onlyActive = true
  ): ModelDef<bigint> | undefined {
    const clean = idOrAlias.toLowerCase().trim();

    // 1. Try direct canonical ID match
    const directModel = this.models.get(clean);
    if (directModel) {
      if (onlyActive && !directModel.isActive) {
        return undefined;
      }
      return directModel;
    }

    // 2. Try alias resolution
    const resolvedId = this.resolveAlias(clean);
    if (resolvedId) {
      const aliasModel = this.models.get(resolvedId.toLowerCase().trim());
      if (aliasModel) {
        if (onlyActive && !aliasModel.isActive) {
          return undefined;
        }
        return aliasModel;
      }
    }

    return undefined;
  }

  /**
   * Resolves a model identifier or alias, throwing a descriptive error if not found.
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
