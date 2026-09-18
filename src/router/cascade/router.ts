/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Cascade Router Subsystem: Main CascadeRouter Class
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

import type { RouteRequest, RouterContract } from "../../contracts/router";
import type { KeyPoolContract } from "../../contracts/key_pool";
import {
  type IModelRegistry,
  ModelRegistry,
} from "../registry/index";
import { CapabilityFilter } from "../capability/index";
import { UpstreamClient } from "../../proxy/upstream/index";
import type { ModelDef } from "../../types/models";
import type {
  CascadeRouteRequest,
  CascadeRouteResponse,
  CascadeRouterOptions,
} from "./types";
import {
  resolveCandidates,
  selectPrimaryCandidate,
  selectFallbackCandidates,
} from "./evaluator";
import { executeCascadeRouting } from "./fallback";

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

  /**
   * Checks whether self-provided keys are configured for this provider & tenant.
   */
  public async checkSelfKeyAvailable(
    provider: string,
    tenantId: string
  ): Promise<boolean> {
    if (!this.keyPool) return false;
    try {
      const keyId = await this.keyPool.getKey(provider);
      return keyId !== null && keyId !== undefined;
    } catch {
      return false;
    }
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
    return resolveCandidates(request, {
      registry: this.registry,
      capabilityFilter: this.capabilityFilter,
      sortBy: this.options.sortBy,
      fallbackModels: this.options.fallbackModels,
      allowMismatchEscalation: this.options.allowMismatchEscalation,
    });
  }

  /**
   * Returns the primary (first-choice) model candidate that would be attempted.
   */
  public selectPrimaryModel(request: RouteRequest | CascadeRouteRequest): ModelDef<bigint> {
    const candidates = this.getCandidates(request);
    return selectPrimaryCandidate(candidates);
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
    return selectFallbackCandidates(candidates, maxFallbacks);
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
    const candidates = this.getCandidates(request);
    return executeCascadeRouting(request, candidates, {
      registry: this.registry,
      upstreamClient: this.upstreamClient,
      keyPool: this.keyPool,
      maxFallbacks: this.maxFallbacks,
      options: this.options,
      checkSelfKeyAvailable: (provider, tenantId) =>
        this.checkSelfKeyAvailable(provider, tenantId),
    });
  }
}
