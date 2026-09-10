/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * D1 Storage Adapter for Persistence & Rollups
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * 1. No Plaintext Keys:
 *    All API keys are encrypted at rest using AES-256-GCM via Web Crypto API.
 *    Unique 12-byte nonces are stored alongside ciphertext in D1.
 * 2. Per-Tenant Isolation:
 *    All queries strictly enforce tenant_id boundaries. Zero cross-tenant state access.
 * 3. Fixed-Point Microdollars:
 *    All costs stored and aggregated in int64 microdollars (bigint, 1 USD = 1,000,000 µ$).
 *    Zero floating-point math for financials.
 * 4. TypeScript Strict Mode:
 *    Zero any types, full type safety.
 */

import { EncryptedKey } from "../contracts/key_pool";
import { TelemetryEvent } from "../contracts/telemetry";

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

interface AggregateDbRow {
  total_cost?: number | string | bigint | null;
  total_requests?: number | string | null;
  total_tokens?: number | string | null;
}

interface DailyRollupDbRow {
  tenant_id: string;
  day: string;
  provider: string;
  model_id: string;
  total_requests: number;
  total_tokens: number;
  total_cost_microdollars: number | string | bigint;
}

export class D1StorageAdapter {
  constructor(private readonly db: D1Database) {
    if (!db) {
      throw new Error("D1Database instance is required");
    }
  }

  /**
   * Retrieves all encrypted keys belonging to a specific tenant.
   * Strict tenant isolation is enforced.
   */
  async getKeysForTenant(tenantId: string): Promise<EncryptedKey[]> {
    this.assertValidTenantId(tenantId);

    const query = `
      SELECT
        id,
        tenant_id,
        label,
        provider,
        encrypted_key_b64,
        nonce_b64,
        rpm_limit,
        rpd_limit,
        priority,
        status,
        circuit_open_until,
        last_used_at
      FROM api_keys
      WHERE tenant_id = ?
      ORDER BY priority DESC, created_at ASC
    `;

    const result = await this.db.prepare(query).bind(tenantId.trim()).all<RawApiKeyRow>();
    const rows = result.results ?? [];

    return rows.map((row) => this.mapRowToEncryptedKey(row, tenantId.trim()));
  }

  /**
   * Retrieves a single encrypted key by ID with tenant boundary validation.
   */
  async getKeyById(tenantId: string, keyId: string): Promise<EncryptedKey | null> {
    this.assertValidTenantId(tenantId);
    if (!keyId || keyId.trim().length === 0) {
      throw new Error("Key ID cannot be empty");
    }

    const query = `
      SELECT
        id,
        tenant_id,
        label,
        provider,
        encrypted_key_b64,
        nonce_b64,
        rpm_limit,
        rpd_limit,
        priority,
        status,
        circuit_open_until,
        last_used_at
      FROM api_keys
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `;

    const row = await this.db.prepare(query).bind(tenantId.trim(), keyId.trim()).first<RawApiKeyRow>();
    if (!row) {
      return null;
    }

    return this.mapRowToEncryptedKey(row, tenantId.trim());
  }

  /**
   * Persists an encrypted key into D1.
   * Plaintext keys are NEVER persisted. Nonce is stored alongside ciphertext.
   */
  async saveEncryptedKey(key: EncryptedKey): Promise<void> {
    if (!key || typeof key !== "object") {
      throw new Error("Invalid key payload");
    }
    this.assertValidTenantId(key.tenantId);

    if (!key.id || key.id.trim().length === 0) {
      throw new Error("Key ID cannot be empty");
    }
    if (!key.provider || key.provider.trim().length === 0) {
      throw new Error("Provider cannot be empty");
    }
    if (!key.ciphertext || key.ciphertext.trim().length === 0) {
      throw new Error("Ciphertext cannot be empty");
    }
    if (!key.nonce || key.nonce.trim().length === 0) {
      throw new Error("Nonce cannot be empty");
    }

    const label = `${key.provider} Key`;
    const keyPrefix = "enc_";
    const keySuffix = "...";
    const rpmLimit = 60;
    const rpdLimit = 1500;
    const priority = 0;
    const status = "Healthy";
    const circuitOpenUntil = null;
    const lastUsedAt = null;

    const query = `
      INSERT INTO api_keys (
        id, tenant_id, label, provider, encrypted_key_b64, nonce_b64,
        key_prefix, key_suffix, rpm_limit, rpd_limit, priority, status,
        circuit_open_until, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        label = excluded.label,
        provider = excluded.provider,
        encrypted_key_b64 = excluded.encrypted_key_b64,
        nonce_b64 = excluded.nonce_b64,
        key_prefix = excluded.key_prefix,
        key_suffix = excluded.key_suffix,
        rpm_limit = excluded.rpm_limit,
        rpd_limit = excluded.rpd_limit,
        priority = excluded.priority,
        status = excluded.status,
        circuit_open_until = excluded.circuit_open_until,
        last_used_at = excluded.last_used_at
    `;

    await this.db
      .prepare(query)
      .bind(
        key.id.trim(),
        key.tenantId.trim(),
        label,
        key.provider.trim(),
        key.ciphertext.trim(),
        key.nonce.trim(),
        keyPrefix,
        keySuffix,
        rpmLimit,
        rpdLimit,
        priority,
        status,
        circuitOpenUntil,
        lastUsedAt
      )
      .run();
  }

