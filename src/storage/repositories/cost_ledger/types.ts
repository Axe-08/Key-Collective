/**
 * Key Collective v2 — Cost Ledger Types, DTOs & Invariants
 *
 * Invariants (GEMINI.md Constitution):
 * - Strict mode TypeScript, no `any`.
 * - Fixed-Point Microdollars: All costs in `int64` / `bigint` microdollars (1 USD = 1,000,000 µ$).
 *   Zero floating-point math for financials.
 * - Per-Tenant Isolation: Explicit `tenant_id` boundaries on all models.
 */

import type { CostLedgerEvent, ModelProvider } from "../../../types/models";

// Re-export CostLedgerEvent from models
export type { CostLedgerEvent };

/**
 * Input payload for recording a single transaction in the cost ledger.
 */
export interface CostLedgerEventInput {
  /** Optional event ID. If omitted, a cryptographically secure UUID is generated. */
  id?: string;
  /** Request correlation ID */
  requestId: string;
  /** Tenant ID initiating the request */
  tenantId: string;
  /** Key ID used for upstream dispatch */
  keyId: string;
  /** Model provider invoked */
  provider: ModelProvider | string;
  /** Model ID invoked */
  modelId: string;
  /** Number of prompt/input tokens */
  promptTokens?: number;
  /** Number of completion/output tokens */
  completionTokens?: number;
  /** Number of cached tokens read from cache */
  cachedTokens?: number;
  /** Number of reasoning/thought tokens */
  reasoningTokens?: number;
  /** Transaction cost in int64 microdollars (must be integer, zero floating-point) */
  costMicrodollars: bigint | number;
  /** Upstream latency in milliseconds */
  latencyMs?: number;
  /** HTTP status code returned by upstream */
  statusCode: number;
  /** ISO-8601 creation timestamp or Date instance (defaults to current time) */
  createdAt?: string | Date;
}

/**
 * Aggregated daily spend metrics for a specific tenant, day, provider, and model.
 * Conforms to D1 daily_spend_rollup schema.
 */
export interface DailySpendRollup<TCost = bigint> {
  /** Tenant ID owning the rollup */
  tenantId: string;
  /** Calendar date in ISO format YYYY-MM-DD */
  day: string;
  /** Model provider */
  provider: ModelProvider | string;
  /** Model ID */
  modelId: string;
  /** Total number of requests */
  totalRequests: number;
  /** Total tokens processed (prompt + completion + reasoning) */
  totalTokens: number;
  /** Total financial spend in int64 microdollars */
  totalCostMicrodollars: TCost;
}

/**
 * Input payload for updating or incrementing a daily spend rollup.
 */
export interface DailySpendRollupInput {
  tenantId: string;
  day: string | Date;
  provider: ModelProvider | string;
  modelId: string;
  /** Requests delta to increment (defaults to 1) */
  requestsDelta?: number;
  /** Tokens delta to increment (defaults to 0) */
  tokensDelta?: number;
  /** Cost delta in int64 microdollars to increment (must be integer) */
  costMicrodollarsDelta: bigint | number;
}

/**
 * Query filtering and pagination options for cost ledger event queries.
 */
export interface ListCostEventsOptions {
  /** Filter events created on or after this timestamp */
  since?: string | Date;
  /** Filter events created on or before this timestamp */
  until?: string | Date;
  /** Filter by model provider */
  provider?: string;
  /** Filter by model ID */
  modelId?: string;
  /** Filter by API key ID */
  keyId?: string;
  /** Maximum number of records to return (default 100, max 1000) */
  limit?: number;
  /** Number of records to skip for pagination */
  offset?: number;
  /** Sort order by created_at timestamp (default "DESC") */
  order?: "ASC" | "DESC";
}

/**
 * Query filtering options for daily spend rollup queries.
 */
export interface ListDailyRollupsOptions {
  /** Filter rollups on or after this date (YYYY-MM-DD) */
  startDate?: string | Date;
  /** Filter rollups on or before this date (YYYY-MM-DD) */
  endDate?: string | Date;
  /** Filter by model provider */
  provider?: string;
  /** Filter by model ID */
  modelId?: string;
  /** Maximum records to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort order by day (default "DESC") */
  order?: "ASC" | "DESC";
}

/**
 * Aggregated summary of tenant spending across a timeframe.
 */
export interface TenantSpendSummary {
  tenantId: string;
  totalCostMicrodollars: bigint;
  totalRequests: number;
  totalTokens: number;
  periodStart?: string;
  periodEnd?: string;
}

/**
 * Internal interface representing raw database row from `cost_ledger`.
 */
export interface CostLedgerDbRow {
  id: string;
  request_id: string;
  tenant_id: string;
  key_id: string;
  provider: string;
  model_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  cost_microdollars: number | string | bigint;
  latency_ms: number;
  status_code: number;
  created_at: string;
}

/**
 * Internal interface representing raw database row from `daily_spend_rollup`.
 */
export interface DailySpendRollupDbRow {
  tenant_id: string;
  day: string;
  provider: string;
  model_id: string;
  total_requests: number;
  total_tokens: number;
  total_cost_microdollars: number | string | bigint;
}

/**
 * Internal interface for count/sum aggregate query results.
 */
export interface AggregateDbRow {
  total_cost?: number | string | bigint | null;
  total_requests?: number | string | null;
  total_tokens?: number | string | null;
  count?: number | string | null;
}

/**
 * Internal interface for rollup reconciliation query results.
 */
export interface ReconcileRollupDbRow {
  provider: string;
  model_id: string;
  total_requests: number;
  total_tokens: number;
  total_cost_microdollars: number | string | bigint;
}
