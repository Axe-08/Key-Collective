/**
 * @file types.ts
 * Capability Filter domain types and contracts.
 */

import { ModelProvider } from "../../types/models";

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
export function isRecord(value: unknown): value is Record<string, unknown> {
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
