/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Capability Filter Module (router-capability-filter)
 *
 * Conforms to:
 * - LLD 2.2: Filters candidate models based on the requirements of the incoming request.
 * - Key Responsibilities:
 *   - Evaluate candidates based on context length needed.
 *   - Filter based on required capabilities such as tools (function calling), vision (image inputs), and structured schema support.
 *   - Returns a sorted list of viable model candidates for a given request.
 * - Golden Test tc-07: Excludes unsupported models when tools or capabilities are requested.
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no `any`).
 * - Fixed-Point Microdollars: All costs in int64 / bigint microdollars. Zero floating-point math.
 */

import { ModelDef, ModelProvider, isModelDef } from "../types/models";
import { CapabilityMismatchError } from "../errors/routing_errors";
import type { IModelRegistry } from "./model_registry";

/**
 * Capability requirements extracted from an incoming request or specified explicitly.
 */
export interface CapabilityRequirements {
  /** Minimum context length (prompt + output tokens) in tokens */
  minContextLength?: number;
  /** Minimum max output / completion tokens required in tokens */
  maxOutputTokens?: number;
  /** Whether tool / function calling capability is required */
  requiresTools?: boolean;
  /** Whether multimodal vision capability is required */
  requiresVision?: boolean;
  /** Whether structured output / JSON schema capability is required */
  requiresJsonSchema?: boolean;
  /** Whether streaming SSE capability is required */
  requiresStreaming?: boolean;
  /** Upstream provider to filter by (optional) */
  provider?: ModelProvider;
  /** Maximum allowable input cost per 1M tokens in microdollars (bigint) */
  maxCostPerMTokMicro?: bigint;
  /** Whether to only include active models (default: true) */
  onlyActive?: boolean;
}

/**
 * Result of auditing a model against capability requirements.
 */
export interface CapabilityCheckResult {
  /** Whether the model satisfies all requested capabilities */
  isCapable: boolean;
  /** Canonical model identifier */
  modelId: string;
  /** Names of capabilities that failed validation */
  missingCapabilities: string[];
  /** Detailed human-readable explanation for each failure */
  reasons: string[];
}

/**
 * Strategy for ordering viable candidate models.
 */
export type ModelSortStrategy = "cost-asc" | "cost-desc" | "context-desc" | "none";

/**
 * Options for filtering candidates.
 */
export interface FilterOptions {
  /** Strategy used to sort matching candidate models (default: 'cost-asc') */
  sortBy?: ModelSortStrategy;
  /** If true, throws CapabilityMismatchError when no candidate models match */
  throwIfEmpty?: boolean;
}

/**
 * Options for extracting capability requirements from request payloads.
 */
export interface RequirementExtractionOptions {
  /** Explicit prompt token count if calculated upstream */
  estimatedPromptTokens?: number;
  /** Safety buffer multiplier for estimated context tokens (default: 1.0) */
  contextBufferMultiplier?: number;
  /** Fallback max output tokens if not specified in request */
  defaultMaxOutputTokens?: number;
  /** Provider filter override */
  provider?: ModelProvider;
  /** Maximum cost ceiling in microdollars */
  maxCostPerMTokMicro?: bigint;
  /** Only consider active models (default: true) */
  onlyActive?: boolean;
}

/**
 * Type guard for record objects.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if an object is already a CapabilityRequirements structure.
 */
export function isCapabilityRequirements(value: unknown): value is CapabilityRequirements {
  if (!isRecord(value)) return false;
  return (
    ("requiresTools" in value && typeof value.requiresTools === "boolean") ||
    ("requiresVision" in value && typeof value.requiresVision === "boolean") ||
    ("requiresJsonSchema" in value && typeof value.requiresJsonSchema === "boolean") ||
    ("minContextLength" in value && typeof value.minContextLength === "number") ||
    ("maxOutputTokens" in value && typeof value.maxOutputTokens === "number")
  );
}

/**
 * CapabilityFilter evaluates model candidates against incoming request requirements.
 * Filters out models lacking required capabilities (tools, vision, schema, context window)
 * and returns viable candidates sorted cost-optimally.
 */
