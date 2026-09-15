/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * D1 Storage Subsystem: Rollups and Aggregated Metrics
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - Fixed-Point Microdollars: `bigint` microdollars. Zero floating-point math.
 * - Per-Tenant Isolation: Scoped by `tenantId`.
 */

import type {
  AggregateDbRow,
  DailyRollupDbRow,
  DailySpendRollupRecord,
  RollupInput,
  TenantMetrics,
} from "./types";
import { assertValidMicrodollars, assertValidTenantId } from "./validation";

export async function saveRollup(db: D1Database, rollup: RollupInput): Promise<void> {
  assertValidTenantId(rollup.tenantId);
  if (!rollup.day || rollup.day.trim().length === 0) {
    throw new Error("Day cannot be empty (YYYY-MM-DD)");
  }
  if (!rollup.provider || rollup.provider.trim().length === 0) {
    throw new Error("Provider cannot be empty");
  }
  if (!rollup.modelId || rollup.modelId.trim().length === 0) {
    throw new Error("Model ID cannot be empty");
  }
  assertValidMicrodollars(rollup.costMicrodollarsDelta);

  const requestsDelta = Math.max(0, Math.trunc(rollup.requestsDelta ?? 1));
  const tokensDelta = Math.max(0, Math.trunc(rollup.tokensDelta ?? 0));
  const costDelta = Number(rollup.costMicrodollarsDelta);

  const query = `
    INSERT INTO daily_spend_rollup (
      tenant_id, day, provider, model_id,
      total_requests, total_tokens, total_cost_microdollars
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (tenant_id, day, provider, model_id)
    DO UPDATE SET
      total_requests = total_requests + excluded.total_requests,
      total_tokens = total_tokens + excluded.total_tokens,
      total_cost_microdollars = total_cost_microdollars + excluded.total_cost_microdollars
  `;

  await db
    .prepare(query)
    .bind(
      rollup.tenantId.trim(),
      rollup.day.trim(),
      rollup.provider.trim(),
      rollup.modelId.trim(),
      requestsDelta,
      tokensDelta,
      costDelta
    )
    .run();
}

export async function getTenantMetrics(
  db: D1Database,
  tenantId: string,
  startDate?: string,
  endDate?: string
): Promise<TenantMetrics> {
  assertValidTenantId(tenantId);

  let query = `
    SELECT
      COALESCE(SUM(total_cost_microdollars), 0) as total_cost,
      COALESCE(SUM(total_requests), 0) as total_requests,
      COALESCE(SUM(total_tokens), 0) as total_tokens
    FROM daily_spend_rollup
    WHERE tenant_id = ?
  `;
  const params: unknown[] = [tenantId.trim()];

  if (startDate) {
    query += ` AND day >= ?`;
    params.push(startDate.trim());
  }

  if (endDate) {
    query += ` AND day <= ?`;
    params.push(endDate.trim());
  }

  const row = await db.prepare(query).bind(...params).first<AggregateDbRow>();

  const totalCost =
    row?.total_cost !== undefined && row.total_cost !== null
      ? BigInt(row.total_cost)
      : 0n;
  const totalRequests =
    row?.total_requests !== undefined && row.total_requests !== null
      ? Number(row.total_requests)
      : 0;
  const totalTokens =
    row?.total_tokens !== undefined && row.total_tokens !== null
      ? Number(row.total_tokens)
      : 0;

  return {
    tenantId: tenantId.trim(),
    totalCostMicrodollars: totalCost,
    totalRequests,
    totalTokens,
  };
}

export async function getDailyRollups(
  db: D1Database,
  tenantId: string,
  startDate?: string,
  endDate?: string
): Promise<DailySpendRollupRecord[]> {
  assertValidTenantId(tenantId);

  let query = `
    SELECT
      tenant_id,
      day,
      provider,
      model_id,
      total_requests,
      total_tokens,
      total_cost_microdollars
    FROM daily_spend_rollup
    WHERE tenant_id = ?
  `;
  const params: unknown[] = [tenantId.trim()];

  if (startDate) {
    query += ` AND day >= ?`;
    params.push(startDate.trim());
  }

  if (endDate) {
    query += ` AND day <= ?`;
    params.push(endDate.trim());
  }

  query += ` ORDER BY day DESC`;

  const result = await db.prepare(query).bind(...params).all<DailyRollupDbRow>();
  const rows = result.results ?? [];

  return rows.map((r) => ({
    tenantId: r.tenant_id,
    day: r.day,
    provider: r.provider,
    modelId: r.model_id,
    totalRequests: Number(r.total_requests),
    totalTokens: Number(r.total_tokens),
    totalCostMicrodollars: BigInt(r.total_cost_microdollars),
  }));
}
