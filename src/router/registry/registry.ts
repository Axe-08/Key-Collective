/**
 * Key Collective v2 — Model Registry Implementation
 *
 * Conforms to:
 * - LLD 2.1: Manages model definitions, context window limits, and pricing information.
 * - Logical alias lookup (e.g. mapping 'fast-model' or 'smart-fast' to canonical provider model ID).
 * - Context window tracking and token limits.
 * - Credit Unit (CU) weights per model; cheapest selection by CU weight.
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no `any`).
 * - Fixed-Point CreditUnits: All costs in int64 / bigint credit units. Zero floating-point math.
 */

import {
  ModelDef,
  ModelProvider,
  ModelPricing,
} from "../../types/models";
import { ceilDiv } from "../../constants/credits";
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
import { DEFAULT_MODEL_DEFINITIONS, MODEL_ALIAS_CHAINS } from "./catalog";
import { compareByCuWeight, cuWeight, normalizeModelDef } from "./helpers";

/**
 * ModelRegistry manages model definitions, context window limits, and pricing math.
 * Implements high-performance in-memory lookup, alias resolution, and fixed-point pricing.
 */
export class ModelRegistry implements IModelRegistry {
  /** Internal storage of models keyed by canonical ID (lowercase) */
  private readonly models = new Map<string, ModelDef>();

  /** Explicit alias overrides: alias (lowercase) -> canonical model ID */
  private readonly aliasOverrides = new Map<string, string>();

  /** Ordered alias chains: alias (lowercase) -> model IDs in preference order */
  private readonly aliasChains = new Map<string, readonly string[]>();

