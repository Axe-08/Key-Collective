/**
 * Data structures for telemetry, metrics, and cost accounting.
 * Streamed to Cloudflare Workers Analytics Engine on the hot path
 * and persisted to Cloudflare D1 for auditing and ledger rollups.
 */

/**
 * Detailed event recorded in the D1 cost ledger.
 */
export interface CostLedgerEvent {
  id?: string;
  tenant_id: string;
  key_id?: string;
  provider: string;
  model: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost_microdollars: bigint;
  latency_ms: number;
  status_code: number;
  timestamp: number;
}

/**
 * Aggregated daily spend rollup record stored in D1.
 */
export interface DailySpendRollup {
  id?: string;
  tenant_id: string;
  date: string; // YYYY-MM-DD format
  total_requests: number;
  cost_microdollars: bigint;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  updated_at?: number;
}

/**
 * Telemetry event data payload sent to Workers Analytics Engine.
 */
export interface TelemetryEvent {
  tenant_id: string;
  key_id?: string;
  provider: string;
  model: string;
  status_code: number;
  latency_ms: number;
  cost_microdollars: bigint;
  prompt_tokens?: number;
  completion_tokens?: number;
  timestamp?: number;
}
