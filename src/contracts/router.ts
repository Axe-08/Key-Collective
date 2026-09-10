/**
 * Model registry entities, routing contracts, and decision types.
 *
 * Invariants:
 * - Fixed-Point Microdollars: All costs in int64 microdollars (1 USD = 1,000,000 µ$).
 *   Enforced using `bigint` for zero floating-point math precision loss.
 * - Strict typing: No `any` types.
 */

/**
 * Known upstream model providers supported by the routing engine.
 */
export type Provider = "gemini" | "groq" | "openai" | "anthropic" | string;

/**
 * ModelDef defines capabilities, pricing, and metadata of an AI model in the registry.
 */
export interface ModelDef {
  id: string;
  provider: Provider;
  logical_aliases?: string[];
  context_window?: number;
  max_output_tokens?: number;
  input_cost_per_mtok_micro: bigint;
  output_cost_per_mtok_micro: bigint;
  cache_read_cost_per_mtok_micro?: bigint;
  supports_tools: boolean;
  supports_vision?: boolean;
  supports_json_schema?: boolean;
  deprecated_at?: string | null;
  sunset_at?: string | null;
  is_active?: boolean;
  last_synced_at?: string;
}

/**
 * RouterDecision captures the decision reasoning and outcome of the routing engine.
 */
export interface RouterDecision {
  model_id?: string;
  provider?: Provider;
  selected_key_id?: string;
  selected_model_id?: string;
  tenant_id?: string;
  capability_filter_passed?: boolean;
  reason?: string;
  estimated_cost_micro?: bigint;
  fallback_models?: string[];

  // Compatibility aliases
  selectedKeyId?: string;
  selectedModelId?: string;
  tenantId?: string;
  capabilityFilterPassed?: boolean;
}

/**
 * Request payload for cascade routing.
 */
export interface RouteRequest {
  modelAlias: string;
  messages: unknown[];
  stream: boolean;
}

/**
 * Response payload from cascade routing.
 */
export interface RouteResponse {
  content: string;
  costMicrodollars: bigint;
}

/**
 * Contract for router implementations.
 */
export interface RouterContract {
  route(request: RouteRequest): Promise<RouteResponse>;
}
