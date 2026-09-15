/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * D1 Storage Subsystem: Ledger & Telemetry Persistence
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - Fixed-Point Microdollars: `bigint` microdollars.
 * - Per-Tenant Isolation: Enforced tenantId checks.
 */

import type { TelemetryEvent } from "../../contracts/telemetry";
import type { CostLedgerRecordInput } from "./types";
import { assertValidMicrodollars, assertValidTenantId } from "./validation";

export async function recordCostLedgerEvent(
  db: D1Database,
  event: CostLedgerRecordInput
): Promise<void> {
  assertValidTenantId(event.tenantId);
  if (!event.requestId || event.requestId.trim().length === 0) {
    throw new Error("Request ID cannot be empty");
  }
  if (!event.keyId || event.keyId.trim().length === 0) {
    throw new Error("Key ID cannot be empty");
  }
  if (!event.provider || event.provider.trim().length === 0) {
    throw new Error("Provider cannot be empty");
  }
  if (!event.modelId || event.modelId.trim().length === 0) {
    throw new Error("Model ID cannot be empty");
  }
  assertValidMicrodollars(event.costMicrodollars);

  const id = event.id ?? crypto.randomUUID();
  const createdAt = event.createdAt ?? new Date().toISOString();
  const promptTokens = Math.max(0, Math.trunc(event.promptTokens ?? 0));
  const completionTokens = Math.max(0, Math.trunc(event.completionTokens ?? 0));
  const cachedTokens = Math.max(0, Math.trunc(event.cachedTokens ?? 0));
  const reasoningTokens = Math.max(0, Math.trunc(event.reasoningTokens ?? 0));
  const latencyMs = Math.max(0, Math.trunc(event.latencyMs ?? 0));
  const cost = Number(event.costMicrodollars);

  const query = `
    INSERT INTO cost_ledger (
      id, request_id, tenant_id, key_id, provider, model_id,
      prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens,
      cost_microdollars, latency_ms, status_code, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await db
    .prepare(query)
    .bind(
      id,
      event.requestId.trim(),
      event.tenantId.trim(),
      event.keyId.trim(),
      event.provider.trim(),
      event.modelId.trim(),
      promptTokens,
      completionTokens,
      cachedTokens,
      reasoningTokens,
      cost,
      latencyMs,
      event.statusCode,
      createdAt
    )
    .run();
}

export async function recordTelemetry(db: D1Database, event: TelemetryEvent): Promise<void> {
  if (!event || typeof event !== "object") {
    throw new Error("Invalid telemetry event");
  }
  assertValidTenantId(event.tenantId);
  assertValidMicrodollars(event.costMicrodollars);

  const keyId = event.metadata?.keyId || "system";
  const provider = event.metadata?.provider || "unknown";
  const modelId = event.metadata?.modelId || "unknown";
  const statusCode = event.metadata?.statusCode ? parseInt(event.metadata.statusCode, 10) : 200;
  const createdAt = new Date(event.timestamp).toISOString();

  await recordCostLedgerEvent(db, {
    requestId: event.traceId,
    tenantId: event.tenantId,
    keyId,
    provider,
    modelId,
    costMicrodollars: event.costMicrodollars,
    latencyMs: event.latencyMs,
    statusCode,
    createdAt,
  });
}
