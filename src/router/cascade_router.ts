/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Cascade Router Module (router-cascade-router)
 *
 * Conforms to:
 * - LLD 2.3: Orchestrates multi-model cascade routing.
 *   - Implements RouterContract (`route(request)` method).
 *   - Selects the cheapest capable model using CapabilityFilter and ModelRegistry.
 *   - Implements fallback mechanisms and escalation on failure (rate limits, provider downtime, timeouts).
 *   - Interfaces with KeyPoolContract to obtain provider keys and record results/usage.
 * - Golden Test tc-01: Routes requests to provider keys with success 200 response and cost calculation.
 * - Golden Test tc-05: Rejects prompt if estimated tokens exceed model context window (HTTP 400).
 * - Golden Test tc-06: Model alias resolution (e.g. 'smart-fast' -> 'gemini-2.0-flash').
 * - Golden Test tc-07: Capability filter excludes unsupported models when tools/vision requested.
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no `any`).
 * - Fixed-Point Microdollars: All pricing calculations utilize int64 / bigint microdollars (1 USD = 1,000,000 µ$). Zero floating-point math.
 * - Non-blocking hot path: Non-blocking telemetry and key result recording.
 */

import type { RouteRequest, RouteResponse, RouterContract } from "../contracts/router";
import type { KeyPoolContract } from "../contracts/key_pool";
import {
  IModelRegistry,
  ModelRegistry,
  ContextWindowExceededError,
} from "./model_registry";
import {
  CapabilityFilter,
  CapabilityRequirements,
  ModelSortStrategy,
} from "./capability_filter";
import {
  UpstreamClient,
  UpstreamChatRequest,
  UpstreamResponse,
} from "../proxy/upstream_client";
import type { StreamUsage } from "../proxy/sse_transformer";
import { ModelDef } from "../types/models";
import {
  FallbackExhaustedError,
  FallbackAttempt,
  NoAvailableProviderError,
  CapabilityMismatchError,
  ModelNotFoundError,
} from "../errors";

/**
 * Extended request options accepted by CascadeRouter.
 */
export interface CascadeRouteRequest extends RouteRequest {
  /** Target model identifier, logical alias, or generic routing keyword ("auto" | "cheapest" | "cascade") */
  modelAlias: string;
  /** Chat messages array */
  messages: unknown[];
  /** Whether to stream response chunks */
  stream: boolean;

  /** Sampling temperature (0.0 - 2.0) */
  temperature?: number;
  /** Maximum completion output tokens */
  maxTokens?: number;
  max_tokens?: number;
  max_completion_tokens?: number;

  /** Tool / function calling schemas */
  tools?: unknown[];
  functions?: unknown[];
  tool_choice?: unknown;
  function_call?: unknown;

  /** Structured output / JSON schema format */
  response_format?: unknown;
  /** System prompt override */
  system?: unknown;

  /** Explicit pre-calculated prompt token count */
  estimatedPromptTokens?: number;

  /** Explicit API key override for this request (bypasses KeyPool) */
  apiKey?: string;
  /** Explicit list of fallback model candidate IDs in priority order */
  fallbackModels?: readonly string[];
  /** Maximum fallback attempts for this request override */
  maxFallbacks?: number;

  /** Upstream request timeout in milliseconds */
  timeoutMs?: number;
  /** AbortSignal for request cancellation */
  signal?: AbortSignal;
  /** Additional HTTP headers forwarded to upstream */
  headers?: HeadersInit | Record<string, string>;
  /** Provider-specific extra request body fields */
  extraBodyParams?: Record<string, unknown>;
}

/**
 * Detailed routing result returned by CascadeRouter.
 */
export interface CascadeRouteResponse extends RouteResponse {
  /** Extracted completion content text (or empty string if stream=true) */
  content: string;
  /** Authoritative transaction cost in microdollars (bigint) */
  costMicrodollars: bigint;
  /** Canonical model ID that fulfilled the request */
  model: string;
  /** Upstream provider that fulfilled the request */
  provider: string;
  /** Model definition of the model that fulfilled the request */
  modelDef: ModelDef<bigint>;
  /** Prior failed routing attempts leading up to this success */
  attempts: FallbackAttempt[];
  /** Authoritative token usage extracted from stream or response payload */
  usage: StreamUsage | null;
  /** Full underlying UpstreamResponse (contains transformed stream body if stream=true) */
  response?: UpstreamResponse;
}