export class CapabilityFilter {
  private readonly registry?: IModelRegistry;

  constructor(registry?: IModelRegistry) {
    this.registry = registry;
  }

  // =========================================================================
  // Requirement Extraction
  // =========================================================================

  /**
   * Extracts required model capabilities from an incoming request payload or RouteRequest.
   * Inspects messages for multimodal content, tool definitions, structured response format,
   * and estimates required context window tokens.
   */
  public extractRequirements(
    request: unknown,
    options?: RequirementExtractionOptions
  ): CapabilityRequirements {
    if (!request || !isRecord(request)) {
      return {
        requiresTools: false,
        requiresVision: false,
        requiresJsonSchema: false,
        onlyActive: options?.onlyActive ?? true,
        ...(options?.provider ? { provider: options.provider } : {}),
        ...(options?.maxCostPerMTokMicro !== undefined
          ? { maxCostPerMTokMicro: options.maxCostPerMTokMicro }
          : {}),
      };
    }

    // If caller already provided a CapabilityRequirements object, pass it through with options merged
    if (isCapabilityRequirements(request)) {
      const cr = request as CapabilityRequirements;
      return {
        minContextLength: cr.minContextLength,
        maxOutputTokens: cr.maxOutputTokens,
        requiresTools: cr.requiresTools,
        requiresVision: cr.requiresVision,
        requiresJsonSchema: cr.requiresJsonSchema,
        requiresStreaming: cr.requiresStreaming,
        onlyActive: options?.onlyActive ?? cr.onlyActive ?? true,
        provider: options?.provider ?? cr.provider,
        maxCostPerMTokMicro: options?.maxCostPerMTokMicro ?? cr.maxCostPerMTokMicro,
      };
    }

    const req = request as Record<string, unknown>;

    let requiresTools = false;
    let requiresVision = false;
    let requiresJsonSchema = false;
    let requiresStreaming = false;

    // 1. Tool / Function Calling Extraction
    const hasTools = Array.isArray(req.tools) && req.tools.length > 0;
    const hasFunctions = Array.isArray(req.functions) && req.functions.length > 0;
    const toolChoice = req.tool_choice;
    const functionCall = req.function_call;

    if (hasTools || hasFunctions) {
      requiresTools = true;
    } else if (toolChoice !== undefined && toolChoice !== "none") {
      requiresTools = true;
    } else if (functionCall !== undefined && functionCall !== "none") {
      requiresTools = true;
    }

    // 2. Multimodal Vision Extraction
    if (Array.isArray(req.messages)) {
      for (const msg of req.messages) {
        if (!isRecord(msg)) continue;

        // Check multipart content array
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (!isRecord(part)) continue;
            const partType = typeof part.type === "string" ? part.type.toLowerCase() : "";
            if (
              partType === "image_url" ||
              partType === "image" ||
              "image_url" in part ||
              "image" in part
            ) {
              requiresVision = true;
              break;
            }
          }
        } else if (typeof msg.content === "string") {
          // Check inline data URI images (e.g. data:image/png;base64,...)
          if (msg.content.includes("data:image/")) {
            requiresVision = true;
          }
        }

        // Ollama / local multimodal image arrays
        if (Array.isArray(msg.images) && msg.images.length > 0) {
          requiresVision = true;
        }

        if (requiresVision) break;
      }
    }

    // Top-level image fields
    if (Array.isArray(req.images) && req.images.length > 0) {
      requiresVision = true;
    }

    // 3. Structured Output / JSON Schema Extraction
    if (req.response_format !== undefined) {
      if (typeof req.response_format === "string") {
        const rf = req.response_format.toLowerCase().trim();
        if (rf === "json_object" || rf === "json_schema") {
          requiresJsonSchema = true;
        }
      } else if (isRecord(req.response_format)) {
        const rfType =
          typeof req.response_format.type === "string"
            ? req.response_format.type.toLowerCase().trim()
            : "";
        if (
          rfType === "json_object" ||
          rfType === "json_schema" ||
          "json_schema" in req.response_format
        ) {
          requiresJsonSchema = true;
        }
      }
    }
    if (req.json_schema !== undefined || req.output_schema !== undefined) {
      requiresJsonSchema = true;
    }

    // 4. Streaming Request Flag
    if (req.stream === true) {
      requiresStreaming = true;
    }

    // 5. Context Window & Max Output Extraction
    let maxOutputTokens: number | undefined;
    if (typeof req.max_tokens === "number" && req.max_tokens > 0) {
      maxOutputTokens = Math.trunc(req.max_tokens);
    } else if (
      typeof req.max_completion_tokens === "number" &&
      req.max_completion_tokens > 0
    ) {
      maxOutputTokens = Math.trunc(req.max_completion_tokens);
    } else if (
      options?.defaultMaxOutputTokens !== undefined &&
      options.defaultMaxOutputTokens > 0
    ) {
      maxOutputTokens = Math.trunc(options.defaultMaxOutputTokens);
    }

    let estimatedPromptTokens = 0;
    if (
      options?.estimatedPromptTokens !== undefined &&
      options.estimatedPromptTokens >= 0
    ) {
      estimatedPromptTokens = Math.trunc(options.estimatedPromptTokens);
    } else {
      // Estimate prompt tokens from messages, system prompt, and tools
      if (Array.isArray(req.messages)) {
        estimatedPromptTokens += CapabilityFilter.estimateTokens(req.messages);
      }
      if (req.system !== undefined) {
        estimatedPromptTokens += CapabilityFilter.estimateTokens(req.system);
      }
      if (Array.isArray(req.tools)) {
        estimatedPromptTokens += CapabilityFilter.estimateTokens(req.tools);
      }
      if (Array.isArray(req.functions)) {
        estimatedPromptTokens += CapabilityFilter.estimateTokens(req.functions);
      }
    }

    const bufferMultiplier = options?.contextBufferMultiplier ?? 1.0;
    const totalRequiredTokens = Math.ceil(
      (estimatedPromptTokens + (maxOutputTokens ?? 0)) * bufferMultiplier
    );
    const minContextLength = totalRequiredTokens > 0 ? totalRequiredTokens : undefined;

    return {
      requiresTools,
      requiresVision,
      requiresJsonSchema,
      requiresStreaming: requiresStreaming || undefined,
      minContextLength,
      maxOutputTokens,
      onlyActive: options?.onlyActive ?? true,
      provider: options?.provider,
      maxCostPerMTokMicro: options?.maxCostPerMTokMicro,
    };
  }

  // =========================================================================
  // Capability Validation
  // =========================================================================

  /**
   * Audits a model definition against given requirements, returning pass/fail and missing capabilities.
   */
  public checkCapabilities(
    model: ModelDef<bigint>,
    requirements: CapabilityRequirements
  ): CapabilityCheckResult {
    const missingCapabilities: string[] = [];
    const reasons: string[] = [];

    const onlyActive = requirements.onlyActive ?? true;
    if (onlyActive && !model.isActive) {
      missingCapabilities.push("active");
      reasons.push(`Model '${model.id}' is inactive or deprecated`);
    }

    if (requirements.requiresTools && !model.supportsTools) {
      missingCapabilities.push("tools");
      reasons.push(`Model '${model.id}' does not support tool/function calling`);
    }

    if (requirements.requiresVision && !model.supportsVision) {
      missingCapabilities.push("vision");
      reasons.push(`Model '${model.id}' does not support multimodal vision inputs`);
    }

    if (requirements.requiresJsonSchema && !model.supportsJsonSchema) {
      missingCapabilities.push("json_schema");
      reasons.push(`Model '${model.id}' does not support structured JSON schema outputs`);
    }

    if (
      requirements.minContextLength !== undefined &&
      requirements.minContextLength > 0 &&
      model.contextWindow < requirements.minContextLength
    ) {
      missingCapabilities.push("context_length");
      reasons.push(
        `Model '${model.id}' context window (${model.contextWindow}) is smaller than required context length (${requirements.minContextLength})`
      );
    }

    if (
      requirements.maxOutputTokens !== undefined &&
      requirements.maxOutputTokens > 0 &&
      model.maxOutputTokens < requirements.maxOutputTokens
    ) {
      missingCapabilities.push("max_output_tokens");
      reasons.push(
        `Model '${model.id}' max output limit (${model.maxOutputTokens}) is smaller than requested output tokens (${requirements.maxOutputTokens})`
      );
    }

    if (
      requirements.provider !== undefined &&
      requirements.provider.trim().length > 0 &&
      model.provider.toLowerCase().trim() !== requirements.provider.toLowerCase().trim()
    ) {
      missingCapabilities.push("provider");
      reasons.push(
        `Model '${model.id}' provider '${model.provider}' does not match requested provider '${requirements.provider}'`
      );
    }

    if (
      requirements.maxCostPerMTokMicro !== undefined &&
      model.inputCostPerMTokMicro > requirements.maxCostPerMTokMicro
    ) {
      missingCapabilities.push("cost_limit");
      reasons.push(
        `Model '${model.id}' input cost (${model.inputCostPerMTokMicro} µ$) exceeds max allowed cost (${requirements.maxCostPerMTokMicro} µ$)`
      );
    }

    return {
      isCapable: missingCapabilities.length === 0,
      modelId: model.id,
      missingCapabilities,
      reasons,
    };
  }

  /**
   * Fast boolean check whether a model satisfies all requirements.
   */
  public isCapable(
    model: ModelDef<bigint>,
    requirements: CapabilityRequirements
  ): boolean {
    return this.checkCapabilities(model, requirements).isCapable;
  }

  // =========================================================================
  // Candidate Filtering & Cost-Optimal Sorting
  // =========================================================================

  /**
   * Filters a candidate list of models based on requirements, returning sorted viable candidates.
   * Default sorting is cost-optimal: cheapest input cost first, then cheapest output cost, then largest context window.
   */
  public filterCandidates(
    models: readonly ModelDef<bigint>[],
    requirements: CapabilityRequirements,
    options: FilterOptions = {}
  ): ModelDef<bigint>[] {
    const matched = models.filter((model) => this.isCapable(model, requirements));
    const sorted = this.sortCandidates(matched, options.sortBy ?? "cost-asc");

    if (sorted.length === 0 && options.throwIfEmpty) {
      const requiredCaps = this.getRequiredCapabilityNames(requirements);
      throw new CapabilityMismatchError(
        requiredCaps.length > 0 ? requiredCaps : ["unknown"],
        `No candidate model satisfied the required capabilities: [${requiredCaps.join(", ")}]`,
        {
          candidateModel: models[0]?.id,
          details: {
            candidatesEvaluated: models.length,
            requirements,
          },
        }
      );
    }

    return sorted;
  }

  /**
   * Filters candidate models and throws CapabilityMismatchError if no viable candidates remain.
   */
  public filterCandidatesOrThrow(
    models: readonly ModelDef<bigint>[],
    requirements: CapabilityRequirements,
    options: Omit<FilterOptions, "throwIfEmpty"> = {}
  ): ModelDef<bigint>[] {
    return this.filterCandidates(models, requirements, {
      ...options,
      throwIfEmpty: true,
    });
  }

  /**
   * Selects the single optimal (cheapest capable) model from candidate array.
   */
  public selectOptimalCandidate(
    models: readonly ModelDef<bigint>[],
    requirements: CapabilityRequirements
  ): ModelDef<bigint> | undefined {
    const candidates = this.filterCandidates(models, requirements, {
      sortBy: "cost-asc",
    });
    return candidates[0];
  }

  /**
   * Filters models registered in an injected ModelRegistry according to requirements.
   */
  public filterRegistry(
    requirements: CapabilityRequirements | unknown,
    options?: FilterOptions
  ): ModelDef<bigint>[] {
    if (!this.registry) {
      throw new Error(
        "filterRegistry() requires a ModelRegistry instance to have been provided to the CapabilityFilter constructor"
      );
    }
    const reqs = isCapabilityRequirements(requirements)
      ? requirements
      : this.extractRequirements(requirements);
    const models = this.registry.getAllModels(reqs.onlyActive ?? true);
    return this.filterCandidates(models, reqs, options);
  }

  /**
   * Universal filter method: accepts either an explicit model array or an incoming request,
   * evaluating against requirements and returning sorted viable candidates.
   */
  public filter(
    modelsOrRequest: readonly ModelDef<bigint>[] | unknown,
    requirementsOrOptions?: CapabilityRequirements | RequirementExtractionOptions
  ): ModelDef<bigint>[] {
    if (
      Array.isArray(modelsOrRequest) &&
      (modelsOrRequest.length === 0 || isModelDef(modelsOrRequest[0]))
    ) {
      const models = modelsOrRequest as readonly ModelDef<bigint>[];
      const reqs = isCapabilityRequirements(requirementsOrOptions)
        ? requirementsOrOptions
        : this.extractRequirements(requirementsOrOptions);
      return this.filterCandidates(models, reqs);
    }

    if (this.registry) {
      const reqs = isCapabilityRequirements(modelsOrRequest)
        ? modelsOrRequest
        : this.extractRequirements(
            modelsOrRequest,
            requirementsOrOptions as RequirementExtractionOptions
          );
      const activeModels = this.registry.getAllModels(reqs.onlyActive ?? true);
      return this.filterCandidates(activeModels, reqs);
    }

    throw new TypeError(
      "CapabilityFilter.filter requires either an array of models as first argument, or a ModelRegistry injected at constructor"
    );
  }

  // =========================================================================
  // Internal Helpers & Static Utilities
  // =========================================================================

  /**
   * Sorts candidate models by the chosen strategy.
   */
  private sortCandidates(
    candidates: ModelDef<bigint>[],
    strategy: ModelSortStrategy
  ): ModelDef<bigint>[] {
    const result = [...candidates];
    switch (strategy) {
      case "cost-asc":
        return result.sort((a, b) => {
          if (a.inputCostPerMTokMicro !== b.inputCostPerMTokMicro) {
            return a.inputCostPerMTokMicro < b.inputCostPerMTokMicro ? -1 : 1;
          }
          if (a.outputCostPerMTokMicro !== b.outputCostPerMTokMicro) {
            return a.outputCostPerMTokMicro < b.outputCostPerMTokMicro ? -1 : 1;
          }
          if (a.contextWindow !== b.contextWindow) {
            return b.contextWindow - a.contextWindow; // Larger context preferred as tie-breaker
          }
          return a.id.localeCompare(b.id);
        });
      case "cost-desc":
        return result.sort((a, b) => {
          if (a.inputCostPerMTokMicro !== b.inputCostPerMTokMicro) {
            return a.inputCostPerMTokMicro > b.inputCostPerMTokMicro ? -1 : 1;
          }
          return b.id.localeCompare(a.id);
        });
      case "context-desc":
        return result.sort((a, b) => {
          if (a.contextWindow !== b.contextWindow) {
            return b.contextWindow - a.contextWindow;
          }
          if (a.inputCostPerMTokMicro !== b.inputCostPerMTokMicro) {
            return a.inputCostPerMTokMicro < b.inputCostPerMTokMicro ? -1 : 1;
          }
          return a.id.localeCompare(b.id);
        });
      case "none":
      default:
        return result;
    }
  }

  /**
   * Converts a requirements object into a readable array of requirement tags.
   */
  private getRequiredCapabilityNames(requirements: CapabilityRequirements): string[] {
    const caps: string[] = [];
    if (requirements.requiresTools) caps.push("tools");
    if (requirements.requiresVision) caps.push("vision");
    if (requirements.requiresJsonSchema) caps.push("json_schema");
    if (requirements.requiresStreaming) caps.push("streaming");
    if (
      requirements.minContextLength !== undefined &&
      requirements.minContextLength > 0
    ) {
      caps.push(`context_length>=${requirements.minContextLength}`);
    }
    if (
      requirements.maxOutputTokens !== undefined &&
      requirements.maxOutputTokens > 0
    ) {
      caps.push(`max_output_tokens>=${requirements.maxOutputTokens}`);
    }
    if (requirements.provider) {
      caps.push(`provider=${requirements.provider}`);
    }
    if (requirements.maxCostPerMTokMicro !== undefined) {
      caps.push(`cost<=${requirements.maxCostPerMTokMicro}`);
    }
    return caps;
  }

  /**
   * Fast token estimator heuristic (~4 characters per token + framing overhead).
   * Supports strings, numbers, message arrays, parts, and objects.
   */
  public static estimateTokens(input: unknown): number {
    if (input === null || input === undefined) {
      return 0;
    }
    if (typeof input === "string") {
      if (input.length === 0) return 0;
      return Math.max(1, Math.ceil(input.length / 4));
    }
    if (typeof input === "number" || typeof input === "boolean") {
      return 1;
    }
    if (Array.isArray(input)) {
      let total = 0;
      for (const item of input) {
        total += CapabilityFilter.estimateTokens(item) + 4; // 4 tokens framing overhead per message/item
      }
      return total;
    }
    if (isRecord(input)) {
      // Message object with role/content
      if ("content" in input) {
        let msgTokens = 4; // Message frame overhead
        if (typeof input.role === "string") {
          msgTokens += Math.max(1, Math.ceil(input.role.length / 4));
        }
        if (input.content !== undefined) {
          msgTokens += CapabilityFilter.estimateTokens(input.content);
        }
        if ("name" in input && typeof input.name === "string") {
          msgTokens += Math.max(1, Math.ceil(input.name.length / 4));
        }
        if ("tool_calls" in input && Array.isArray(input.tool_calls)) {
          msgTokens += CapabilityFilter.estimateTokens(input.tool_calls);
        }
        return msgTokens;
      }
      // Multimodal image part
      if (input.type === "image_url" || input.type === "image") {
        return 800; // Standard nominal image tile token cost
      }
      // Text part
      if (input.type === "text" && typeof input.text === "string") {
        return Math.max(1, Math.ceil(input.text.length / 4));
      }
      // General structured schema / function definition
      try {
        const json = JSON.stringify(input);
        return Math.max(1, Math.ceil(json.length / 4));
      } catch {
        return 10;
      }
    }
    return 0;
  }

  // Singleton instance for static delegation
  private static readonly defaultFilter = new CapabilityFilter();

  /**
   * Static helper: filters candidate models.
   */
  public static filterCandidates(
    models: readonly ModelDef<bigint>[],
    requirements: CapabilityRequirements,
    options?: FilterOptions
  ): ModelDef<bigint>[] {
    return CapabilityFilter.defaultFilter.filterCandidates(models, requirements, options);
  }

  /**
   * Static helper: checks whether a model satisfies requirements.
   */
  public static isCapable(
    model: ModelDef<bigint>,
    requirements: CapabilityRequirements
  ): boolean {
    return CapabilityFilter.defaultFilter.isCapable(model, requirements);
  }

  /**
   * Static helper: checks model capabilities with detailed audit result.
   */
  public static checkCapabilities(
    model: ModelDef<bigint>,
    requirements: CapabilityRequirements
  ): CapabilityCheckResult {
    return CapabilityFilter.defaultFilter.checkCapabilities(model, requirements);
  }

  /**
   * Static helper: extracts requirements from request payload.
   */
  public static extractRequirements(
    request: unknown,
    options?: RequirementExtractionOptions
  ): CapabilityRequirements {
    return CapabilityFilter.defaultFilter.extractRequirements(request, options);
  }

  /**
   * Static helper: selects optimal (cheapest capable) candidate model.
   */
  public static selectOptimalCandidate(
    models: readonly ModelDef<bigint>[],
    requirements: CapabilityRequirements
  ): ModelDef<bigint> | undefined {
    return CapabilityFilter.defaultFilter.selectOptimalCandidate(models, requirements);
  }
}
