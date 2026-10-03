/**
 * Key Collective v2 — Model Registry Interfaces & Types
 *
 * Conforms to:
 * - LLD 2.1: Model definitions, context window limits, and pricing information.
 * - GEMINI.md Constitution: TypeScript strict mode, no `any`, fixed-point credit units.
 */

import type {
  ModelDef,
  ModelProvider,
  ModelPricing,
} from "../../types/models";

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
 * Detailed breakdown of transaction costs in fixed-point credit units.
 */
export interface CostBreakdown {
  /** Cost for prompt / input tokens in credit units */
  promptCostCu: bigint;
  /** Cost for completion / output tokens in credit units */
  completionCostCu: bigint;
  /** Cost for cached prompt tokens in credit units */
  cacheReadCostCu: bigint;
  /** Cost for reasoning / thought tokens in credit units */
  reasoningCostCu: bigint;
  /** Total transaction cost in credit units */
  totalCostCu: bigint;
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
  /** Maximum allowable input token cost in credit units */
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

  getPricing(modelIdOrAlias: string): ModelPricing<bigint>;

  findCandidates(criteria?: ModelFilterCriteria): ModelDef<bigint>[];
  getCheapestModel(candidates: ModelDef<bigint>[]): ModelDef<bigint> | undefined;
}