/**
 * Options configuring CascadeRouter instantiation.
 */
export interface CascadeRouterOptions {
  /** Injected ModelRegistry instance (defaults to standard ModelRegistry with DEFAULT_MODEL_DEFINITIONS) */
  registry?: IModelRegistry;
  /** Injected CapabilityFilter instance (defaults to new CapabilityFilter(this.registry)) */
  capabilityFilter?: CapabilityFilter;
  /** Injected UpstreamClient instance (defaults to new UpstreamClient({ keyPool, costCalculator })) */
  upstreamClient?: UpstreamClient;
  /** KeyPoolContract instance to obtain and record keys */
  keyPool?: KeyPoolContract;
  /** Maximum fallback candidate models to attempt upon failure (default: 3) */
  maxFallbacks?: number;
  /** Default fallback model candidate IDs in priority order */
  fallbackModels?: readonly string[];
  /** Default candidate sorting strategy (default: "cost-asc") */
  sortBy?: ModelSortStrategy;
  /**
   * If true, allows falling back to other capable models when the explicitly requested
   * model lacks capabilities (e.g. tools or vision). Default is false (throws CapabilityMismatchError).
   */
  allowMismatchEscalation?: boolean;
  /** Default max completion output tokens */
  defaultMaxTokens?: number;
  /** Default sampling temperature */
  defaultTemperature?: number;
  /** Extra body parameters passed to all upstream calls */
  extraBodyParams?: Record<string, unknown>;
  /** Callback fired whenever a candidate fails and router escalates to the next model */
  onFallback?: (attempt: FallbackAttempt, nextModel?: ModelDef<bigint>) => void;
  /** Callback fired upon a successful route */
  onSuccess?: (response: CascadeRouteResponse) => void;
}

/**
 * Checks whether an alias string signifies generic auto/cascade routing.
 */
function isGenericRoutingKeyword(alias: string): boolean {
  const clean = alias.toLowerCase().trim();
  return (
    clean === "" ||
    clean === "auto" ||
    clean === "cheapest" ||
    clean === "default" ||
    clean === "cascade"
  );
}

/**
 * Type guard for CascadeRouteResponse.
 */
export function isCascadeRouteResponse(value: unknown): value is CascadeRouteResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    "costMicrodollars" in value &&
    "model" in value &&
    "provider" in value &&
    "attempts" in value &&
    Array.isArray((value as Record<string, unknown>).attempts)
  );
}

/**
 * Type guard for CascadeRouteRequest.
 */
export function isCascadeRouteRequest(value: unknown): value is CascadeRouteRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "modelAlias" in value &&
    typeof (value as Record<string, unknown>).modelAlias === "string" &&
    "messages" in value &&
    Array.isArray((value as Record<string, unknown>).messages) &&
    "stream" in value &&
    typeof (value as Record<string, unknown>).stream === "boolean"
  );
}

/**
 * CascadeRouter implements multi-model cascade routing and fallback escalation.
 *
 * It combines ModelRegistry, CapabilityFilter, and UpstreamClient to:
 * 1. Filter viable candidate models by context window, tools, vision, and schemas.
 * 2. Select the cost-optimal (cheapest) model as primary candidate.
 * 3. Acquire credentials from KeyPool.
 * 4. Escalate transparently across fallback candidates when upstream errors occur
 *    (e.g. HTTP 429 rate limits, 503 circuit breakers, timeouts, or service degradation).
 */
export class CascadeRouter implements RouterContract {
  private readonly registry: IModelRegistry;
  private readonly capabilityFilter: CapabilityFilter;
  private readonly upstreamClient: UpstreamClient;
  private readonly keyPool?: KeyPoolContract;
  private readonly maxFallbacks: number;
  private readonly options: CascadeRouterOptions;

