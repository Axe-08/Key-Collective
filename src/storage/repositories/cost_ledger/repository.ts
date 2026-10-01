/**
 * Key Collective v2 — Cost Ledger Repository Implementation
 *
 * Encapsulates all persistent D1 SQL operations for:
 * 1. Immutable Cost Ledger transaction events (dual-writing microdollars and Credit Units).
 * 2. Pre-aggregated Daily Spend Rollups and Daily CU Rollups.
 * 3. Daily reconciliation from raw immutable records.
 *
 * Invariant: Every method enforces strict per-tenant data boundaries.
 */

import type { ModelProvider } from "../../../types/models";
import {
  CostLedgerError,
  InvalidCostLedgerEventError,
  TenantIsolationViolationError,
} from "./errors";
import {
  formatCalendarDay,
  validateMicrodollars,
} from "./helpers";
import type {
  AggregateDbRow,
  CostLedgerDbRow,
  CostLedgerEvent,
  CostLedgerEventInput,
  DailySpendRollup,
  DailySpendRollupDbRow,
  DailySpendRollupInput,
  ListCostEventsOptions,
  ListDailyRollupsOptions,
  ReconcileRollupDbRow,
  TenantSpendSummary,
} from "./types";

/**
 * Computes the token-derived CU fallback value:
 * 10 + Math.floor((promptTokens + 999) / 1000) + Math.floor(((completionTokens + reasoningTokens) * 4 + 999) / 1000)
 */
export function computeFallbackCu(
  promptTokens: number,
  completionTokens: number,
  reasoningTokens: number
): bigint {
  const p = Math.max(0, Math.trunc(promptTokens));
  const c = Math.max(0, Math.trunc(completionTokens));
  const r = Math.max(0, Math.trunc(reasoningTokens));
  const promptPart = Math.floor((p + 999) / 1000);
  const outPart = Math.floor(((c + r) * 4 + 999) / 1000);
  return BigInt(10 + promptPart + outPart);
}

/**
 * CostLedgerRepository
 *
 * Encapsulates all persistent D1 SQL operations for:
 * 1. Immutable Cost Ledger transaction events.
 * 2. Pre-aggregated Daily Spend Rollups & Daily CU Rollups.
 * 3. Daily reconciliation from raw immutable records.
 *
 * Invariant: Every method enforces strict per-tenant data boundaries.
 */
export class CostLedgerRepository {
  constructor(private readonly db: D1Database) {
    if (!db) {
      throw new CostLedgerError("D1Database instance is required for CostLedgerRepository", {
        statusCode: 500,
        code: "DATABASE_REQUIRED",
      });
    }
  }