  constructor(options: ModelRegistryOptions | readonly (ModelDef)[] = {}) {
    let initialModels: readonly (ModelDef)[] | undefined;
    let initialAliases: Record<string, string> | undefined;
    let initialChains: Readonly<Record<string, readonly string[]>> = MODEL_ALIAS_CHAINS;

    if (Array.isArray(options)) {
      initialModels = options;
    } else {
      const opt = options as ModelRegistryOptions;
      initialModels = opt.models;
      initialAliases = opt.aliases;
      initialChains = opt.aliasChains ?? MODEL_ALIAS_CHAINS;
    }

    for (const [alias, chain] of Object.entries(initialChains)) {
      this.aliasChains.set(alias.toLowerCase().trim(), chain.map((id) => id.trim()));
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
  public registerModel(model: ModelDef): void {
    if (!model.id || typeof model.id !== "string" || !model.id.trim()) {
      throw new TypeError("Model must have a valid non-empty id");
    }
    const normalized = normalizeModelDef(model);
    this.models.set(normalized.id.toLowerCase().trim(), normalized);
  }

  /**
   * Registers multiple model definitions in batch.
   */
  public registerModels(models: readonly (ModelDef)[]): void {
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
  public getModel(modelId: string): ModelDef | undefined {
    return this.models.get(modelId.toLowerCase().trim());
  }

  /**
   * Retrieves a model definition by canonical ID, throwing ModelNotFoundError if missing.
   */
  public getModelOrThrow(modelId: string): ModelDef {
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
  public getAllModels(onlyActive = false): ModelDef[] {
    const all = Array.from(this.models.values());
    return onlyActive ? all.filter((m) => m.isActive) : all;
  }

  /**
   * Returns all active registered models.
   */
  public getActiveModels(): ModelDef[] {
    return this.getAllModels(true);
  }

  /**
   * Returns models belonging to a specific provider.
   */
  public getModelsByProvider(
    provider: ModelProvider,
    onlyActive = true
  ): ModelDef[] {
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
    if (this.getAliasChain(clean).length > 0) {
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

    // 2. Ordered alias chain: first registered, active model
    const chain = this.getAliasChain(clean);
    if (chain.length > 0) {
      return chain[0].id;
    }

    // 3. 'auto' is the cheapest active model by CU (the router then skips unleasable ones)
    if (clean === "auto") {
      return this.getCheapestModel(this.getAllModels(true))?.id;
    }

    // 4. Search through registered model logical aliases
    // If multiple models share an alias, pick the cheapest active model
    let cheapestMatch: ModelDef | undefined;

    for (const model of this.models.values()) {
      if (!model.isActive) continue;

      const hasAlias = model.logicalAliases.some(
        (a) => a.toLowerCase().trim() === clean
      );
      if (hasAlias) {
        if (!cheapestMatch || compareByCuWeight(model, cheapestMatch) < 0) {
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
  ): ModelDef | undefined {
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
  ): ModelDef {
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
   * Returns the registered models of an ordered alias chain, in preference order.
   * Models that are not registered (or inactive, when onlyActive) are skipped.
   */
  public getAliasChain(alias: string, onlyActive = true): ModelDef[] {
    const chain = this.aliasChains.get(alias.toLowerCase().trim()) ?? [];
    const out: ModelDef[] = [];
    for (const id of chain) {
      const model = this.models.get(id.toLowerCase());
      if (model && (!onlyActive || model.isActive)) {
        out.push(model);
      }
    }
    return out;
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
    const activeModels = this.getAllModels(onlyActive).sort(compareByCuWeight);

    for (const model of activeModels) {
      for (const alias of model.logicalAliases) {
        const clean = alias.toLowerCase().trim();
        if (!map.has(clean)) {
          map.set(clean, model.id);
        }
      }
    }

    // 2. Ordered alias chains override implicit aliases
    for (const alias of this.aliasChains.keys()) {
      const chain = this.getAliasChain(alias, onlyActive);
      if (chain.length > 0) {
        map.set(alias, chain[0].id);
      }
    }

    // 3. Explicit overrides take precedence
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
  // Credit Units (CU) Calculation & Pricing
  // ==========================================

  /**
   * Calculates Credit Units (CU) consumed for a request to a model or alias.
   */
  public calculateCu(modelIdOrAlias: string, usage: TokenUsage): bigint {
    const model = this.resolveModelOrThrow(modelIdOrAlias);
    return calculateCu(model, usage);
  }

  /**
   * Retrieves the CU weights of a model or alias.
   */
  public getPricing(modelIdOrAlias: string): ModelPricing {
    const model = this.resolveModelOrThrow(modelIdOrAlias);
    return {
      cuBase: model.cuBase,
      cuInPer1k: model.cuInPer1k,
      cuCachedPer1k: model.cuCachedPer1k,
      cuOutPer1k: model.cuOutPer1k,
    };
  }

  // ==========================================
  // Filtering & Cost-Optimal Selection
  // ==========================================

  /**
   * Finds candidate models matching the given criteria, sorted by input cost ascending.
   */
  public findCandidates(criteria: ModelFilterCriteria = {}): ModelDef[] {
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
    if (criteria.maxCuWeight !== undefined) {
      const maxWeight = criteria.maxCuWeight;
      candidates = candidates.filter((m) => cuWeight(m) <= maxWeight);
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

    // Sort by CU weight ascending (cost-optimal)
    return candidates.sort(compareByCuWeight);
  }

  /**
   * Selects the cheapest model from candidate array.
   */
  public getCheapestModel(
    candidates: ModelDef[]
  ): ModelDef | undefined {
    if (candidates.length === 0) return undefined;
    let cheapest = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (compareByCuWeight(candidates[i], cheapest) < 0) {
        cheapest = candidates[i];
      }
    }
    return cheapest;
  }

  /**
   * Compares two models by input cost for sorting.
   */
  public compareByCost(a: ModelDef, b: ModelDef): number {
    return compareByCuWeight(a, b);
  }

  // ==========================================
  // Static Financial Utilities
  // ==========================================

}

/**
 * Calculates Credit Units (CU) for a model invocation based on token usage.
 * Section 2.2 formula:
 * request_cu = model.cuBase
 *   + ceilDiv(BigInt(usage.promptTokens) * model.cuInPer1k, 1000n)
 *   + ceilDiv(BigInt(usage.cachedTokens ?? 0) * model.cuCachedPer1k, 1000n)
 *   + ceilDiv(BigInt((usage.completionTokens ?? 0) + (usage.reasoningTokens ?? 0)) * model.cuOutPer1k, 1000n)
 */
export function calculateCu(
  model: ModelDef,
  usage: TokenUsage
): bigint {
  const promptTokens = BigInt(Math.max(0, Math.trunc(usage.promptTokens ?? 0)));
  const cachedTokens = BigInt(Math.max(0, Math.trunc(usage.cachedTokens ?? 0)));
  const completionTokens = BigInt(Math.max(0, Math.trunc(usage.completionTokens ?? 0)));
  const reasoningTokens = BigInt(Math.max(0, Math.trunc(usage.reasoningTokens ?? 0)));
  const outputTokens = completionTokens + reasoningTokens;

  const cuBase = model.cuBase ?? 0n;
  const cuInPer1k = model.cuInPer1k ?? 0n;
  const cuCachedPer1k = model.cuCachedPer1k ?? 0n;
  const cuOutPer1k = model.cuOutPer1k ?? 0n;

  return (
    cuBase +
    ceilDiv(promptTokens * cuInPer1k, 1000n) +
    ceilDiv(cachedTokens * cuCachedPer1k, 1000n) +
    ceilDiv(outputTokens * cuOutPer1k, 1000n)
  );
}