  constructor(options: CascadeRouterOptions = {}) {
    this.options = options;
    this.registry = options.registry ?? new ModelRegistry();
    this.capabilityFilter =
      options.capabilityFilter ?? new CapabilityFilter(this.registry);
    this.keyPool = options.keyPool;
    this.maxFallbacks = options.maxFallbacks ?? 5;
    this.upstreamClient =
      options.upstreamClient ??
      new UpstreamClient({
        keyPool: this.keyPool,
        costCalculator: (model, usage) => {
          try {
            return this.registry.calculateCost(model, usage);
          } catch {
            return 0n;
          }
        },
      });
  }

  // =========================================================================
  // Accessors
  // =========================================================================

  /**
   * Returns the underlying ModelRegistry.
   */
  public getRegistry(): IModelRegistry {
    return this.registry;
  }

  /**
   * Returns the underlying CapabilityFilter.
   */
  public getCapabilityFilter(): CapabilityFilter {
    return this.capabilityFilter;
  }

  /**
   * Returns the underlying UpstreamClient.
   */
  public getUpstreamClient(): UpstreamClient {
    return this.upstreamClient;
  }

  /**
   * Returns the injected KeyPoolContract, if configured.
   */
  public getKeyPool(): KeyPoolContract | undefined {
    return this.keyPool;
  }

  // =========================================================================
  // Candidate Resolution & Pre-Flight Planning
  // =========================================================================

  /**
   * Resolves the ordered list of candidate models for a request based on
   * capability requirements, alias resolution, and cost-optimal sorting.
   *
   * @param request Inbound route request
   * @returns Non-empty ordered array of capable candidate models
   * @throws ContextWindowExceededError (HTTP 400) if prompt tokens exceed context window
   * @throws CapabilityMismatchError (HTTP 400) if required capabilities are unsatisfied
   * @throws ModelNotFoundError (HTTP 404) if requested explicit model alias does not exist
   * @throws NoAvailableProviderError (HTTP 503) if no providers can fulfill request
   */
  public getCandidates(request: RouteRequest | CascadeRouteRequest): ModelDef<bigint>[] {
    const alias = (request.modelAlias ?? "").trim();
    const reqOptions = request as CascadeRouteRequest;

    // 1. Extract required capabilities from request
    const requirements = this.capabilityFilter.extractRequirements(request, {
      estimatedPromptTokens: reqOptions.estimatedPromptTokens,
    });

    // 2. Handle generic auto / cheapest / cascade routing keyword
    if (isGenericRoutingKeyword(alias)) {
      const candidates = this.capabilityFilter.filterRegistry(requirements, {
        sortBy: this.options.sortBy ?? "cost-asc",
      });

      if (candidates.length === 0) {
        const missingCaps = this.getCapabilityNames(requirements);
        if (missingCaps.length > 0) {
          throw new CapabilityMismatchError(
            missingCaps,
            `No available model satisfied required capabilities: [${missingCaps.join(", ")}]`
          );
        }
        throw new NoAvailableProviderError(
          "No active models found in registry to fulfill routing request"
        );
      }

      return candidates;
    }

    // 3. Resolve explicit model ID or logical alias
    const targetModel = this.registry.resolveModel(alias);
    if (!targetModel) {
      const allActive = this.registry.getAllModels(true).map((m) => m.id);
      throw new ModelNotFoundError(
        alias,
        `Model or alias '${alias}' not found in registry`,
        { availableModels: allActive }
      );
    }

    // 4. Validate target model against capability requirements
    const audit = this.capabilityFilter.checkCapabilities(targetModel, requirements);
    if (!audit.isCapable) {
      // Golden Test tc-05: Context window check produces ContextWindowExceededError (HTTP 400)
      if (audit.missingCapabilities.includes("context_length")) {
        throw new ContextWindowExceededError(
          targetModel.id,
          targetModel.contextWindow,
          requirements.minContextLength ?? 0
        );
      }

      // If mismatch escalation is disabled (default), fail fast (tc-07)
      if (!this.options.allowMismatchEscalation) {
        throw new CapabilityMismatchError(
          audit.missingCapabilities,
          `Model '${targetModel.id}' does not satisfy required capabilities: [${audit.missingCapabilities.join(", ")}]`,
          { candidateModel: targetModel.id }
        );
      }
    }

    // 5. Target model is viable as primary candidate (if capable)
    const candidates: ModelDef<bigint>[] = [];
    const seenModelIds = new Set<string>();

    if (audit.isCapable) {
      candidates.push(targetModel);
      seenModelIds.add(targetModel.id);
    }

    // 6. Append explicit fallback candidates if specified
    const explicitFallbacks =
      reqOptions.fallbackModels ?? this.options.fallbackModels ?? [];
    for (const fallbackIdOrAlias of explicitFallbacks) {
      const fallbackModel = this.registry.resolveModel(fallbackIdOrAlias);
      if (
        fallbackModel &&
        !seenModelIds.has(fallbackModel.id) &&
        this.capabilityFilter.isCapable(fallbackModel, requirements)
      ) {
        candidates.push(fallbackModel);
        seenModelIds.add(fallbackModel.id);
      }
    }

    // 7. Append remaining capable models from registry sorted by cost
    const remainingCapable = this.capabilityFilter.filterRegistry(requirements, {
      sortBy: this.options.sortBy ?? "cost-asc",
    });

    for (const model of remainingCapable) {
      if (!seenModelIds.has(model.id)) {
        candidates.push(model);
        seenModelIds.add(model.id);
      }
    }

    if (candidates.length === 0) {
      throw new CapabilityMismatchError(
        audit.missingCapabilities,
        `No capable candidate models available for request`
      );
    }

    return candidates;
  }