  /**
   * Records a single cost transaction into the immutable cost_ledger table.
   * Dual-writes both cost_microdollars and cu.
   *
   * @param input CostLedgerEventInput containing request metrics, cost in microdollars, and optional CU.
   * @returns Persisted CostLedgerEvent with int64 bigint microdollars and cu.
   */
  public async recordEvent(input: CostLedgerEventInput): Promise<CostLedgerEvent> {
    this.validateEventInput(input);

    const id = input.id ?? crypto.randomUUID();
    const createdAt = this.normalizeCreatedAt(input.createdAt);
    const costBigInt = validateMicrodollars(input.costMicrodollars, "costMicrodollars");
    const promptTokens = Math.max(0, Math.trunc(input.promptTokens ?? 0));
    const completionTokens = Math.max(0, Math.trunc(input.completionTokens ?? 0));
    const cachedTokens = Math.max(0, Math.trunc(input.cachedTokens ?? 0));
    const reasoningTokens = Math.max(0, Math.trunc(input.reasoningTokens ?? 0));
    const latencyMs = Math.max(0, Math.trunc(input.latencyMs ?? 0));

    const cuBigInt = input.cu !== undefined
      ? validateMicrodollars(input.cu, "cu")
      : computeFallbackCu(promptTokens, completionTokens, reasoningTokens);
    const usageEstimated = input.usageEstimated ?? 0;
    const borrowed = input.borrowed ?? 0;
    const lenderTenantId = input.lenderTenantId ?? null;

    const query = `
      INSERT INTO cost_ledger (
        id, request_id, tenant_id, key_id, provider, model_id,
        prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens,
        cost_microdollars, latency_ms, status_code, created_at,
        cu, usage_estimated, borrowed, lender_tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
      await this.db
        .prepare(query)
        .bind(
          id,
          input.requestId.trim(),
          input.tenantId.trim(),
          input.keyId.trim(),
          input.provider.trim(),
          input.modelId.trim(),
          promptTokens,
          completionTokens,
          cachedTokens,
          reasoningTokens,
          this.toSqlInteger(costBigInt),
          latencyMs,
          input.statusCode,
          createdAt,
          this.toSqlInteger(cuBigInt),
          usageEstimated,
          borrowed,
          lenderTenantId
        )
        .run();
    } catch (err: unknown) {
      throw new CostLedgerError(
        `Failed to record cost ledger event: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err, details: { id, requestId: input.requestId, tenantId: input.tenantId } }
      );
    }

    return {
      id,
      requestId: input.requestId.trim(),
      tenantId: input.tenantId.trim(),
      keyId: input.keyId.trim(),
      provider: input.provider.trim() as ModelProvider,
      modelId: input.modelId.trim(),
      promptTokens,
      completionTokens,
      cachedTokens,
      reasoningTokens,
      costMicrodollars: costBigInt,
      latencyMs,
      statusCode: input.statusCode,
      createdAt,
      cu: cuBigInt,
      usageEstimated,
      borrowed,
      lenderTenantId,
    };
  }

  /**
   * Atomically records a batch of cost ledger events using D1's transaction batch API.
   *
   * @param inputs Array of CostLedgerEventInput objects.
   * @returns Array of persisted CostLedgerEvent records.
   */
  public async recordBatch(inputs: readonly CostLedgerEventInput[]): Promise<CostLedgerEvent[]> {
    if (inputs.length === 0) {
      return [];
    }

    const events: CostLedgerEvent[] = [];
    const statements: D1PreparedStatement[] = [];

    const query = `
      INSERT INTO cost_ledger (
        id, request_id, tenant_id, key_id, provider, model_id,
        prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens,
        cost_microdollars, latency_ms, status_code, created_at,
        cu, usage_estimated, borrowed, lender_tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const input of inputs) {
      this.validateEventInput(input);

      const id = input.id ?? crypto.randomUUID();
      const createdAt = this.normalizeCreatedAt(input.createdAt);
      const costBigInt = validateMicrodollars(input.costMicrodollars, "costMicrodollars");
      const promptTokens = Math.max(0, Math.trunc(input.promptTokens ?? 0));
      const completionTokens = Math.max(0, Math.trunc(input.completionTokens ?? 0));
      const cachedTokens = Math.max(0, Math.trunc(input.cachedTokens ?? 0));
      const reasoningTokens = Math.max(0, Math.trunc(input.reasoningTokens ?? 0));
      const latencyMs = Math.max(0, Math.trunc(input.latencyMs ?? 0));

      const cuBigInt = input.cu !== undefined
        ? validateMicrodollars(input.cu, "cu")
        : computeFallbackCu(promptTokens, completionTokens, reasoningTokens);
      const usageEstimated = input.usageEstimated ?? 0;
      const borrowed = input.borrowed ?? 0;
      const lenderTenantId = input.lenderTenantId ?? null;

      const stmt = this.db.prepare(query).bind(
        id,
        input.requestId.trim(),
        input.tenantId.trim(),
        input.keyId.trim(),
        input.provider.trim(),
        input.modelId.trim(),
        promptTokens,
        completionTokens,
        cachedTokens,
        reasoningTokens,
        this.toSqlInteger(costBigInt),
        latencyMs,
        input.statusCode,
        createdAt,
        this.toSqlInteger(cuBigInt),
        usageEstimated,
        borrowed,
        lenderTenantId
      );

      statements.push(stmt);
      events.push({
        id,
        requestId: input.requestId.trim(),
        tenantId: input.tenantId.trim(),
        keyId: input.keyId.trim(),
        provider: input.provider.trim() as ModelProvider,
        modelId: input.modelId.trim(),
        promptTokens,
        completionTokens,
        cachedTokens,
        reasoningTokens,
        costMicrodollars: costBigInt,
        latencyMs,
        statusCode: input.statusCode,
        createdAt,
        cu: cuBigInt,
        usageEstimated,
        borrowed,
        lenderTenantId,
      });
    }

    try {
      await this.db.batch(statements);
    } catch (err: unknown) {
      throw new CostLedgerError(
        `Failed to record batch of ${inputs.length} cost ledger events: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err, details: { batchSize: inputs.length } }
      );
    }

    return events;
  }

  /**
   * Atomically records a cost transaction into cost_ledger AND increments the corresponding
   * daily_spend_rollup AND daily_cu_rollup in a single D1 transaction.
   *
   * @param input CostLedgerEventInput
   * @returns Persisted CostLedgerEvent
   */
  public async recordEventWithRollup(input: CostLedgerEventInput): Promise<CostLedgerEvent> {
    this.validateEventInput(input);

    const id = input.id ?? crypto.randomUUID();
    const createdAt = this.normalizeCreatedAt(input.createdAt);
    const day = formatCalendarDay(createdAt);
    const costBigInt = validateMicrodollars(input.costMicrodollars, "costMicrodollars");
    const promptTokens = Math.max(0, Math.trunc(input.promptTokens ?? 0));
    const completionTokens = Math.max(0, Math.trunc(input.completionTokens ?? 0));
    const cachedTokens = Math.max(0, Math.trunc(input.cachedTokens ?? 0));
    const reasoningTokens = Math.max(0, Math.trunc(input.reasoningTokens ?? 0));
    const latencyMs = Math.max(0, Math.trunc(input.latencyMs ?? 0));
    const totalTokens = promptTokens + completionTokens + reasoningTokens;

    const cuBigInt = input.cu !== undefined
      ? validateMicrodollars(input.cu, "cu")
      : computeFallbackCu(promptTokens, completionTokens, reasoningTokens);
    const usageEstimated = input.usageEstimated ?? 0;
    const borrowed = input.borrowed ?? 0;
    const lenderTenantId = input.lenderTenantId ?? null;

    const ledgerQuery = `
      INSERT INTO cost_ledger (
        id, request_id, tenant_id, key_id, provider, model_id,
        prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens,
        cost_microdollars, latency_ms, status_code, created_at,
        cu, usage_estimated, borrowed, lender_tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const spendRollupQuery = `
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

    const cuRollupQuery = `
      INSERT INTO daily_cu_rollup (
        tenant_id, day, provider, model_id,
        total_requests, total_tokens, total_cu
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, day, provider, model_id)
      DO UPDATE SET
        total_requests = total_requests + excluded.total_requests,
        total_tokens = total_tokens + excluded.total_tokens,
        total_cu = total_cu + excluded.total_cu
    `;

    const ledgerStmt = this.db.prepare(ledgerQuery).bind(
      id,
      input.requestId.trim(),
      input.tenantId.trim(),
      input.keyId.trim(),
      input.provider.trim(),
      input.modelId.trim(),
      promptTokens,
      completionTokens,
      cachedTokens,
      reasoningTokens,
      this.toSqlInteger(costBigInt),
      latencyMs,
      input.statusCode,
      createdAt,
      this.toSqlInteger(cuBigInt),
      usageEstimated,
      borrowed,
      lenderTenantId
    );

    const spendRollupStmt = this.db.prepare(spendRollupQuery).bind(
      input.tenantId.trim(),
      day,
      input.provider.trim(),
      input.modelId.trim(),
      1,
      totalTokens,
      this.toSqlInteger(costBigInt)
    );

    const cuRollupStmt = this.db.prepare(cuRollupQuery).bind(
      input.tenantId.trim(),
      day,
      input.provider.trim(),
      input.modelId.trim(),
      1,
      totalTokens,
      this.toSqlInteger(cuBigInt)
    );

    try {
      await this.db.batch([ledgerStmt, spendRollupStmt, cuRollupStmt]);
    } catch (err: unknown) {
      throw new CostLedgerError(
        `Failed to record cost ledger event with rollup: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err, details: { id, requestId: input.requestId, tenantId: input.tenantId, day } }
      );
    }

    return {
      id,
      requestId: input.requestId.trim(),
      tenantId: input.tenantId.trim(),
      keyId: input.keyId.trim(),
      provider: input.provider.trim() as ModelProvider,
      modelId: input.modelId.trim(),
      promptTokens,
      completionTokens,
      cachedTokens,
      reasoningTokens,
      costMicrodollars: costBigInt,
      latencyMs,
      statusCode: input.statusCode,
      createdAt,
      cu: cuBigInt,
      usageEstimated,
      borrowed,
      lenderTenantId,
    };
  }

  /**
   * Retrieves a single event by ID with mandatory tenant boundary check.
   *
   * @param tenantId Tenant ID boundary
   * @param id CostLedgerEvent ID
   * @returns CostLedgerEvent or null if not found or if owned by another tenant.
   */
  public async getEventById(tenantId: string, id: string): Promise<CostLedgerEvent | null> {
    this.validateTenantId(tenantId);
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      throw new InvalidCostLedgerEventError("Event id must be a non-empty string");
    }

    const query = `
      SELECT * FROM cost_ledger
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `;

    try {
      const row = await this.db.prepare(query).bind(tenantId.trim(), id.trim()).first<CostLedgerDbRow>();
      if (!row) {
        return null;
      }
      return this.mapRowToEvent(row);
    } catch (err: unknown) {
      throw new CostLedgerError(
        `Failed to query cost ledger event by id: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err, details: { id, tenantId } }
      );
    }
  }

  /**
   * Retrieves all cost ledger events associated with a specific request ID for a tenant.
   *
   * @param tenantId Tenant ID boundary
   * @param requestId Request correlation ID
   */
  public async getEventsByRequestId(tenantId: string, requestId: string): Promise<CostLedgerEvent[]> {
    this.validateTenantId(tenantId);
    if (!requestId || typeof requestId !== "string" || requestId.trim().length === 0) {
      throw new InvalidCostLedgerEventError("requestId must be a non-empty string");
    }

    const query = `
      SELECT * FROM cost_ledger
      WHERE tenant_id = ? AND request_id = ?
      ORDER BY created_at ASC
    `;

    try {
      const result = await this.db
        .prepare(query)
        .bind(tenantId.trim(), requestId.trim())
        .all<CostLedgerDbRow>();

      return (result.results ?? []).map((row) => this.mapRowToEvent(row));
    } catch (err: unknown) {
      throw new CostLedgerError(
        `Failed to query events by request id: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err, details: { requestId, tenantId } }
      );
    }
  }

  /**
   * Lists cost ledger events for a tenant with rich filtering and pagination.
   *
   * @param tenantId Tenant ID boundary
   * @param options Filtering and pagination options
   */
  public async listEvents(
    tenantId: string,
    options: ListCostEventsOptions = {}
  ): Promise<CostLedgerEvent[]> {
    this.validateTenantId(tenantId);

    let sql = "SELECT * FROM cost_ledger WHERE tenant_id = ?";
    const bindings: unknown[] = [tenantId.trim()];

    if (options.since) {
      const sinceStr = options.since instanceof Date ? options.since.toISOString() : options.since;
      sql += " AND created_at >= ?";
      bindings.push(sinceStr);
    }

    if (options.until) {
      const untilStr = options.until instanceof Date ? options.until.toISOString() : options.until;
      sql += " AND created_at <= ?";
      bindings.push(untilStr);
    }

    if (options.provider) {
      sql += " AND provider = ?";
      bindings.push(options.provider.trim());
    }

    if (options.modelId) {
      sql += " AND model_id = ?";
      bindings.push(options.modelId.trim());
    }

    if (options.keyId) {
      sql += " AND key_id = ?";
      bindings.push(options.keyId.trim());
    }

    const order = options.order?.toUpperCase() === "ASC" ? "ASC" : "DESC";
    sql += ` ORDER BY created_at ${order}`;

    const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
    sql += " LIMIT ?";
    bindings.push(limit);

    if (options.offset && options.offset > 0) {
      sql += " OFFSET ?";
      bindings.push(Math.trunc(options.offset));
    }

    try {
      const result = await this.db.prepare(sql).bind(...bindings).all<CostLedgerDbRow>();
      return (result.results ?? []).map((row) => this.mapRowToEvent(row));
    } catch (err: unknown) {
      throw new CostLedgerError(
        `Failed to list cost ledger events: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err, details: { tenantId, options } }
      );
    }
  }

  /**
   * Retrieves events dispatched through a specific API key within tenant boundary.
   */
  public async getEventsByKey(
    tenantId: string,
    keyId: string,
    options: Omit<ListCostEventsOptions, "keyId"> = {}
  ): Promise<CostLedgerEvent[]> {
    if (!keyId || typeof keyId !== "string" || keyId.trim().length === 0) {
      throw new InvalidCostLedgerEventError("keyId must be a non-empty string");
    }
    return this.listEvents(tenantId, { ...options, keyId });
  }

  /**
   * Upserts or increments metrics in daily_spend_rollup AND daily_cu_rollup.
   *
   * @param input DailySpendRollupInput containing deltas to increment.
   */
  public async upsertDailyRollup(input: DailySpendRollupInput): Promise<void> {
    this.validateTenantId(input.tenantId);
    if (!input.provider || typeof input.provider !== "string" || input.provider.trim().length === 0) {
      throw new InvalidCostLedgerEventError("provider must be a non-empty string");
    }
    if (!input.modelId || typeof input.modelId !== "string" || input.modelId.trim().length === 0) {
      throw new InvalidCostLedgerEventError("modelId must be a non-empty string");
    }

    const day = formatCalendarDay(input.day);
    const costBigInt = validateMicrodollars(input.costMicrodollarsDelta, "costMicrodollarsDelta");
    const requestsDelta = Math.max(0, Math.trunc(input.requestsDelta ?? 1));
    const tokensDelta = Math.max(0, Math.trunc(input.tokensDelta ?? 0));
    const cuDelta = input.cuDelta !== undefined
      ? validateMicrodollars(input.cuDelta, "cuDelta")
      : BigInt(Math.max(0, Math.floor((tokensDelta + 999) / 1000)));

    const spendQuery = `
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

    const cuQuery = `
      INSERT INTO daily_cu_rollup (
        tenant_id, day, provider, model_id,
        total_requests, total_tokens, total_cu
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, day, provider, model_id)
      DO UPDATE SET
        total_requests = total_requests + excluded.total_requests,
        total_tokens = total_tokens + excluded.total_tokens,
        total_cu = total_cu + excluded.total_cu
    `;

    try {
      const spendStmt = this.db
        .prepare(spendQuery)
        .bind(
          input.tenantId.trim(),
          day,
          input.provider.trim(),
          input.modelId.trim(),
          requestsDelta,
          tokensDelta,
          this.toSqlInteger(costBigInt)
        );

      const cuStmt = this.db
        .prepare(cuQuery)
        .bind(
          input.tenantId.trim(),
          day,
          input.provider.trim(),
          input.modelId.trim(),
          requestsDelta,
          tokensDelta,
          this.toSqlInteger(cuDelta)
        );

      await this.db.batch([spendStmt, cuStmt]);
    } catch (err: unknown) {
      throw new CostLedgerError(
        `Failed to upsert daily spend rollup: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err, details: { tenantId: input.tenantId, day, provider: input.provider, modelId: input.modelId } }
      );
    }
  }

  /**
   * Retrieves aggregated daily spend and CU rollups for a tenant with optional date and model filtering.
   *
   * @param tenantId Tenant ID boundary
   * @param options Filtering options (startDate, endDate, provider, modelId, limit, offset, order)
   */
  public async getDailyRollups(
    tenantId: string,
    options: ListDailyRollupsOptions = {}
  ): Promise<DailySpendRollup[]> {
    this.validateTenantId(tenantId);

    let sql = `
      SELECT
        s.tenant_id,
        s.day,
        s.provider,
        s.model_id,
        s.total_requests,
        s.total_tokens,
        s.total_cost_microdollars,
        COALESCE(c.total_cu, 0) as total_cu
      FROM daily_spend_rollup s
      LEFT JOIN daily_cu_rollup c
        ON s.tenant_id = c.tenant_id AND s.day = c.day AND s.provider = c.provider AND s.model_id = c.model_id
      WHERE s.tenant_id = ?
    `;
    const bindings: unknown[] = [tenantId.trim()];

    if (options.startDate) {
      sql += " AND s.day >= ?";
      bindings.push(formatCalendarDay(options.startDate));
    }

    if (options.endDate) {
      sql += " AND s.day <= ?";
      bindings.push(formatCalendarDay(options.endDate));
    }

    if (options.provider) {
      sql += " AND s.provider = ?";
      bindings.push(options.provider.trim());
    }

    if (options.modelId) {
      sql += " AND s.model_id = ?";
      bindings.push(options.modelId.trim());
    }

    const order = options.order?.toUpperCase() === "ASC" ? "ASC" : "DESC";
    sql += ` ORDER BY s.day ${order}`;

    if (options.limit && options.limit > 0) {
      sql += " LIMIT ?";
      bindings.push(Math.min(options.limit, 1000));
    }

    if (options.offset && options.offset > 0) {
      sql += " OFFSET ?";
      bindings.push(Math.trunc(options.offset));
    }

    try {
      const result = await this.db.prepare(sql).bind(...bindings).all<DailySpendRollupDbRow>();
      return (result.results ?? []).map((row) => this.mapRowToRollup(row));
    } catch (err: unknown) {
      throw new CostLedgerError(
        `Failed to query daily spend rollups: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err, details: { tenantId, options } }
      );
    }
  }

  /**
   * Returns a high-level spending summary for a tenant over an optional timeframe.
   * Reads from pre-aggregated daily rollups for microsecond query performance.
   *
   * @param tenantId Tenant ID boundary
   * @param options Optional startDate and endDate boundaries
   */
  public async getTenantSpendSummary(
    tenantId: string,
    options: { startDate?: string | Date; endDate?: string | Date } = {}
  ): Promise<TenantSpendSummary> {
    this.validateTenantId(tenantId);

    let sql = `
      SELECT
        COALESCE(SUM(s.total_cost_microdollars), 0) as total_cost,
        COALESCE(SUM(s.total_requests), 0) as total_requests,
        COALESCE(SUM(s.total_tokens), 0) as total_tokens,
        COALESCE(SUM(c.total_cu), 0) as total_cu
      FROM daily_spend_rollup s
      LEFT JOIN daily_cu_rollup c
        ON s.tenant_id = c.tenant_id AND s.day = c.day AND s.provider = c.provider AND s.model_id = c.model_id
      WHERE s.tenant_id = ?
    `;
    const bindings: unknown[] = [tenantId.trim()];

    let periodStart: string | undefined;
    let periodEnd: string | undefined;

    if (options.startDate) {
      periodStart = formatCalendarDay(options.startDate);
      sql += " AND s.day >= ?";
      bindings.push(periodStart);
    }

    if (options.endDate) {
      periodEnd = formatCalendarDay(options.endDate);
      sql += " AND s.day <= ?";
      bindings.push(periodEnd);
    }

    try {
      const row = await this.db.prepare(sql).bind(...bindings).first<AggregateDbRow>();
      const totalCostRaw = row?.total_cost ?? 0;
      const totalRequestsRaw = row?.total_requests ?? 0;
      const totalTokensRaw = row?.total_tokens ?? 0;

      return {
        tenantId: tenantId.trim(),
        totalCostMicrodollars: BigInt(totalCostRaw),
        totalRequests: Number(totalRequestsRaw),
        totalTokens: Number(totalTokensRaw),
        totalCu: BigInt(row?.total_cu ?? 0),
        ...(periodStart ? { periodStart } : {}),
        ...(periodEnd ? { periodEnd } : {}),
      };
    } catch (err: unknown) {
      throw new CostLedgerError(
        `Failed to calculate tenant spend summary: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err, details: { tenantId, options } }
      );
    }
  }

  /**
   * Returns the exact total spend in int64 microdollars for a tenant over an optional timeframe.
   */
  public async getTenantTotalSpendMicrodollars(
    tenantId: string,
    options: { startDate?: string | Date; endDate?: string | Date } = {}
  ): Promise<bigint> {
    const summary = await this.getTenantSpendSummary(tenantId, options);
    return summary.totalCostMicrodollars;
  }

  /**
   * Reconciles and synchronizes daily_spend_rollup AND daily_cu_rollup rows directly from the immutable cost_ledger table.
   * Ensures ledger auditability: if rollup records were desynchronized or missing, this rebuilds them.
   * If a ledger row has cu IS NULL, the token-derived CU fallback is calculated.
   *
   * @param tenantId Tenant ID boundary
   * @param day Calendar date to reconcile (YYYY-MM-DD)
   * @returns Array of reconciled DailySpendRollup records.
   */
  public async reconcileDailyRollupFromLedger(
    tenantId: string,
    day: string | Date
  ): Promise<DailySpendRollup[]> {
    this.validateTenantId(tenantId);
    const dayStr = formatCalendarDay(day);

    // Aggregate from immutable cost ledger for this tenant and day
    const aggregateQuery = `
      SELECT
        provider,
        model_id,
        COUNT(*) as total_requests,
        SUM(prompt_tokens + completion_tokens + reasoning_tokens) as total_tokens,
        SUM(cost_microdollars) as total_cost_microdollars,
        SUM(COALESCE(cu, 10 + ((prompt_tokens + 999) / 1000) + (((completion_tokens + reasoning_tokens) * 4 + 999) / 1000))) as total_cu
      FROM cost_ledger
      WHERE tenant_id = ? AND substr(created_at, 1, 10) = ?
      GROUP BY provider, model_id
    `;

    try {
      const aggResult = await this.db
        .prepare(aggregateQuery)
        .bind(tenantId.trim(), dayStr)
        .all<ReconcileRollupDbRow>();

      const rows = aggResult.results ?? [];

      // Delete existing rollup rows for this tenant and day to overwrite cleanly
      const deleteSpendQuery = `
        DELETE FROM daily_spend_rollup
        WHERE tenant_id = ? AND day = ?
      `;

      const deleteCuQuery = `
        DELETE FROM daily_cu_rollup
        WHERE tenant_id = ? AND day = ?
      `;

      const statements: D1PreparedStatement[] = [
        this.db.prepare(deleteSpendQuery).bind(tenantId.trim(), dayStr),
        this.db.prepare(deleteCuQuery).bind(tenantId.trim(), dayStr),
      ];

      const reconciledRollups: DailySpendRollup[] = [];

      const insertSpendQuery = `
        INSERT INTO daily_spend_rollup (
          tenant_id, day, provider, model_id,
          total_requests, total_tokens, total_cost_microdollars
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const insertCuQuery = `
        INSERT INTO daily_cu_rollup (
          tenant_id, day, provider, model_id,
          total_requests, total_tokens, total_cu
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      for (const r of rows) {
        const costBigInt = BigInt(r.total_cost_microdollars ?? 0);
        const cuBigInt = BigInt(r.total_cu ?? 0);
        const requests = Number(r.total_requests ?? 0);
        const tokens = Number(r.total_tokens ?? 0);

        statements.push(
          this.db
            .prepare(insertSpendQuery)
            .bind(
              tenantId.trim(),
              dayStr,
              r.provider,
              r.model_id,
              requests,
              tokens,
              this.toSqlInteger(costBigInt)
            ),
          this.db
            .prepare(insertCuQuery)
            .bind(
              tenantId.trim(),
              dayStr,
              r.provider,
              r.model_id,
              requests,
              tokens,
              this.toSqlInteger(cuBigInt)
            )
        );

        reconciledRollups.push({
          tenantId: tenantId.trim(),
          day: dayStr,
          provider: r.provider as ModelProvider,
          modelId: r.model_id,
          totalRequests: requests,
          totalTokens: tokens,
          totalCostMicrodollars: costBigInt,
          totalCu: cuBigInt,
        });
      }

      await this.db.batch(statements);
      return reconciledRollups;
    } catch (err: unknown) {
      throw new CostLedgerError(
        `Failed to reconcile daily spend rollups: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err, details: { tenantId, day: dayStr } }
      );
    }
  }

  /**
   * Counts the number of cost ledger events for a tenant.
   */
  public async countEvents(
    tenantId: string,
    options: { since?: string | Date; until?: string | Date } = {}
  ): Promise<number> {
    this.validateTenantId(tenantId);

    let sql = "SELECT COUNT(*) as count FROM cost_ledger WHERE tenant_id = ?";
    const bindings: unknown[] = [tenantId.trim()];

    if (options.since) {
      const sinceStr = options.since instanceof Date ? options.since.toISOString() : options.since;
      sql += " AND created_at >= ?";
      bindings.push(sinceStr);
    }

    if (options.until) {
      const untilStr = options.until instanceof Date ? options.until.toISOString() : options.until;
      sql += " AND created_at <= ?";
      bindings.push(untilStr);
    }

    try {
      const row = await this.db.prepare(sql).bind(...bindings).first<AggregateDbRow>();
      return Number(row?.count ?? 0);
    } catch (err: unknown) {
      throw new CostLedgerError(
        `Failed to count cost ledger events: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err, details: { tenantId, options } }
      );
    }
  }

  /**
   * Validates common event input invariants.
   */
  private validateEventInput(input: CostLedgerEventInput): void {
    if (!input || typeof input !== "object") {
      throw new InvalidCostLedgerEventError("Event input payload must be an object");
    }
    this.validateTenantId(input.tenantId);

    if (!input.requestId || typeof input.requestId !== "string" || input.requestId.trim().length === 0) {
      throw new InvalidCostLedgerEventError("requestId must be a non-empty string");
    }
    if (!input.keyId || typeof input.keyId !== "string" || input.keyId.trim().length === 0) {
      throw new InvalidCostLedgerEventError("keyId must be a non-empty string");
    }
    if (!input.provider || typeof input.provider !== "string" || input.provider.trim().length === 0) {
      throw new InvalidCostLedgerEventError("provider must be a non-empty string");
    }
    if (!input.modelId || typeof input.modelId !== "string" || input.modelId.trim().length === 0) {
      throw new InvalidCostLedgerEventError("modelId must be a non-empty string");
    }
    if (typeof input.statusCode !== "number" || !Number.isInteger(input.statusCode) || input.statusCode < 100 || input.statusCode > 599) {
      throw new InvalidCostLedgerEventError(
        `statusCode must be a valid HTTP status code integer (100-599), got: ${input.statusCode}`
      );
    }
  }

  /**
   * Enforces non-empty tenant ID to uphold strict tenant boundary invariants.
   */
  private validateTenantId(tenantId: unknown): asserts tenantId is string {
    if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
      throw new TenantIsolationViolationError("Tenant ID must be a non-empty string");
    }
  }

  /**
   * Normalizes createdAt timestamp into an ISO-8601 string.
   */
  private normalizeCreatedAt(createdAt?: string | Date): string {
    if (!createdAt) {
      return new Date().toISOString();
    }
    if (createdAt instanceof Date) {
      if (Number.isNaN(createdAt.getTime())) {
        throw new InvalidCostLedgerEventError("Invalid createdAt Date provided");
      }
      return createdAt.toISOString();
    }
    if (typeof createdAt === "string") {
      const parsed = new Date(createdAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new InvalidCostLedgerEventError(`Invalid createdAt timestamp: '${createdAt}'`);
      }
      return parsed.toISOString();
    }
    throw new InvalidCostLedgerEventError("createdAt must be an ISO-8601 string or Date instance");
  }

  /**
   * Safely converts a bigint to a parameter representation acceptable by D1.
   */
  private toSqlInteger(value: bigint): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new InvalidCostLedgerEventError(
        `Cost microdollar or CU amount exceeds JavaScript safe integer bounds: ${value.toString()}`
      );
    }
    return Number(value);
  }

  /**
   * Maps a database row from cost_ledger to a strongly typed CostLedgerEvent.
   * If cu is NULL, fallback formula is computed.
   */
  private mapRowToEvent(row: CostLedgerDbRow): CostLedgerEvent {
    const promptTokens = Number(row.prompt_tokens);
    const completionTokens = Number(row.completion_tokens);
    const cachedTokens = Number(row.cached_tokens);
    const reasoningTokens = Number(row.reasoning_tokens);

    let cu: bigint;
    if (row.cu !== null && row.cu !== undefined) {
      cu = BigInt(row.cu);
    } else {
      cu = computeFallbackCu(promptTokens, completionTokens, reasoningTokens);
    }

    return {
      id: row.id,
      requestId: row.request_id,
      tenantId: row.tenant_id,
      keyId: row.key_id,
      provider: row.provider as ModelProvider,
      modelId: row.model_id,
      promptTokens,
      completionTokens,
      cachedTokens,
      reasoningTokens,
      costMicrodollars: BigInt(row.cost_microdollars),
      latencyMs: Number(row.latency_ms),
      statusCode: Number(row.status_code),
      createdAt: row.created_at,
      cu,
      usageEstimated: row.usage_estimated !== null && row.usage_estimated !== undefined ? Number(row.usage_estimated) : 0,
      borrowed: row.borrowed !== null && row.borrowed !== undefined ? Number(row.borrowed) : 0,
      lenderTenantId: row.lender_tenant_id ?? null,
    };
  }

  /**
   * Maps a database row from daily_spend_rollup to a strongly typed DailySpendRollup.
   */
  private mapRowToRollup(row: DailySpendRollupDbRow): DailySpendRollup {
    return {
      tenantId: row.tenant_id,
      day: row.day,
      provider: row.provider as ModelProvider,
      modelId: row.model_id,
      totalRequests: Number(row.total_requests),
      totalTokens: Number(row.total_tokens),
      totalCostMicrodollars: BigInt(row.total_cost_microdollars),
      totalCu: BigInt(row.total_cu ?? 0),
    };
  }
}
