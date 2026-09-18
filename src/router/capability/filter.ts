/**
 * @file filter.ts
 * CapabilityFilter engine coordinating extraction, auditing, and sorting.
 */

import { ModelDef, isModelDef } from "../../types/models";
import { CapabilityMismatchError } from "../../errors/routing_errors";
import type { IModelRegistry } from "../registry/index";
import {
  CapabilityRequirements,
  CapabilityCheckResult,
  FilterOptions,
  RequirementExtractionOptions,
  isCapabilityRequirements,
} from "./types";
import { estimateTokens } from "./token_estimator";
import { extractRequirements } from "./extractor";
import { checkCapabilities, isCapable, getRequiredCapabilityNames } from "./auditor";
import { sortCandidates } from "./sorter";

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

  public extractRequirements(
    request: unknown,
    options?: RequirementExtractionOptions
  ): CapabilityRequirements {
    return extractRequirements(request, options);
  }

  // =========================================================================
  // Capability Validation
  // =========================================================================

  public checkCapabilities(
    model: ModelDef<bigint>,
    requirements: CapabilityRequirements
  ): CapabilityCheckResult {
    return checkCapabilities(model, requirements);
  }

  public isCapable(
    model: ModelDef<bigint>,
    requirements: CapabilityRequirements
  ): boolean {
    return isCapable(model, requirements);
  }

  // =========================================================================
  // Candidate Filtering & Cost-Optimal Sorting
  // =========================================================================

  public filterCandidates(
    models: readonly ModelDef<bigint>[],
    requirements: CapabilityRequirements,
    options: FilterOptions = {}
  ): ModelDef<bigint>[] {
    const matched = models.filter((model) => this.isCapable(model, requirements));
    const sorted = sortCandidates(matched, options.sortBy ?? "cost-asc");

    if (sorted.length === 0 && options.throwIfEmpty) {
      const requiredCaps = getRequiredCapabilityNames(requirements);
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

  public selectOptimalCandidate(
    models: readonly ModelDef<bigint>[],
    requirements: CapabilityRequirements
  ): ModelDef<bigint> | undefined {
    const candidates = this.filterCandidates(models, requirements, {
      sortBy: "cost-asc",
    });
    return candidates[0];
  }

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

  public static estimateTokens(input: unknown): number {
    return estimateTokens(input);
  }

  // Singleton instance for static delegation
  private static readonly defaultFilter = new CapabilityFilter();

  public static filterCandidates(
    models: readonly ModelDef<bigint>[],
    requirements: CapabilityRequirements,
    options?: FilterOptions
  ): ModelDef<bigint>[] {
    return CapabilityFilter.defaultFilter.filterCandidates(models, requirements, options);
  }

  public static isCapable(
    model: ModelDef<bigint>,
    requirements: CapabilityRequirements
  ): boolean {
    return CapabilityFilter.defaultFilter.isCapable(model, requirements);
  }

  public static checkCapabilities(
    model: ModelDef<bigint>,
    requirements: CapabilityRequirements
  ): CapabilityCheckResult {
    return CapabilityFilter.defaultFilter.checkCapabilities(model, requirements);
  }

  public static extractRequirements(
    request: unknown,
    options?: RequirementExtractionOptions
  ): CapabilityRequirements {
    return CapabilityFilter.defaultFilter.extractRequirements(request, options);
  }

  public static selectOptimalCandidate(
    models: readonly ModelDef<bigint>[],
    requirements: CapabilityRequirements
  ): ModelDef<bigint> | undefined {
    return CapabilityFilter.defaultFilter.selectOptimalCandidate(models, requirements);
  }
}