  /**
   * Returns the primary (first-choice) model candidate that would be attempted.
   */
  public selectPrimaryModel(request: RouteRequest | CascadeRouteRequest): ModelDef<bigint> {
    const candidates = this.getCandidates(request);
    return candidates[0];
  }

  /**
   * Returns the fallback candidate models for a request (excluding the primary).
   */
  public getFallbackCandidates(
    request: RouteRequest | CascadeRouteRequest
  ): ModelDef<bigint>[] {
    const candidates = this.getCandidates(request);
    const reqOptions = request as CascadeRouteRequest;
    const maxFallbacks = reqOptions.maxFallbacks ?? this.maxFallbacks;
    return candidates.slice(1, 1 + maxFallbacks);
  }

  // =========================================================================
  // Core Routing & Fallback Escalation (RouterContract)
  // =========================================================================

  /**
   * Routes an incoming request to upstream models with transparent fallback escalation.
   *
   * @param request RouteRequest or CascadeRouteRequest
   * @returns Promise resolving to CascadeRouteResponse with content, cost, and metadata
   * @throws FallbackExhaustedError (HTTP 502) if primary and all fallbacks fail
   * @throws ContextWindowExceededError (HTTP 400) if context window exceeded
   * @throws CapabilityMismatchError (HTTP 400) if required capabilities missing
   */
  public async route(
    request: RouteRequest | CascadeRouteRequest
  ): Promise<CascadeRouteResponse> {
    // 1. Resolve ordered candidate models
    const candidates = this.getCandidates(request);
    const reqOptions = request as CascadeRouteRequest;
    const maxFallbacks = reqOptions.maxFallbacks ?? this.maxFallbacks;
    const candidatesToTry = candidates.slice(0, 1 + maxFallbacks);

    const attempts: FallbackAttempt[] = [];

    // 2. Iterate through candidates with fallback escalation
    for (let i = 0; i < candidatesToTry.length; i++) {
      const candidate = candidatesToTry[i];
      const nextCandidate = candidatesToTry[i + 1];

      // Check external abort signal
      if (reqOptions.signal?.aborted) {
        throw new DOMException("Request was aborted", "AbortError");
      }

      let apiKey = reqOptions.apiKey;
      let keyId: string | undefined;

      // 3. Acquire key from KeyPool if available and no explicit key supplied
      if (!apiKey && this.keyPool) {
        try {
          keyId = await this.keyPool.getKey(candidate.provider);
          apiKey = keyId;
        } catch (keyErr) {
          const errMsg = keyErr instanceof Error ? keyErr.message : String(keyErr);
          const attempt: FallbackAttempt = {
            provider: candidate.provider,
            modelId: candidate.id,
            error: `Key acquisition failed: ${errMsg}`,
          };
          attempts.push(attempt);
          this.options.onFallback?.(attempt, nextCandidate);
          continue; // Escalate immediately to next candidate model
        }
      }

      // 4. Construct upstream chat request
      const maxTokens =
        reqOptions.maxTokens ??
        reqOptions.max_tokens ??
        reqOptions.max_completion_tokens ??
        this.options.defaultMaxTokens;

      const chatRequest: UpstreamChatRequest = {
        provider: candidate.provider,
        model: candidate.id,
        messages: request.messages,
        stream: request.stream,
        apiKey,
        keyId,
        temperature: reqOptions.temperature ?? this.options.defaultTemperature,
        maxTokens,
        headers: reqOptions.headers,
        timeoutMs: reqOptions.timeoutMs,
        extraBodyParams: {
          ...this.options.extraBodyParams,
          ...reqOptions.extraBodyParams,
          ...(reqOptions.tools ? { tools: reqOptions.tools } : {}),
          ...(reqOptions.functions ? { functions: reqOptions.functions } : {}),
          ...(reqOptions.tool_choice ? { tool_choice: reqOptions.tool_choice } : {}),
          ...(reqOptions.function_call ? { function_call: reqOptions.function_call } : {}),
          ...(reqOptions.response_format
            ? { response_format: reqOptions.response_format }
            : {}),
        },
      };

      // 5. Execute call via UpstreamClient
      try {
        const chatRes = await this.upstreamClient.chat(chatRequest);

        // 6. Calculate or verify fixed-point microdollar cost
        let costMicrodollars = chatRes.costMicrodollars;
        if ((costMicrodollars === 0n || costMicrodollars === undefined) && chatRes.usage) {
          try {
            costMicrodollars = this.registry.calculateCost(candidate.id, chatRes.usage);
          } catch {
            costMicrodollars = 0n;
          }
        }

        // 7. Record KeyPool success and usage (non-blocking hot path)
        if (this.keyPool && keyId) {
          this.keyPool.recordResult(keyId, true).catch(() => {});
          if (costMicrodollars > 0n) {
            this.keyPool.recordUsage(keyId, costMicrodollars).catch(() => {});
          }
        }

        // 8. Build success response
        const successResponse: CascadeRouteResponse = {
          content: chatRes.content,
          costMicrodollars,
          model: candidate.id,
          provider: candidate.provider,
          modelDef: candidate,
          attempts,
          usage: chatRes.usage,
          response: chatRes.response,
        };

        this.options.onSuccess?.(successResponse);
        return successResponse;
      } catch (upstreamErr) {
        // Respect external cancellation without fallback loop
        if (
          upstreamErr instanceof Error &&
          (upstreamErr.name === "AbortError" || reqOptions.signal?.aborted)
        ) {
          throw upstreamErr;
        }

        // Record failure against KeyPool (non-blocking)
        if (this.keyPool && keyId) {
          this.keyPool.recordResult(keyId, false).catch(() => {});
        }

        const errMsg =
          upstreamErr instanceof Error ? upstreamErr.message : String(upstreamErr);

        const attempt: FallbackAttempt = {
          provider: candidate.provider,
          modelId: candidate.id,
          error: errMsg,
        };
        attempts.push(attempt);
        this.options.onFallback?.(attempt, nextCandidate);

        // Loop continues to attempt nextCandidate
      }
    }

    // 9. All candidate routes exhausted
    throw new FallbackExhaustedError(
      attempts,
      `Cascade routing exhausted all ${attempts.length} candidate route(s) without success`
    );
  }

  // =========================================================================
  // Internal Helpers
  // =========================================================================

  /**
   * Helper to format missing capability names for error reporting.
   */
  private getCapabilityNames(reqs: CapabilityRequirements): string[] {
    const list: string[] = [];
    if (reqs.requiresTools) list.push("tools");
    if (reqs.requiresVision) list.push("vision");
    if (reqs.requiresJsonSchema) list.push("json_schema");
    if (reqs.minContextLength !== undefined && reqs.minContextLength > 0) {
      list.push("context_length");
    }
    if (reqs.maxOutputTokens !== undefined && reqs.maxOutputTokens > 0) {
      list.push("max_output_tokens");
    }
    return list;
  }
}
