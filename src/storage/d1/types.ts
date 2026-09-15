/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * D1 Storage Subsystem: Types and Database Row Definitions
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - Strict TypeScript (zero `any`).
 * - Fixed-Point Microdollars: `bigint` int64 for cost values. Zero floating-point math.
 * - Per-Tenant Isolation: `tenantId` strict boundaries.
 */

export interface TenantMetrics {
  tenantId: string;
  totalCostMicrodollars: bigint;
  totalRequests: number;
  totalTokens: number;
}

export interface DailySpendRollupRecord {
  tenantId: string;
  day: string;
  provider: string;
  modelId: string;
  totalRequests: number;
  totalTokens: number;
  totalCostMicrodollars: bigint;
}

export interface RollupInput {
  tenantId: string;
  day: string;
  provider: string;
  modelId: string;
  requestsDelta?: number;
  tokensDelta?: number;
  costMicrodollarsDelta: bigint;
}

export interface CostLedgerRecordInput {
  id?: string;
  requestId: string;
  tenantId: string;
  keyId: string;
  provider: string;
  modelId: string;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  costMicrodollars: bigint;
  latencyMs?: number;
  statusCode: number;
  createdAt?: string;
}

interface RawApiKeyRow {
  id: string;
  tenant_id?: string;
  tenantId?: string;
  label?: string;
  provider: string;
  encrypted_key_b64?: string;
  ciphertext?: string;
  nonce_b64?: string;
  nonce?: string;
  key_prefix?: string;
  key_suffix?: string;
  rpm_limit?: number;
  rpmLimit?: number;
  rpd_limit?: number;
  rpdLimit?: number;
  priority?: number;
  status?: string;
  circuit_open_until?: string | null;
  circuitOpenUntil?: string | null;
  last_used_at?: string | number | null;
  lastUsedAt?: string | number | null;
  created_at?: string;
}

export type { RawApiKeyRow };

interface AggregateDbRow {
  total_cost?: number | string | bigint | null;
  total_requests?: number | string | null;
  total_tokens?: number | string | null;
}

export type { AggregateDbRow };

interface DailyRollupDbRow {
  tenant_id: string;
  day: string;
  provider: string;
  model_id: string;
  total_requests: number;
  total_tokens: number;
  total_cost_microdollars: number | string | bigint;
}

export type { DailyRollupDbRow };

