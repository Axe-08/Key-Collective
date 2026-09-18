/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Cascade Router Subsystem: Capability Evaluator & Candidate Selection
 *
 * Conforms to:
 * - LLD 2.3: Evaluates capabilities, resolves aliases, filters and sorts models.
 * - Golden Test tc-05: Context window check produces ContextWindowExceededError (HTTP 400).
 * - Golden Test tc-06: Model alias resolution (e.g. 'smart-fast' -> 'gemini-2.0-flash').
 * - Golden Test tc-07: Capability filter excludes unsupported models when tools/vision requested.
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no `any`).
 * - Fixed-Point Microdollars: All sorting and cost operations use bigint microdollars.
 */

import type { RouteRequest } from "../../contracts/router";
import type { CascadeRouteRequest } from "./types";
import {
  type IModelRegistry,
  ContextWindowExceededError,
} from "../registry/index";
import {
  type CapabilityFilter,
  type CapabilityRequirements,
  type ModelSortStrategy,
} from "../capability/index";
import type { ModelDef } from "../../types/models";
import {
  NoAvailableProviderError,
  CapabilityMismatchError,
  ModelNotFoundError,
} from "../../errors";

/**
 * Context configuration required to resolve candidate models.
 */
export interface CandidateResolutionContext {
  registry: IModelRegistry;
  capabilityFilter: CapabilityFilter;
  sortBy?: ModelSortStrategy;
  fallbackModels?: readonly string[];
  allowMismatchEscalation?: boolean;
}

/**
 * Checks whether an alias string signifies generic auto/cascade routing.
 */
export function isGenericRoutingKeyword(alias: string): boolean {
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
 * Formats missing capability names for descriptive error reporting.
 */
export function getCapabilityNames(reqs: CapabilityRequirements): string[] {
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

/**
 * Resolves the ordered list of candidate models for a request based on
 * capability requirements, alias resolution, and cost-optimal sorting.
 *
 * @param request Inbound route request
 * @param context Dependencies and configuration for resolution
 * @returns Non-empty ordered array of capable candidate models
 * @throws ContextWindowExceededError (HTTP 400) if prompt tokens exceed context window
 * @throws CapabilityMismatchError (HTTP 400) if required capabilities are unsatisfied
 * @throws ModelNotFoundError (HTTP 404) if requested explicit model alias does not exist
 * @throws NoAvailableProviderError (HTTP 503) if no providers can fulfill request
 */
export function resolveCandidates(
  request: RouteRequest | CascadeRouteRequest,
  context: CandidateResolutionContext
): ModelDef<bigint>[] {
  const alias = (request.modelAlias ?? "").trim();
  const reqOptions = request as CascadeRouteRequest;

  // 1. Extract required capabilities from request
  const requirements = context.capabilityFilter.extractRequirements(request, {
    estimatedPromptTokens: reqOptions.estimatedPromptTokens,
  });

  // 2. Handle generic auto / cheapest / cascade routing keyword
  if (isGenericRoutingKeyword(alias)) {
    const candidates = context.capabilityFilter.filterRegistry(requirements, {
      sortBy: context.sortBy ?? "cost-asc",
    });

    if (candidates.length === 0) {
      const missingCaps = getCapabilityNames(requirements);
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
  const targetModel = context.registry.resolveModel(alias);
  if (!targetModel) {
    const allActive = context.registry.getAllModels(true).map((m) => m.id);
    throw new ModelNotFoundError(
      alias,
      `Model or alias '${alias}' not found in registry`,
      { availableModels: allActive }
    );
  }

  // 4. Validate target model against capability requirements
  const audit = context.capabilityFilter.checkCapabilities(targetModel, requirements);
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
    if (!context.allowMismatchEscalation) {
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
    reqOptions.fallbackModels ?? context.fallbackModels ?? [];
  for (const fallbackIdOrAlias of explicitFallbacks) {
    const fallbackModel = context.registry.resolveModel(fallbackIdOrAlias);
    if (
      fallbackModel &&
      !seenModelIds.has(fallbackModel.id) &&
      context.capabilityFilter.isCapable(fallbackModel, requirements)
    ) {
      candidates.push(fallbackModel);
      seenModelIds.add(fallbackModel.id);
    }
  }

  // 7. Append remaining capable models from registry sorted by cost
  const remainingCapable = context.capabilityFilter.filterRegistry(requirements, {
    sortBy: context.sortBy ?? "cost-asc",
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
      "No capable candidate models available for request"
    );
  }

  return candidates;
}

/**
 * Returns the primary (first-choice) model candidate that would be attempted.
 */
export function selectPrimaryCandidate(candidates: ModelDef<bigint>[]): ModelDef<bigint> {
  return candidates[0];
}

/**
 * Returns the fallback candidate models for a request (excluding the primary).
 */
export function selectFallbackCandidates(
  candidates: ModelDef<bigint>[],
  maxFallbacks: number
): ModelDef<bigint>[] {
  return candidates.slice(1, 1 + maxFallbacks);
}