  /**
   * Deletes an encrypted key from D1 scoped to tenant.
   */
  async deleteKey(tenantId: string, keyId: string): Promise<void> {
    this.assertValidTenantId(tenantId);
    if (!keyId || keyId.trim().length === 0) {
      throw new Error("Key ID cannot be empty");
    }

    const query = `DELETE FROM api_keys WHERE tenant_id = ? AND id = ?`;
    await this.db.prepare(query).bind(tenantId.trim(), keyId.trim()).run();
  }

  /**
   * Upserts pre-aggregated metrics into daily_spend_rollup.
   * Enforces int64 microdollars with zero floating-point math.
   */
  async saveRollup(rollup: RollupInput): Promise<void> {
    this.assertValidTenantId(rollup.tenantId);
    if (!rollup.day || rollup.day.trim().length === 0) {
      throw new Error("Day cannot be empty (YYYY-MM-DD)");
    }
    if (!rollup.provider || rollup.provider.trim().length === 0) {
      throw new Error("Provider cannot be empty");
    }
    if (!rollup.modelId || rollup.modelId.trim().length === 0) {
      throw new Error("Model ID cannot be empty");
    }
    this.assertValidMicrodollars(rollup.costMicrodollarsDelta);

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

    await this.db
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

  /**
   * Retrieves aggregated tenant metrics across an optional date range.
   * Microdollars returned strictly as bigint. Zero floating-point math.
   */
  async getTenantMetrics(
    tenantId: string,
    startDate?: string,
    endDate?: string
  ): Promise<TenantMetrics> {
    this.assertValidTenantId(tenantId);

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

    const row = await this.db.prepare(query).bind(...params).first<AggregateDbRow>();

    const totalCost = row?.total_cost !== undefined && row.total_cost !== null
      ? BigInt(row.total_cost)
      : 0n;
    const totalRequests = row?.total_requests !== undefined && row.total_requests !== null
      ? Number(row.total_requests)
      : 0;
    const totalTokens = row?.total_tokens !== undefined && row.total_tokens !== null
      ? Number(row.total_tokens)
      : 0;

    return {
      tenantId: tenantId.trim(),
      totalCostMicrodollars: totalCost,
      totalRequests,
      totalTokens,
    };
  }

  /**
   * Alias for getTenantMetrics.
   */
  async aggregateMetrics(
    tenantId: string,
    startDate?: string,
    endDate?: string
  ): Promise<TenantMetrics> {
    return this.getTenantMetrics(tenantId, startDate, endDate);
  }

  /**
   * Retrieves detailed daily spend rollups for a tenant.
   */
  async getDailyRollups(
    tenantId: string,
    startDate?: string,
    endDate?: string
  ): Promise<DailySpendRollupRecord[]> {
    this.assertValidTenantId(tenantId);

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

    const result = await this.db.prepare(query).bind(...params).all<DailyRollupDbRow>();
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

  /**
   * Records a single cost transaction into immutable cost_ledger table.
   */
  async recordCostLedgerEvent(event: CostLedgerRecordInput): Promise<void> {
    this.assertValidTenantId(event.tenantId);
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
    this.assertValidMicrodollars(event.costMicrodollars);

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

    await this.db
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

  /**
   * Persists a telemetry event to D1 persistence layer.
   * Conforms to TelemetryEvent contract.
   */
  async recordTelemetry(event: TelemetryEvent): Promise<void> {
    if (!event || typeof event !== "object") {
      throw new Error("Invalid telemetry event");
    }
    this.assertValidTenantId(event.tenantId);
    this.assertValidMicrodollars(event.costMicrodollars);

    const keyId = event.metadata?.keyId || "system";
    const provider = event.metadata?.provider || "unknown";
    const modelId = event.metadata?.modelId || "unknown";
    const statusCode = event.metadata?.statusCode ? parseInt(event.metadata.statusCode, 10) : 200;
    const createdAt = new Date(event.timestamp).toISOString();

    await this.recordCostLedgerEvent({
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

  private mapRowToEncryptedKey(row: RawApiKeyRow, fallbackTenantId: string): EncryptedKey {
    return {
      id: row.id,
      tenantId: row.tenantId ?? row.tenant_id ?? fallbackTenantId,
      provider: row.provider,
      ciphertext: row.ciphertext ?? row.encrypted_key_b64 ?? "",
      nonce: row.nonce ?? row.nonce_b64 ?? "",
    };
  }

  private assertValidTenantId(tenantId: unknown): asserts tenantId is string {
    if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
      throw new Error("Tenant ID must be a non-empty string");
    }
  }

  private assertValidMicrodollars(cost: bigint): void {
    if (typeof cost !== "bigint") {
      throw new Error("Cost must be a bigint representing microdollars (zero floating-point)");
    }
    if (cost < 0n) {
      throw new Error("Cost microdollars cannot be negative");
    }
    if (cost > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Cost microdollars exceeds maximum safe integer range");
    }
  }
}
