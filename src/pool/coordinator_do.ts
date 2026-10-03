/**
 * Key Collective — PoolCoordinatorDO (Section 2.4, WP-4.1)
 *
 * Provider-sharded (`POOL_COORDINATOR.idFromName("pool:google")`, `"pool:groq"`)
 * SQLite-backed Durable Object that owns global state for every COMMUNITY key:
 * - Tables: `keys`, `leases`, `settled_leases`, `borrower_window`, `brakes`, `owner_debts`, `meta`
 * - Typed DO RPC: `lease`, `settle`, `upsertKey`, `removeKey`, `setStatus`, `stats`, `reconcile`, `setOwnerDebt`
 * - 60s alarm: promotes OBSERVATION keys, reactivates COOLDOWN keys, prunes expired brakes & windows,
 *   and every 5 minutes reconciles against D1 (`pool_type='COMMUNITY'` + D-21 `communityPool` filter).
 */

import { DurableObject } from "cloudflare:workers";
import { loadPoolRights } from "../auth/rights";
import {
  BORROWER_WINDOW_MINUTES,
  BRAKE_DURATION_MS,
  BRAKE_MAX_TENANT_SHARE_PCT,
  BRAKE_MIN_ACTIVE_BORROWERS,
  BRAKE_MIN_POOL_CU,
  computeOwnerShareCapPct,
} from "../constants/commons";
import { commonsEnforcement, recordWouldDeny } from "./enforcement";
import { nextProviderReset } from "../providers/config";
import { Clock, systemClock } from "../utils/clock";
import { Logger } from "../utils/logger";
import type { WorkerEnv } from "../worker/auth/index";

export type CoordinatorKeyStatus =
  | "OBSERVATION"
  | "ACTIVE"
  | "COOLDOWN"
  | "QUARANTINED"
  | "REVOKED";

export interface UpsertCoordinatorKeyInput {
  keyId: string;
  owner: string;
  provider: string;
  status?: CoordinatorKeyStatus;
  observationUntil?: number | null;
  cooldownUntil?: number | null;
  reactivateAt?: number | null;
  rpmLimit?: number;
  rpdLimit?: number;
  classification?: string | null;
  priorityBoost?: number;
}

export interface CoordinatorLeaseRequest {
  tenant: string;
  ownOnly: boolean;
  estimateCu?: number | bigint;
  provider?: string;
  model?: string;
  retryOffsetMs?: number;
}

export interface CoordinatorLease {
  leaseId: string;
  keyId: string;
  ownerTenantId: string;
  provider: string;
  source: "own_community" | "borrowed";
}

export interface CoordinatorKeyClassificationResult {
  kcSeenPct: number;
  communalPct: number;
  result: string;
  effectiveRpd: number | null;
  drainState: "OK" | "DRAINED";
}

export interface CoordinatorSettleResult {
  settled: boolean;
  duplicate: boolean;
  keyId?: string;
  ownerTenantId?: string;
  borrowed?: boolean;
  classification?: CoordinatorKeyClassificationResult;
}

export interface CoordinatorKeyDiagnosticState {
  keyId: string;
  owner: string;
  provider: string;
  status: string;
  rpdLimit: number;
  dispatchedToday: number;
  dispatchedCommunal: number;
  classification: string | null;
  drainState: "OK" | "DRAINED";
  effectiveRpd: number | null;
  consecutiveCleanDays: number;
  cooldownUntil?: number | null;
  reactivateAt?: number | null;
  modelStats?: {
    model: string;
    dispatchedToday: number;
    dispatchedCommunal: number;
    cuServed: number;
    classification: string | null;
    effectiveRpd: number | null;
  };
}

export interface CoordinatorStats {
  activeKeys: number;
  observationKeys: number;
  cooldownKeys: number;
  quarantinedKeys: number;
  revokedKeys: number;
  dispatchedToday: number;
  dispatchedCommunal: number;
  borrowerCuInWindow: number;
  activeBrakes: number;
  utilisationPct: number;
  p90LatencyMs: number;
  wProviderPct: number;
}

export interface ProviderOverrideInfo {
  provider: string;
  state: "TRIPPED" | "NORMAL";
  until?: number | null;
  reason?: string | null;
  adminUserId?: string | null;
  updatedAt: number;
}

export interface ControlMaintenanceState {
  maintenance: boolean;
  reason?: string;
  since?: number;
}

interface SqlCursorLike {
  toArray(): Record<string, unknown>[];
}

interface SqlStorageLike {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
}

const ALARM_INTERVAL_MS = 60_000;
const RECONCILE_INTERVAL_MS = 5 * 60_000;
const SETTLED_LEASE_TTL_MS = 24 * 60 * 60 * 1000;

export function canonicalCoordinatorProvider(provider: string): "google" | "groq" | string {
  const clean = provider.trim().toLowerCase();
  if (clean === "gemini" || clean === "google") return "google";
  return clean;
}

export class PoolCoordinatorDO extends DurableObject<WorkerEnv> {
  private clock: Clock = systemClock;
  private schemaInitialized = false;
  private envOverrides: Record<string, unknown> = {};

  constructor(ctx: DurableObjectState, env: WorkerEnv = {}) {
    super(ctx, env);
    const bootstrapAlarm = async () => {
      if (
        typeof this.ctx.storage?.getAlarm === "function" &&
        typeof this.ctx.storage?.setAlarm === "function"
      ) {
        const current = await this.ctx.storage.getAlarm();
        if (!current) {
          await this.ctx.storage.setAlarm(this.clock.now() + ALARM_INTERVAL_MS);
        }
      }
    };
    if (typeof this.ctx.blockConcurrencyWhile === "function") {
      this.ctx.blockConcurrencyWhile(bootstrapAlarm);
    } else {
      void bootstrapAlarm();
    }
  }

  public clearMemoryCache(): void {
    this.schemaInitialized = false;
  }

  private getEffectiveEnv(): Record<string, unknown> {
    return {
      ...(this.env as unknown as Record<string, unknown>),
      ...this.envOverrides,
    };
  }

  public setEnvForTest(overrides: Record<string, unknown>): void {
    const envRecord = this.env as unknown as { KC_ENV?: string } | undefined;
    if (envRecord?.KC_ENV !== "test") {
      throw new Error("setEnvForTest is only available when KC_ENV=test");
    }
    this.envOverrides = { ...this.envOverrides, ...overrides };
  }

  private sql(): SqlStorageLike {
    const storageWithSql = this.ctx.storage as unknown as { sql?: SqlStorageLike };
    if (!storageWithSql?.sql) {
      throw new Error("PoolCoordinatorDO requires SQLite storage (ctx.storage.sql)");
    }
    return storageWithSql.sql;
  }

  private ensureSchema(): SqlStorageLike {
    const sql = this.sql();
    if (this.schemaInitialized) {
      return sql;
    }
    sql.exec(`
      CREATE TABLE IF NOT EXISTS keys (
        key_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        observation_until INTEGER,
        cooldown_until INTEGER,
        reactivate_at INTEGER,
        rpm_limit INTEGER NOT NULL,
        rpd_limit INTEGER NOT NULL,
        minute_bucket INTEGER NOT NULL DEFAULT 0,
        minute_count INTEGER NOT NULL DEFAULT 0,
        day_bucket TEXT NOT NULL DEFAULT '',
        day_count INTEGER NOT NULL DEFAULT 0,
        dispatches_today INTEGER NOT NULL DEFAULT 0,
        dispatches_communal INTEGER NOT NULL DEFAULT 0,
        classification TEXT,
        drain_state TEXT NOT NULL DEFAULT 'OK',
        effective_rpd INTEGER,
        consecutive_clean_days INTEGER NOT NULL DEFAULT 0,
        priority_boost INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leases (
        lease_id TEXT PRIMARY KEY,
        key_id TEXT,
        tenant TEXT,
        borrowed INTEGER,
        est_cu INTEGER,
        model TEXT NOT NULL DEFAULT 'default',
        created_at INTEGER,
        settled_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS settled_leases (
        lease_id TEXT PRIMARY KEY,
        status TEXT,
        cu INTEGER,
        settled_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS latency_samples (
        lease_id TEXT PRIMARY KEY,
        latency_ms INTEGER NOT NULL,
        recorded_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS key_model_stats (
        key_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dispatches_today INTEGER NOT NULL DEFAULT 0,
        dispatches_communal INTEGER NOT NULL DEFAULT 0,
        cu_served INTEGER NOT NULL DEFAULT 0,
        classification TEXT,
        effective_rpd INTEGER,
        PRIMARY KEY (key_id, model)
      );
      CREATE TABLE IF NOT EXISTS key_drain_history (
        key_id TEXT NOT NULL,
        day TEXT NOT NULL,
        drained INTEGER NOT NULL DEFAULT 0,
        exhaustion_dispatches INTEGER,
        PRIMARY KEY (key_id, day)
      );
      CREATE TABLE IF NOT EXISTS borrower_window (
        tenant TEXT,
        minute INTEGER,
        cu INTEGER,
        PRIMARY KEY (tenant, minute)
      );
      CREATE TABLE IF NOT EXISTS owner_service_window (
        owner TEXT NOT NULL,
        hour INTEGER NOT NULL,
        cu INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (owner, hour)
      );
      CREATE TABLE IF NOT EXISTS brakes (
        tenant TEXT PRIMARY KEY,
        until INTEGER
      );
      CREATE TABLE IF NOT EXISTS owner_debts (
        owner TEXT PRIMARY KEY,
        debt_cu INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_overrides (
        provider TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        until INTEGER,
        reason TEXT,
        admin_user_id TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS control_state (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      );
    `);
    this.schemaInitialized = true;
    return sql;
  }

  private getMeta(key: string): string | null {
    const sql = this.ensureSchema();
    const rows = sql.exec("SELECT v FROM meta WHERE k = ?", key).toArray();
    return rows.length > 0 && typeof rows[0].v === "string" ? rows[0].v : null;
  }

  private setMeta(key: string, value: string): void {
    const sql = this.ensureSchema();
    sql.exec(
      "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      key,
      value
    );
  }

  private async ensureAlarmScheduled(): Promise<void> {
    // Alarm is scheduled on construction (via blockConcurrencyWhile) and rescheduled in alarm().
  }

  /**
   * Checks D-21 eligibility when the owner exists in D1 `users`.
   * If `env.DB` has no row for `owner` (e.g. synthetic owner ID in unit/DO tests), returns true.
   */
  private async ownerHasCommunityRightsIfInD1(owner: string): Promise<boolean> {
    const db = this.env?.DB;
    if (!db || typeof db.prepare !== "function") {
      return true;
    }
    const userRow = await db
      .prepare("SELECT id FROM users WHERE id = ?")
      .bind(owner)
      .first<{ id: string }>();
    if (!userRow) {
      return true;
    }
    const rights = await loadPoolRights(db, owner);
    return rights.communityPool;
  }

  /**
   * Promotes OBSERVATION keys whose observation period has ended to ACTIVE.
   * If DB is available, syncs status to D1 api_keys and creates an owner notification.
   */
  public async promoteObservationKeys(all: boolean = false, now?: number): Promise<number> {
    const timestamp = now ?? this.clock.now();
    const sql = this.ensureSchema();
    const query = all
      ? "SELECT key_id, owner FROM keys WHERE status = 'OBSERVATION'"
      : "SELECT key_id, owner FROM keys WHERE status = 'OBSERVATION' AND observation_until IS NOT NULL AND observation_until <= ?";
    const rawRows = all
      ? sql.exec(query).toArray()
      : sql.exec(query, timestamp).toArray();
    const rows = rawRows.map((r) => ({
      key_id: String(r.key_id ?? ""),
      owner: String(r.owner ?? ""),
    }));

    if (rows.length === 0) {
      return 0;
    }

    if (all) {
      sql.exec(
        "UPDATE keys SET status = 'ACTIVE', observation_until = NULL, updated_at = ? WHERE status = 'OBSERVATION'",
        timestamp
      );
    } else {
      sql.exec(
        `UPDATE keys SET status = 'ACTIVE', observation_until = NULL, updated_at = ?
          WHERE status = 'OBSERVATION' AND observation_until IS NOT NULL AND observation_until <= ?`,
        timestamp,
        timestamp
      );
    }

    if (this.env?.DB) {
      await this.syncPromotedKeysToD1(rows, timestamp);
    }

    return rows.length;
  }

  private async syncPromotedKeysToD1(
    promotedKeys: Array<{ key_id: string; owner: string }>,
    now: number
  ): Promise<void> {
    const db = this.env?.DB;
    if (!db || typeof db.prepare !== "function") return;

    for (const { key_id, owner } of promotedKeys) {
      try {
        await db
          .prepare(
            `UPDATE api_keys
                SET community_routing_status = 'ACTIVE',
                    status_changed_at = ?
              WHERE id = ?
                AND community_routing_status = 'OBSERVATION'`
          )
          .bind(now, key_id)
          .run();

        const notifId = `notif_${crypto.randomUUID()}`;
        await db
          .prepare(
            `INSERT INTO notifications (id, tenant_id, type, key_id, message, created_at, read_at)
             VALUES (?, ?, 'pool_joined', ?, 'Your key joined the community pool', ?, NULL)`
          )
          .bind(notifId, owner, key_id, now)
          .run();
      } catch (err) {
        new Logger({ traceId: "promote-observation", tenantId: owner }).warn(
          "Failed to persist observation promotion in D1",
          { keyId: key_id, error: err instanceof Error ? err.message : String(err) }
        );
      }
    }
  }

  private async promoteAndResetBuckets(
    now: number
  ): Promise<{ currentMinute: number; currentDay: string }> {
    const sql = this.ensureSchema();
    const currentMinute = Math.floor(now / 60_000);
    const currentDay = new Date(now).toISOString().slice(0, 10);

    // Reactivate COOLDOWN keys whose cooldown/reactivate timestamp has elapsed
    sql.exec(
      `UPDATE keys
          SET status = 'ACTIVE', cooldown_until = NULL, reactivate_at = NULL, updated_at = ?
        WHERE status = 'COOLDOWN'
          AND COALESCE(reactivate_at, cooldown_until) IS NOT NULL
          AND COALESCE(reactivate_at, cooldown_until) <= ?`,
      now,
      now
    );

    // Roll minute buckets
    sql.exec(
      `UPDATE keys
          SET minute_bucket = ?, minute_count = 0
        WHERE minute_bucket != ?`,
      currentMinute,
      currentMinute
    );

    // Flush per-key/per-model daily stats to D1 before zeroing counters for keys rolling to a new day
    const db = this.env?.DB;
    if (db && typeof db.prepare === "function") {
      const flushRows = sql
        .exec(
          `SELECT kms.key_id,
                  k.day_bucket AS day,
                  kms.model,
                  kms.dispatches_today,
                  kms.dispatches_communal,
                  kms.cu_served,
                  COALESCE(kms.classification, k.classification) AS classification
             FROM key_model_stats kms
             JOIN keys k ON k.key_id = kms.key_id
            WHERE k.day_bucket != ''
              AND k.day_bucket != ?
              AND kms.dispatches_today > 0`,
          currentDay
        )
        .toArray();

      for (const r of flushRows) {
        const keyId = String(r.key_id ?? "");
        const day = String(r.day ?? "");
        const model = String(r.model ?? "default");
        const dispatched = Number(r.dispatches_today ?? 0);
        const communal = Number(r.dispatches_communal ?? 0);
        const cuServed = parseInt(String(r.cu_served ?? 0), 10) || 0;
        const classification = typeof r.classification === "string" ? r.classification : null;

        await db
          .prepare(
            `INSERT INTO key_daily_stats (key_id, day, model, dispatched, communal, cu_served, classification)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(key_id, day, model) DO UPDATE SET
               dispatched = excluded.dispatched,
               communal = excluded.communal,
               cu_served = excluded.cu_served,
               classification = excluded.classification`
          )
          .bind(keyId, day, model, dispatched, communal, cuServed, classification)
          .run()
          .catch(() => {});
      }
    }

    // Roll day buckets and reset per-model daily counters for keys rolling to a new day
    sql.exec(
      `UPDATE key_model_stats
          SET dispatches_today = 0,
              dispatches_communal = 0,
              cu_served = 0
        WHERE key_id IN (SELECT key_id FROM keys WHERE day_bucket != ?)`,
      currentDay
    );

    sql.exec(
      `UPDATE keys
          SET day_bucket = ?, day_count = 0, dispatches_today = 0, dispatches_communal = 0
        WHERE day_bucket != ?`,
      currentDay,
      currentDay
    );

    return { currentMinute, currentDay };
  }

  /**
   * Registers or updates a COMMUNITY key in the coordinator shard.
   * Enforces D-21: if the owner exists in D1 and lacks `communityPool` rights, the key is not registered.
   */
  public async upsertKey(
    input: UpsertCoordinatorKeyInput
  ): Promise<{ registered: boolean; reason?: string }> {
    const sql = this.ensureSchema();
    const now = this.clock.now();
    const provider = canonicalCoordinatorProvider(input.provider);
    this.setMeta("provider", provider);
    if (!this.getMeta("last_reconcile_ms")) {
      this.setMeta("last_reconcile_ms", String(now));
    }

    if (!(await this.ownerHasCommunityRightsIfInD1(input.owner))) {
      sql.exec("DELETE FROM keys WHERE key_id = ?", input.keyId);
      return { registered: false, reason: "missing_community_rights" };
    }

    const status: CoordinatorKeyStatus = input.status ?? "OBSERVATION";
    const rpmLimit = input.rpmLimit ?? (provider === "groq" ? 30 : 15);
    const rpdLimit = input.rpdLimit ?? (provider === "groq" ? 14400 : 1500);
    const currentMinute = Math.floor(now / 60_000);
    const currentDay = new Date(now).toISOString().slice(0, 10);

    sql.exec(
      `INSERT INTO keys (
         key_id, owner, provider, status, observation_until, cooldown_until, reactivate_at,
         rpm_limit, rpd_limit, minute_bucket, minute_count, day_bucket, day_count,
         dispatches_today, dispatches_communal, classification, priority_boost, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, 0, ?, ?, ?)
       ON CONFLICT(key_id) DO UPDATE SET
         owner = excluded.owner,
         provider = excluded.provider,
         status = excluded.status,
         observation_until = excluded.observation_until,
         cooldown_until = excluded.cooldown_until,
         reactivate_at = excluded.reactivate_at,
         rpm_limit = excluded.rpm_limit,
         rpd_limit = excluded.rpd_limit,
         classification = COALESCE(excluded.classification, keys.classification),
         priority_boost = excluded.priority_boost,
         updated_at = excluded.updated_at`,
      input.keyId,
      input.owner,
      provider,
      status,
      input.observationUntil ?? null,
      input.cooldownUntil ?? null,
      input.reactivateAt ?? null,
      rpmLimit,
      rpdLimit,
      currentMinute,
      currentDay,
      input.classification ?? null,
      input.priorityBoost ?? 0,
      now
    );

    await this.ensureAlarmScheduled();
    return { registered: true };
  }

  /**
   * Removes a key from the coordinator registry immediately (e.g. on delete, takedown, or COMMUNITY->PRIVATE).
   */
  public async removeKey(keyId: string): Promise<boolean> {
    const sql = this.ensureSchema();
    const existing = sql.exec("SELECT key_id FROM keys WHERE key_id = ?", keyId).toArray();
    if (existing.length === 0) {
      return false;
    }
    sql.exec("DELETE FROM keys WHERE key_id = ?", keyId);
    return true;
  }

  /**
   * Updates a key's routing status (`OBSERVATION` | `ACTIVE` | `COOLDOWN` | `QUARANTINED` | `REVOKED`).
   */
  public async setStatus(
    keyId: string,
    status: CoordinatorKeyStatus,
    until?: number | null
  ): Promise<boolean> {
    const sql = this.ensureSchema();
    const now = this.clock.now();
    const existing = sql.exec("SELECT key_id FROM keys WHERE key_id = ?", keyId).toArray();
    if (existing.length === 0) {
      return false;
    }

    if (status === "COOLDOWN") {
      const targetUntil = until ?? now + 60_000;
      sql.exec(
        "UPDATE keys SET status = 'COOLDOWN', cooldown_until = ?, reactivate_at = ?, updated_at = ? WHERE key_id = ?",
        targetUntil,
        targetUntil,
        now,
        keyId
      );
    } else if (status === "OBSERVATION") {
      sql.exec(
        "UPDATE keys SET status = 'OBSERVATION', observation_until = ?, updated_at = ? WHERE key_id = ?",
        until ?? now + 86_400_000,
        now,
        keyId
      );
    } else if (status === "ACTIVE") {
      sql.exec(
        "UPDATE keys SET status = 'ACTIVE', observation_until = NULL, cooldown_until = NULL, reactivate_at = NULL, updated_at = ? WHERE key_id = ?",
        now,
        keyId
      );
    } else {
      sql.exec(
        "UPDATE keys SET status = ?, updated_at = ? WHERE key_id = ?",
        status,
        now,
        keyId
      );
    }
    return true;
  }

  /**
   * Updates cached owner debt in CU (pushed from TenantQuotaDO) so lease priority is computed locally.
   */
  public async setOwnerDebt(owner: string, cu: number | bigint): Promise<void> {
    const sql = this.ensureSchema();
    const now = this.clock.now();
    const numericCu = Math.max(0, Number(cu));
    sql.exec(
      `INSERT INTO owner_debts (owner, debt_cu, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(owner) DO UPDATE SET debt_cu = excluded.debt_cu, updated_at = excluded.updated_at`,
      owner,
      numericCu,
      now
    );
  }

  /**
   * Sets administrative circuit override (WP-4.6, T-4.6.1).
   * While TRIPPED, leases return no keys for this provider shard.
   */
  public async setProviderOverride(
    state: "TRIPPED" | "NORMAL",
    until?: number | null,
    reason?: string | null,
    adminUserId?: string | null
  ): Promise<ProviderOverrideInfo> {
    const sql = this.ensureSchema();
    const now = this.clock.now();
    const provider = this.getMeta("provider") || "unknown";
    sql.exec(
      `INSERT INTO provider_overrides (provider, state, until, reason, admin_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         state = excluded.state,
         until = excluded.until,
         reason = excluded.reason,
         admin_user_id = excluded.admin_user_id,
         updated_at = excluded.updated_at`,
      provider,
      state,
      until ?? null,
      reason ?? null,
      adminUserId ?? null,
      now
    );
    return {
      provider,
      state,
      until: until ?? null,
      reason: reason ?? null,
      adminUserId: adminUserId ?? null,
      updatedAt: now,
    };
  }

  /**
   * Gets the active administrative circuit override for this provider shard (WP-4.6, T-4.6.1).
   */
  public async getProviderOverride(): Promise<ProviderOverrideInfo | null> {
    const sql = this.ensureSchema();
    const rows = sql
      .exec("SELECT provider, state, until, reason, admin_user_id, updated_at FROM provider_overrides LIMIT 1")
      .toArray();
    if (rows.length === 0) return null;
    const r = rows[0];
    const until = typeof r.until === "number" ? r.until : null;
    let state = String(r.state) as "TRIPPED" | "NORMAL";
    const now = this.clock.now();
    if (state === "TRIPPED" && until !== null && now >= until) {
      state = "NORMAL";
    }
    return {
      provider: String(r.provider),
      state,
      until,
      reason: typeof r.reason === "string" ? r.reason : null,
      adminUserId: typeof r.admin_user_id === "string" ? r.admin_user_id : null,
      updatedAt: Number(r.updated_at) || 0,
    };
  }

  /**
   * Sets global maintenance kill-switch on the 'control' coordinator instance (WP-4.6, T-4.6.2).
   */
  public async setMaintenance(
    maintenance: boolean,
    reason?: string
  ): Promise<ControlMaintenanceState> {
    const sql = this.ensureSchema();
    const now = this.clock.now();
    sql.exec(
      "INSERT INTO control_state (k, v) VALUES ('maintenance', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      maintenance ? "1" : "0"
    );
    if (reason) {
      sql.exec(
        "INSERT INTO control_state (k, v) VALUES ('maintenance_reason', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        reason
      );
    } else {
      sql.exec("DELETE FROM control_state WHERE k = 'maintenance_reason'");
    }
    sql.exec(
      "INSERT INTO control_state (k, v) VALUES ('maintenance_since', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      String(now)
    );
    return {
      maintenance,
      reason: reason ?? undefined,
      since: now,
    };
  }

  /**
   * Gets global maintenance kill-switch state on the 'control' coordinator instance (WP-4.6, T-4.6.2).
   */
  public async getMaintenance(): Promise<ControlMaintenanceState> {
    const sql = this.ensureSchema();
    const rows = sql
      .exec("SELECT k, v FROM control_state WHERE k IN ('maintenance', 'maintenance_reason', 'maintenance_since')")
      .toArray();
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(String(r.k), String(r.v));
    }
    const maintenance = map.get("maintenance") === "1";
    const reason = map.get("maintenance_reason") || undefined;
    const sinceStr = map.get("maintenance_since");
    const since = sinceStr ? parseInt(sinceStr, 10) : undefined;
    return { maintenance, reason, since };
  }

  /**
   * Checks whether `tenant` owns at least one promoted community key in this provider shard (WP-5.7 T-5.7.1).
   */
  public async isEyeForEyeAccessible(tenant: string, provider?: string): Promise<boolean> {
    const sql = this.ensureSchema();
    const providerFilter = provider ? canonicalCoordinatorProvider(provider) : null;
    const rows = sql
      .exec(
        `SELECT 1 FROM keys
          WHERE owner = ?
            AND (status = 'ACTIVE' OR (status = 'COOLDOWN' AND observation_until IS NULL))
            AND (? IS NULL OR provider = ?)
          LIMIT 1`,
        tenant,
        providerFilter,
        providerFilter
      )
      .toArray();
    return rows.length > 0;
  }

  /**
   * Returns the last refusal reason recorded for `tenant` during a borrowed lease attempt.
   */
  public async getLastRefusalReason(tenant: string): Promise<string | null> {
    const val = this.getMeta(`refusal:${tenant}`);
    return val && val.length > 0 ? val : null;
  }

  /**
   * Acquires a key lease from the coordinator.
   * - `ownOnly: true`: selects from the caller's own COMMUNITY keys (`ACTIVE` or `OBSERVATION`), no debt.
   * - `ownOnly: false`: selects from other contributors' `ACTIVE` COMMUNITY keys, scored by
   *   `priority_boost + min(5000, floor(owner_debt_cu / 10)) + classification_boost + headroom`,
   *   tie-broken round-robin with a rotating cursor.
   */
  public async lease(req: CoordinatorLeaseRequest): Promise<CoordinatorLease | null> {
    const sql = this.ensureSchema();
    const now = this.clock.now() + Math.max(0, Math.trunc(Number(req.retryOffsetMs ?? 0) || 0));
    await this.promoteAndResetBuckets(now);

    const override = await this.getProviderOverride();
    if (override && override.state === "TRIPPED") {
      return null;
    }


    const providerFilter = req.provider ? canonicalCoordinatorProvider(req.provider) : null;

    interface CandidateRow {
      key_id: string;
      owner: string;
      provider: string;
      status: string;
      rpm_limit: number;
      rpd_limit: number;
      minute_count: number;
      day_count: number;
      classification: string | null;
      priority_boost: number;
      debt_cu: number;
    }

    let rawRows: Record<string, unknown>[];
    if (req.ownOnly) {
      rawRows = sql
        .exec(
          `SELECT k.key_id, k.owner, k.provider, k.status, k.rpm_limit, k.rpd_limit,
                  k.minute_count, k.day_count, k.classification, k.priority_boost,
                  COALESCE(d.debt_cu, 0) AS debt_cu
             FROM keys k
             LEFT JOIN owner_debts d ON d.owner = k.owner
            WHERE k.owner = ?
              AND k.status IN ('ACTIVE', 'OBSERVATION')
              AND (k.cooldown_until IS NULL OR k.cooldown_until <= ?)
              AND k.minute_count < k.rpm_limit
              AND k.day_count < k.rpd_limit
              AND (? IS NULL OR k.provider = ?)
            ORDER BY k.key_id ASC`,
          req.tenant,
          now,
          providerFilter,
          providerFilter
        )
        .toArray();
    } else {
      this.setMeta(`refusal:${req.tenant}`, "");
      const effectiveEnv = this.getEffectiveEnv();

      // Eye-for-eye check (WP-5.7 T-5.7.1): borrower must own at least one ACTIVE community key in this provider shard
      const eyeAccessible = await this.isEyeForEyeAccessible(
        req.tenant,
        providerFilter ?? undefined
      );
      if (!eyeAccessible) {
        const eyeMode = commonsEnforcement("eye_for_eye", effectiveEnv);
        if (eyeMode === "enforce") {
          this.setMeta(`refusal:${req.tenant}`, "eye_for_eye");
          return null;
        } else {
          await recordWouldDeny(
            "eye_for_eye",
            req.tenant,
            `provider=${providerFilter ?? this.getMeta("provider") ?? "unknown"}`,
            effectiveEnv,
            (p) => this.ctx.waitUntil(p)
          );
        }
      }

      const brakeMode = commonsEnforcement("brake", effectiveEnv);

      // Check existing active brake lock for this borrower
      const activeBrakeRows = sql
        .exec("SELECT until FROM brakes WHERE tenant = ? AND until > ?", req.tenant, now)
        .toArray();
      if (activeBrakeRows.length > 0 && brakeMode === "enforce") {
        this.setMeta(`refusal:${req.tenant}`, "brake");
        return null;
      }

      // Evaluate 5-minute surge brake window from borrower_window
      const cutoffMinute = Math.floor((now - BORROWER_WINDOW_MINUTES * 60_000) / 60_000);
      const windowRows = sql
        .exec(
          "SELECT tenant, COALESCE(SUM(cu), 0) AS total_units FROM borrower_window WHERE minute >= ? GROUP BY tenant",
          cutoffMinute
        )
        .toArray();

      let poolUnits5min = 0;
      let activeBorrowers = 0;
      let tenantUnits5min = 0;
      for (const wr of windowRows) {
        const units = parseInt(String(wr.total_units ?? 0), 10) || 0;
        if (units > 0) {
          poolUnits5min += units;
          activeBorrowers += 1;
          if (String(wr.tenant) === req.tenant) {
            tenantUnits5min = units;
          }
        }
      }

      const minPoolUnits = Number(effectiveEnv.BRAKE_MIN_POOL_CU ?? BRAKE_MIN_POOL_CU);
      const minBorrowers = Number(
        effectiveEnv.BRAKE_MIN_ACTIVE_BORROWERS ?? BRAKE_MIN_ACTIVE_BORROWERS
      );
      const maxSharePct = Number(
        effectiveEnv.BRAKE_MAX_TENANT_SHARE_PCT ?? BRAKE_MAX_TENANT_SHARE_PCT
      );
      const brakeDurationMs = Number(effectiveEnv.BRAKE_DURATION_MS ?? BRAKE_DURATION_MS);

      if (
        poolUnits5min >= minPoolUnits &&
        activeBorrowers >= minBorrowers &&
        tenantUnits5min * 100 > maxSharePct * poolUnits5min
      ) {
        if (brakeMode === "enforce") {
          sql.exec(
            "INSERT INTO brakes (tenant, until) VALUES (?, ?) ON CONFLICT(tenant) DO UPDATE SET until = excluded.until",
            req.tenant,
            now + brakeDurationMs
          );
          this.setMeta(`refusal:${req.tenant}`, "brake");
          return null;
        } else {
          await recordWouldDeny(
            "brake",
            req.tenant,
            `share=${tenantUnits5min}/${poolUnits5min};borrowers=${activeBorrowers}`,
            effectiveEnv,
            (p) => this.ctx.waitUntil(p)
          );
        }
      }

      rawRows = sql
        .exec(
          `SELECT k.key_id, k.owner, k.provider, k.status, k.rpm_limit, k.rpd_limit,
                  k.minute_count, k.day_count, k.classification, k.priority_boost,
                  COALESCE(d.debt_cu, 0) AS debt_cu
             FROM keys k
             LEFT JOIN owner_debts d ON d.owner = k.owner
            WHERE k.status = 'ACTIVE'
              AND k.owner != ?
              AND (k.cooldown_until IS NULL OR k.cooldown_until <= ?)
              AND k.minute_count < k.rpm_limit
              AND k.day_count < MIN(k.rpd_limit, COALESCE(k.effective_rpd, k.rpd_limit))
              AND (? IS NULL OR k.provider = ?)
            ORDER BY k.key_id ASC`,
          req.tenant,
          now,
          providerFilter,
          providerFilter
        )
        .toArray();
    }

    if (rawRows.length === 0) {
      if (!req.ownOnly) {
        const cooldownRows = sql
          .exec(
            `SELECT 1 FROM keys
              WHERE status = 'COOLDOWN'
                AND (? IS NULL OR provider = ?)
              LIMIT 1`,
            providerFilter,
            providerFilter
          )
          .toArray();
        if (cooldownRows.length > 0) {
          this.setMeta(`refusal:${req.tenant}`, "all_cooldown");
        }
      }
      return null;
    }

    const toSafeInt = (v: unknown): number => {
      if (typeof v === "number") return Math.trunc(v);
      if (typeof v === "bigint") return parseInt(v.toString(10), 10);
      if (typeof v === "string") return parseInt(v, 10) || 0;
      return 0;
    };

    let candidates: CandidateRow[] = rawRows.map((r) => ({
      key_id: String(r.key_id),
      owner: String(r.owner),
      provider: String(r.provider),
      status: String(r.status),
      rpm_limit: toSafeInt(r.rpm_limit),
      rpd_limit: toSafeInt(r.rpd_limit),
      minute_count: toSafeInt(r.minute_count),
      day_count: toSafeInt(r.day_count),
      classification: typeof r.classification === "string" ? r.classification : null,
      priority_boost: toSafeInt(r.priority_boost ?? 0),
      debt_cu: toSafeInt(r.debt_cu ?? 0),
    }));

    const cappedOwners = new Set<string>();
    let shareCapPct = 100;
    let shareCapMode: "observe" | "enforce" = "observe";

    if (!req.ownOnly) {
      const effectiveEnv = this.getEffectiveEnv();
      shareCapMode = commonsEnforcement("share_cap", effectiveEnv);

      const ownerCountRows = sql
        .exec(
          `SELECT COUNT(DISTINCT owner) AS cnt
             FROM keys
            WHERE status = 'ACTIVE'
              AND (? IS NULL OR provider = ?)`,
          providerFilter,
          providerFilter
        )
        .toArray();
      const activeOwnersCount = toSafeInt(ownerCountRows[0]?.cnt ?? 0);
      shareCapPct = computeOwnerShareCapPct(activeOwnersCount);

      if (activeOwnersCount >= 2) {
        const cutoffHour = Math.floor((now - 24 * 3_600_000) / 3_600_000);
        const serviceRows = sql
          .exec(
            `SELECT owner, COALESCE(SUM(cu), 0) AS total_units
               FROM owner_service_window
              WHERE hour >= ?
              GROUP BY owner`,
            cutoffHour
          )
          .toArray();

        let totalPoolServedUnits = 0;
        const ownerServedMap = new Map<string, number>();
        for (const sr of serviceRows) {
          const units = toSafeInt(sr.total_units);
          if (units > 0) {
            totalPoolServedUnits += units;
            ownerServedMap.set(String(sr.owner), units);
          }
        }

        if (totalPoolServedUnits > 0) {
          for (const [ownerId, ownerUnits] of ownerServedMap.entries()) {
            if (ownerUnits * 100 >= shareCapPct * totalPoolServedUnits) {
              cappedOwners.add(ownerId);
            }
          }
        }
      }

      if (shareCapMode === "enforce" && cappedOwners.size > 0) {
        candidates = candidates.filter((c) => !cappedOwners.has(c.owner));
        if (candidates.length === 0) {
          this.setMeta(`refusal:${req.tenant}`, "share_cap");
          return null;
        }
      }
    }

    const scoreOf = (c: CandidateRow): number => {
      const positiveDebt = BigInt(Math.max(0, c.debt_cu));
      const rawBoost = positiveDebt / 10n;
      const cappedBoost = rawBoost > 5000n ? 5000n : rawBoost;
      const debtBoost = parseInt(cappedBoost.toString(10), 10);
      const classBoost =
        c.classification === "PARASITE" ? 2000 : c.classification === "HERO" ? -1000 : 0;
      const headroom = c.rpd_limit - c.day_count;
      return c.priority_boost + debtBoost + classBoost + headroom;
    };

    let maxScore = -Infinity;
    for (const c of candidates) {
      const s = scoreOf(c);
      if (s > maxScore) {
        maxScore = s;
      }
    }

    const topCandidates = candidates.filter((c) => scoreOf(c) === maxScore);
    topCandidates.sort((a, b) => a.key_id.localeCompare(b.key_id));

    const lastCursor = this.getMeta("rr_cursor") ?? "";
    let chosen = topCandidates.find((c) => c.key_id > lastCursor) ?? topCandidates[0];
    this.setMeta("rr_cursor", chosen.key_id);

    if (!req.ownOnly && shareCapMode === "observe" && cappedOwners.has(chosen.owner)) {
      await recordWouldDeny(
        "share_cap",
        chosen.owner,
        `cap=${shareCapPct}%`,
        this.getEffectiveEnv(),
        (p) => this.ctx.waitUntil(p)
      );
    }

    const borrowedInt = req.ownOnly ? 0 : 1;
    const estCu = req.estimateCu !== undefined ? toSafeInt(req.estimateCu) : 0;
    const leaseModel = (req.model ?? "default").trim() || "default";
    const leaseId = `lease_${now.toString(36)}_${crypto.randomUUID().slice(0, 8)}`;

    sql.exec(
      `UPDATE keys
          SET minute_count = minute_count + 1,
              day_count = day_count + 1,
              updated_at = ?
        WHERE key_id = ?`,
      now,
      chosen.key_id
    );

    sql.exec(
      `INSERT INTO leases (lease_id, key_id, tenant, borrowed, est_cu, model, created_at, settled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      leaseId,
      chosen.key_id,
      req.tenant,
      borrowedInt,
      estCu,
      leaseModel,
      now
    );

    return {
      leaseId,
      keyId: chosen.key_id,
      ownerTenantId: chosen.owner,
      provider: chosen.provider,
      source: req.ownOnly ? "own_community" : "borrowed",
    };
  }

  /**
   * Settles a lease idempotently (`settled_leases` table).
   * Updates key status on `key_invalid`, `rpd_exhausted`, `rpm_limited`, or `COOLDOWN`,
   * increments per-key and per-model dispatch counters, classifies on `rpd_exhausted`,
   * and records borrowed CU in `borrower_window` and `owner_service_window`.
   */
  public async settle(
    leaseId: string,
    status: string,
    cu: number | bigint = 0,
    until?: number,
    model?: string,
    latencyMs?: number
  ): Promise<CoordinatorSettleResult> {
    const sql = this.ensureSchema();
    const now = this.clock.now();

    const already = sql
      .exec("SELECT lease_id FROM settled_leases WHERE lease_id = ?", leaseId)
      .toArray();
    if (already.length > 0) {
      return { settled: false, duplicate: true };
    }

    const leaseRows = sql
      .exec("SELECT key_id, tenant, borrowed, model, created_at FROM leases WHERE lease_id = ?", leaseId)
      .toArray();
    const leaseRow = leaseRows[0];
    const keyId = leaseRow && typeof leaseRow.key_id === "string" ? leaseRow.key_id : undefined;
    const tenant = leaseRow && typeof leaseRow.tenant === "string" ? leaseRow.tenant : undefined;
    const borrowed = leaseRow ? Number(leaseRow.borrowed) === 1 : false;
    const createdAt =
      leaseRow && typeof leaseRow.created_at === "number" ? Number(leaseRow.created_at) : now;
    const resolvedModel =
      (
        model ??
        (leaseRow && typeof leaseRow.model === "string" ? leaseRow.model : undefined) ??
        "default"
      ).trim() || "default";

    let ownerTenantId: string | undefined;
    let keyProvider: string = this.getMeta("provider") ?? "google";
    if (keyId) {
      const kRows = sql
        .exec("SELECT owner, provider FROM keys WHERE key_id = ?", keyId)
        .toArray();
      if (kRows[0]) {
        if (typeof kRows[0].owner === "string") {
          ownerTenantId = kRows[0].owner;
        }
        if (typeof kRows[0].provider === "string" && kRows[0].provider.length > 0) {
          keyProvider = kRows[0].provider;
        }
      }
    }

    const numericUnits = Math.max(0, parseInt(String(cu), 10) || 0);

    sql.exec(
      "INSERT INTO settled_leases (lease_id, status, cu, settled_at) VALUES (?, ?, ?, ?)",
      leaseId,
      status,
      numericUnits,
      now
    );
    sql.exec("UPDATE leases SET settled_at = ? WHERE lease_id = ?", now, leaseId);

    const sampleLatency =
      latencyMs !== undefined && Number.isFinite(latencyMs)
        ? Math.max(0, Math.trunc(latencyMs))
        : Math.max(0, Math.trunc(now - createdAt));
    if (sampleLatency > 0 || latencyMs !== undefined) {
      sql.exec(
        "INSERT OR REPLACE INTO latency_samples (lease_id, latency_ms, recorded_at) VALUES (?, ?, ?)",
        leaseId,
        sampleLatency,
        now
      );
    }

    if (borrowed && tenant && numericUnits > 0) {
      const minute = Math.floor(now / 60_000);
      sql.exec(
        `INSERT INTO borrower_window (tenant, minute, cu)
         VALUES (?, ?, ?)
         ON CONFLICT(tenant, minute) DO UPDATE SET cu = borrower_window.cu + excluded.cu`,
        tenant,
        minute,
        numericUnits
      );
    }

    if (borrowed && ownerTenantId && numericUnits > 0) {
      const hour = Math.floor(now / 3_600_000);
      sql.exec(
        `INSERT INTO owner_service_window (owner, hour, cu)
         VALUES (?, ?, ?)
         ON CONFLICT(owner, hour) DO UPDATE SET cu = owner_service_window.cu + excluded.cu`,
        ownerTenantId,
        hour,
        numericUnits
      );
    }

    let classificationResult: CoordinatorKeyClassificationResult | undefined;

    if (keyId) {
      const borrowedInt = borrowed ? 1 : 0;
      sql.exec(
        `UPDATE keys
            SET dispatches_today = dispatches_today + 1,
                dispatches_communal = dispatches_communal + ?,
                updated_at = ?
          WHERE key_id = ?`,
        borrowedInt,
        now,
        keyId
      );

      sql.exec(
        `INSERT INTO key_model_stats (key_id, model, dispatches_today, dispatches_communal, cu_served)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(key_id, model) DO UPDATE SET
           dispatches_today = key_model_stats.dispatches_today + 1,
           dispatches_communal = key_model_stats.dispatches_communal + excluded.dispatches_communal,
           cu_served = key_model_stats.cu_served + excluded.cu_served`,
        keyId,
        resolvedModel,
        borrowedInt,
        numericUnits
      );

      const norm = status.trim().toLowerCase();
      const db = this.env.DB;
      const hasDb = Boolean(db && typeof db.prepare === "function");
      if (norm === "key_invalid" || norm === "quarantined") {
        await this.setStatus(keyId, "QUARANTINED");
        if (hasDb) {
          await db!
            .prepare(
              "UPDATE api_keys SET status = 'QUARANTINED', status_changed_at = ? WHERE id = ? AND status != 'REVOKED'"
            )
            .bind(now, keyId)
            .run();

          const keyRow = await db!
            .prepare("SELECT tenant_id, label, provider FROM api_keys WHERE id = ?")
            .bind(keyId)
            .first<{ tenant_id: string; label: string; provider: string }>();

          const targetTenant = keyRow?.tenant_id ?? ownerTenantId;
          if (targetTenant) {
            const notifId = "notif_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
            const normProv = (keyRow?.provider || "unknown").toLowerCase();
            const provDisplay = normProv === "google" || normProv === "gemini" ? "Gemini" : normProv === "groq" ? "Groq" : (keyRow?.provider || "unknown");
            const consoleDisplay = normProv === "google" || normProv === "gemini" ? "Google AI Studio" : normProv === "groq" ? "Groq Console" : `${provDisplay} dashboard`;
            const msg = `⚠️ Key [${keyRow?.label || keyId}] (${provDisplay}) went unhealthy. Check your ${consoleDisplay} and re-submit if needed.`;

            await db!
              .prepare(
                "INSERT INTO notifications (id, tenant_id, type, key_id, message, created_at, read_at) VALUES (?, ?, 'key_invalid', ?, ?, ?, NULL)"
              )
              .bind(notifId, targetTenant, keyId, msg, now)
              .run()
              .catch(() => {});
          }
        }
      } else if (norm === "rpd_exhausted" || norm === "rpm_limited" || norm === "cooldown") {
        const cooldownTarget =
          norm === "rpd_exhausted"
            ? nextProviderReset(keyProvider, now) + this.sampleResetJitterMs()
            : until ?? now + 60_000;
        await this.setStatus(keyId, "COOLDOWN", cooldownTarget);
        if (hasDb) {
          await db!
            .prepare(
              "UPDATE api_keys SET status = 'COOLDOWN', status_changed_at = ? WHERE id = ? AND status != 'REVOKED'"
            )
            .bind(now, keyId)
            .run();
        }
        if (norm === "rpd_exhausted") {
          classificationResult = await this.evaluateKeyClassificationOnExhaustion(
            keyId,
            resolvedModel,
            ownerTenantId,
            now
          );
        }
      } else if (norm === "ok") {
        if (hasDb) {
          await db!
            .prepare(
              "UPDATE api_keys SET status = 'HEALTHY', status_changed_at = ? WHERE id = ? AND status = 'COOLDOWN'"
            )
            .bind(now, keyId)
            .run();
        }
      }
    }

    return {
      settled: true,
      duplicate: false,
      keyId,
      ownerTenantId,
      borrowed,
      ...(classificationResult ? { classification: classificationResult } : {}),
    };
  }

  /**
   * Samples a uniform jitter offset in [0, 300_000) ms using `crypto.getRandomValues` (WP-5.8 T-5.8.2).
   * Uses a CSPRNG-seeded stratified cursor across 100 strata of 3,000 ms so every individual draw
   * is marginally Uniform(0, 300_000) and bursts of keys spread evenly without clustering.
   */
  private sampleResetJitterMs(): number {
    const rand = new Uint32Array(2);
    crypto.getRandomValues(rand);
    const existingCursor = this.getMeta("jitter_cursor");
    const cursor =
      existingCursor !== null ? parseInt(existingCursor, 10) || 0 : rand[0] % 100;
    const stratum = ((cursor % 100) + 100) % 100;
    this.setMeta("jitter_cursor", String((stratum + 1) % 100));
    const withinStratum = rand[1] % 3000;
    return stratum * 3000 + withinStratum;
  }

  /**
   * Evaluates D-16 hero/parasite and external-drain classification when a key hits RPD exhaustion.
   */
  private async evaluateKeyClassificationOnExhaustion(
    keyId: string,
    model: string,
    ownerTenantId: string | undefined,
    now: number
  ): Promise<CoordinatorKeyClassificationResult | undefined> {
    const sql = this.ensureSchema();
    const keyRows = sql
      .exec(
        "SELECT rpd_limit, drain_state, effective_rpd, consecutive_clean_days FROM keys WHERE key_id = ?",
        keyId
      )
      .toArray();
    if (keyRows.length === 0) return undefined;

    const kRow = keyRows[0];
    const dailyLimit = Math.max(1, Number(kRow.rpd_limit ?? 1500));
    let drainState: "OK" | "DRAINED" =
      String(kRow.drain_state ?? "OK") === "DRAINED" ? "DRAINED" : "OK";
    let effectiveRpd: number | null =
      typeof kRow.effective_rpd === "number" ? Number(kRow.effective_rpd) : null;
    let consecutiveCleanDays = Number(kRow.consecutive_clean_days ?? 0);

    const modelRows = sql
      .exec(
        "SELECT dispatches_today, dispatches_communal FROM key_model_stats WHERE key_id = ? AND model = ?",
        keyId,
        model
      )
      .toArray();
    const mRow = modelRows[0] ?? {};
    const modelDispatched = Math.max(1, Number(mRow.dispatches_today ?? 1));
    const modelCommunal = Math.max(0, Number(mRow.dispatches_communal ?? 0));

    const kcSeenPct = Math.floor((modelDispatched * 100) / dailyLimit);
    const communalPct = Math.floor((modelCommunal * 100) / modelDispatched);
    const currentDay = new Date(now).toISOString().slice(0, 10);

    const db = this.env.DB;
    const hasDb = Boolean(db && typeof db.prepare === "function");

    let resultLabel: string;
    if (kcSeenPct >= 50) {
      resultLabel = communalPct >= 80 ? "HERO" : "NORMAL";
      sql.exec(
        `INSERT INTO key_drain_history (key_id, day, drained, exhaustion_dispatches)
         VALUES (?, ?, 0, ?)
         ON CONFLICT(key_id, day) DO UPDATE SET
           drained = 0,
           exhaustion_dispatches = excluded.exhaustion_dispatches`,
        keyId,
        currentDay,
        modelDispatched
      );
      consecutiveCleanDays += 1;

      if (drainState === "DRAINED" && consecutiveCleanDays >= 3) {
        drainState = "OK";
        if (hasDb) {
          await db!
            .prepare("UPDATE api_keys SET drain_state = 'OK' WHERE id = ?")
            .bind(keyId)
            .run()
            .catch(() => {});
          if (ownerTenantId) {
            const notifId = `notif_${crypto.randomUUID()}`;
            await db!
              .prepare(
                `INSERT INTO notifications (id, tenant_id, type, key_id, message, created_at, read_at)
                 VALUES (?, ?, 'key_recovered', ?, 'Your key recovered from external drain and returned to full pool standing', ?, NULL)`
              )
              .bind(notifId, ownerTenantId, keyId, now)
              .run()
              .catch(() => {});
          }
        }
      }
    } else {
      resultLabel = "EXTERNALLY_DRAINED";
      sql.exec(
        `INSERT INTO key_drain_history (key_id, day, drained, exhaustion_dispatches)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(key_id, day) DO UPDATE SET
           drained = 1,
           exhaustion_dispatches = excluded.exhaustion_dispatches`,
        keyId,
        currentDay,
        modelDispatched
      );
      consecutiveCleanDays = 0;

      const cutoffDay7 = new Date(now - 6 * 86_400_000).toISOString().slice(0, 10);
      const recentDrainRows = sql
        .exec(
          `SELECT drained, exhaustion_dispatches
             FROM key_drain_history
            WHERE key_id = ? AND day >= ?
            ORDER BY day DESC
            LIMIT 7`,
          keyId,
          cutoffDay7
        )
        .toArray();

      const exhaustionCounts = recentDrainRows
        .filter((r) => Number(r.drained) === 1 && typeof r.exhaustion_dispatches === "number")
        .map((r) => Number(r.exhaustion_dispatches))
        .sort((a, b) => a - b);

      if (exhaustionCounts.length > 0) {
        effectiveRpd = exhaustionCounts[Math.floor(exhaustionCounts.length / 2)];
      }

      const drainedDaysIn7 = recentDrainRows.filter((r) => Number(r.drained) === 1).length;
      if (drainedDaysIn7 >= 5 && drainState !== "DRAINED") {
        drainState = "DRAINED";
        if (hasDb) {
          await db!
            .prepare("UPDATE api_keys SET drain_state = 'DRAINED' WHERE id = ?")
            .bind(keyId)
            .run()
            .catch(() => {});
          if (ownerTenantId) {
            const notifId = `notif_${crypto.randomUUID()}`;
            await db!
              .prepare(
                `INSERT INTO notifications (id, tenant_id, type, key_id, message, created_at, read_at)
                 VALUES (?, ?, 'key_drained', ?, 'Your key was externally drained on 5 of the last 7 days', ?, NULL)`
              )
              .bind(notifId, ownerTenantId, keyId, now)
              .run()
              .catch(() => {});
          }
        }
      }
    }

    sql.exec(
      `UPDATE keys
          SET classification = ?,
              drain_state = ?,
              effective_rpd = ?,
              consecutive_clean_days = ?,
              updated_at = ?
        WHERE key_id = ?`,
      resultLabel,
      drainState,
      effectiveRpd,
      consecutiveCleanDays,
      now,
      keyId
    );

    sql.exec(
      `UPDATE key_model_stats
          SET classification = ?,
              effective_rpd = ?
        WHERE key_id = ? AND model = ?`,
      resultLabel,
      effectiveRpd,
      keyId,
      model
    );

    const tel = (this.env as unknown as { TELEMETRY?: { writeDataPoint?: (pt: unknown) => void } })
      ?.TELEMETRY;
    if (tel && typeof tel.writeDataPoint === "function") {
      try {
        tel.writeDataPoint({
          blobs: ["key_classification", keyId, model, resultLabel, drainState],
          doubles: [kcSeenPct, communalPct, effectiveRpd ?? -1],
          indexes: [keyId],
        });
      } catch (err) {
        void err;
      }
    }

    return {
      kcSeenPct,
      communalPct,
      result: resultLabel,
      effectiveRpd,
      drainState,
    };
  }

  /**
   * Returns diagnostic state for a single key (and optional model) from SQLite storage.
   */
  public async getKeyState(
    keyId: string,
    model?: string
  ): Promise<CoordinatorKeyDiagnosticState | null> {
    const sql = this.ensureSchema();
    const rows = sql
      .exec(
        `SELECT key_id, owner, provider, status, rpd_limit, dispatches_today, dispatches_communal,
                classification, drain_state, effective_rpd, consecutive_clean_days,
                cooldown_until, reactivate_at
           FROM keys
          WHERE key_id = ?`,
        keyId
      )
      .toArray();
    if (rows.length === 0) return null;
    const r = rows[0];

    let modelStats: CoordinatorKeyDiagnosticState["modelStats"];
    if (model) {
      const mRows = sql
        .exec(
          `SELECT model, dispatches_today, dispatches_communal, cu_served, classification, effective_rpd
             FROM key_model_stats
            WHERE key_id = ? AND model = ?`,
          keyId,
          model
        )
        .toArray();
      if (mRows.length > 0) {
        const mr = mRows[0];
        modelStats = {
          model: String(mr.model),
          dispatchedToday: Number(mr.dispatches_today ?? 0),
          dispatchedCommunal: Number(mr.dispatches_communal ?? 0),
          cuServed: parseInt(String(mr.cu_served ?? 0), 10) || 0,
          classification: typeof mr.classification === "string" ? mr.classification : null,
          effectiveRpd: typeof mr.effective_rpd === "number" ? Number(mr.effective_rpd) : null,
        };
      }
    }

    return {
      keyId: String(r.key_id),
      owner: String(r.owner),
      provider: String(r.provider),
      status: String(r.status),
      rpdLimit: Number(r.rpd_limit ?? 0),
      dispatchedToday: Number(r.dispatches_today ?? 0),
      dispatchedCommunal: Number(r.dispatches_communal ?? 0),
      classification: typeof r.classification === "string" ? r.classification : null,
      drainState: String(r.drain_state ?? "OK") === "DRAINED" ? "DRAINED" : "OK",
      effectiveRpd: typeof r.effective_rpd === "number" ? Number(r.effective_rpd) : null,
      consecutiveCleanDays: Number(r.consecutive_clean_days ?? 0),
      cooldownUntil: typeof r.cooldown_until === "number" ? Number(r.cooldown_until) : null,
      reactivateAt: typeof r.reactivate_at === "number" ? Number(r.reactivate_at) : null,
      ...(modelStats ? { modelStats } : {}),
    };
  }

  /**
   * Reconciles the coordinator's SQLite `keys` table against D1 `api_keys` for `pool_type='COMMUNITY'`,
   * enforcing D-21 (`communityPool` eligibility on the key owner).
   */
  public async reconcile(provider?: string): Promise<{ upserted: number; removed: number }> {
    const sql = this.ensureSchema();
    const now = this.clock.now();
    const targetProvider = provider
      ? canonicalCoordinatorProvider(provider)
      : this.getMeta("provider");
    if (targetProvider) {
      this.setMeta("provider", targetProvider);
    }

    const db = this.env?.DB;
    if (!db || typeof db.prepare !== "function") {
      return { upserted: 0, removed: 0 };
    }

    const providerClause =
      targetProvider === "google"
        ? "AND lower(k.provider) IN ('google', 'gemini')"
        : targetProvider
        ? "AND lower(k.provider) = ?"
        : "";
    const bindArgs: unknown[] =
      targetProvider && targetProvider !== "google" ? [targetProvider] : [];

    const query = `
      SELECT k.id, k.tenant_id, k.provider, k.status, k.community_routing_status,
             k.observation_until, k.rpm_limit, k.rpd_limit
        FROM api_keys k
       WHERE k.pool_type = 'COMMUNITY'
         AND upper(k.status) != 'REVOKED'
         AND upper(COALESCE(k.community_routing_status, '')) != 'REVOKED'
         ${providerClause}
         AND EXISTS (
           SELECT 1 FROM users u
            WHERE u.id = k.tenant_id
              AND u.registration_status = 'ACTIVE'
              AND COALESCE(u.is_quarantined, 0) = 0
              AND u.community_eligible = 1
              AND EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'google')
              AND EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'github')
         )
    `;

    const result = await db
      .prepare(query)
      .bind(...bindArgs)
      .all<{
        id: string;
        tenant_id: string;
        provider: string;
        status: string;
        community_routing_status: string | null;
        observation_until: number | null;
        rpm_limit: number;
        rpd_limit: number;
      }>();

    const d1Rows = result.results ?? [];
    const validIds = new Set<string>();
    const currentMinute = Math.floor(now / 60_000);
    const currentDay = new Date(now).toISOString().slice(0, 10);

    for (const row of d1Rows) {
      validIds.add(row.id);
      const rowStatusUpper = (row.status ?? "HEALTHY").toUpperCase();
      const commStatusUpper = (row.community_routing_status ?? "ACTIVE").toUpperCase();
      let coordStatus: CoordinatorKeyStatus = "ACTIVE";
      if (rowStatusUpper === "QUARANTINED" || commStatusUpper === "QUARANTINED" || rowStatusUpper === "INVALID") {
        coordStatus = "QUARANTINED";
      } else if (rowStatusUpper === "COOLDOWN" || rowStatusUpper === "EXHAUSTED") {
        coordStatus = "COOLDOWN";
      } else if (
        commStatusUpper === "OBSERVATION" &&
        (row.observation_until === null || row.observation_until > now)
      ) {
        coordStatus = "OBSERVATION";
      }

      const normProv = canonicalCoordinatorProvider(row.provider);
      sql.exec(
        `INSERT INTO keys (
           key_id, owner, provider, status, observation_until, cooldown_until, reactivate_at,
           rpm_limit, rpd_limit, minute_bucket, minute_count, day_bucket, day_count,
           dispatches_today, dispatches_communal, classification, priority_boost, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 0, ?, 0, 0, 0, NULL, 0, ?)
         ON CONFLICT(key_id) DO UPDATE SET
           owner = excluded.owner,
           provider = excluded.provider,
           status = CASE
             WHEN keys.status = 'COOLDOWN' AND COALESCE(keys.reactivate_at, keys.cooldown_until, 0) > ? THEN 'COOLDOWN'
             ELSE excluded.status
           END,
           observation_until = excluded.observation_until,
           rpm_limit = excluded.rpm_limit,
           rpd_limit = excluded.rpd_limit,
           updated_at = excluded.updated_at`,
        row.id,
        row.tenant_id,
        normProv,
        coordStatus,
        row.observation_until ?? null,
        row.rpm_limit ?? (normProv === "groq" ? 30 : 15),
        row.rpd_limit ?? (normProv === "groq" ? 14400 : 1500),
        currentMinute,
        currentDay,
        now,
        now
      );
    }

    // Remove D1-backed keys in this coordinator that are no longer eligible/active in D1
    const existingRows = targetProvider
      ? sql.exec("SELECT key_id, owner FROM keys WHERE provider = ?", targetProvider).toArray()
      : sql.exec("SELECT key_id, owner FROM keys").toArray();

    let removed = 0;
    for (const r of existingRows) {
      const kid = String(r.key_id);
      const ownerId = String(r.owner ?? "");
      if (!validIds.has(kid)) {
        const d1Exists = await db
          .prepare(
            "SELECT 1 FROM users WHERE id = ? UNION ALL SELECT 1 FROM api_keys WHERE id = ? LIMIT 1"
          )
          .bind(ownerId, kid)
          .first();
        if (d1Exists) {
          sql.exec("DELETE FROM keys WHERE key_id = ?", kid);
          removed += 1;
        }
      }
    }

    this.setMeta("last_reconcile_ms", String(now));
    await this.ensureAlarmScheduled();
    return { upserted: d1Rows.length, removed };
  }

  /**
   * Returns summary statistics for this coordinator shard.
   */
  public async stats(): Promise<CoordinatorStats> {
    const sql = this.ensureSchema();
    const now = this.clock.now();
    const cutoffMinute = Math.floor((now - BORROWER_WINDOW_MINUTES * 60_000) / 60_000);

    const keyAgg = sql
      .exec(
        `SELECT
           SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_keys,
           SUM(CASE WHEN status = 'OBSERVATION' THEN 1 ELSE 0 END) AS observation_keys,
           SUM(CASE WHEN status = 'COOLDOWN' THEN 1 ELSE 0 END) AS cooldown_keys,
           SUM(CASE WHEN status = 'QUARANTINED' THEN 1 ELSE 0 END) AS quarantined_keys,
           SUM(CASE WHEN status = 'REVOKED' THEN 1 ELSE 0 END) AS revoked_keys,
           COALESCE(SUM(dispatches_today), 0) AS dispatches_today,
           COALESCE(SUM(dispatches_communal), 0) AS dispatches_communal,
           COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN day_count ELSE 0 END), 0) AS active_day_count,
           COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN rpd_limit ELSE 0 END), 0) AS active_rpd_limit
         FROM keys`
      )
      .toArray()[0] ?? {};

    const winAgg = sql
      .exec(
        "SELECT COALESCE(SUM(cu), 0) AS total_cu FROM borrower_window WHERE minute >= ?",
        cutoffMinute
      )
      .toArray()[0] ?? {};

    const brakeAgg = sql
      .exec("SELECT COUNT(*) AS cnt FROM brakes WHERE until > ?", now)
      .toArray()[0] ?? {};

    const activeKeys = Number(keyAgg.active_keys ?? 0);
    const observationKeys = Number(keyAgg.observation_keys ?? 0);
    const cooldownKeys = Number(keyAgg.cooldown_keys ?? 0);
    const quarantinedKeys = Number(keyAgg.quarantined_keys ?? 0);
    const revokedKeys = Number(keyAgg.revoked_keys ?? 0);
    const activeDayCount = Number(keyAgg.active_day_count ?? 0);
    const activeRpdLimit = Number(keyAgg.active_rpd_limit ?? 0);

    const utilisationPct =
      activeRpdLimit > 0
        ? Math.min(100, Math.floor((activeDayCount * 100) / activeRpdLimit))
        : 0;

    const latencyCountRow =
      sql
        .exec(
          "SELECT COUNT(*) AS total FROM latency_samples WHERE recorded_at > ?",
          now - SETTLED_LEASE_TTL_MS
        )
        .toArray()[0] ?? {};
    const totalLatencySamples = Number(latencyCountRow.total ?? 0);
    let p90LatencyMs = 0;
    if (totalLatencySamples > 0) {
      const offset = Math.max(0, Math.ceil(totalLatencySamples * 0.9) - 1);
      const latRow =
        sql
          .exec(
            `SELECT latency_ms
               FROM latency_samples
              WHERE recorded_at > ?
              ORDER BY latency_ms ASC
              LIMIT 1 OFFSET ?`,
            now - SETTLED_LEASE_TTL_MS,
            offset
          )
          .toArray()[0] ?? {};
      p90LatencyMs = Math.max(0, Math.trunc(Number(latRow.latency_ms ?? 0)));
    }

    const TARGET_P90_MS = 800;
    const totalHealthKeys = activeKeys + quarantinedKeys;
    const activeRatioPct =
      totalHealthKeys > 0 ? Math.floor((activeKeys * 100) / totalHealthKeys) : 100;
    const latencyFactorPct =
      p90LatencyMs > 0
        ? Math.min(100, Math.floor((TARGET_P90_MS * 100) / p90LatencyMs))
        : 100;
    const wProviderPct =
      totalHealthKeys > 0
        ? Math.floor((activeRatioPct * latencyFactorPct) / 100)
        : 100;

    return {
      activeKeys,
      observationKeys,
      cooldownKeys,
      quarantinedKeys,
      revokedKeys,
      dispatchedToday: Number(keyAgg.dispatches_today ?? 0),
      dispatchedCommunal: Number(keyAgg.dispatches_communal ?? 0),
      borrowerCuInWindow: parseInt(String(winAgg.total_cu ?? 0), 10) || 0,
      activeBrakes: Number(brakeAgg.cnt ?? 0),
      utilisationPct,
      p90LatencyMs,
      wProviderPct,
    };
  }

  /**
   * Returns per-owner community key counts and dispatch counters in this shard (WP-5.3 T-5.3.4).
   */
  public async ownerStats(owner: string): Promise<{
    totalCommunityKeys: number;
    activeCommunityKeys: number;
    dispatchedToday: number;
    dispatchedCommunal: number;
  }> {
    const sql = this.ensureSchema();
    const row =
      sql
        .exec(
          `SELECT
             COUNT(*) AS total_keys,
             COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active_keys,
             COALESCE(SUM(dispatches_today), 0) AS dispatches_today,
             COALESCE(SUM(dispatches_communal), 0) AS dispatches_communal
           FROM keys
           WHERE owner = ? AND status != 'REVOKED'`,
          owner
        )
        .toArray()[0] ?? {};
    return {
      totalCommunityKeys: Number(row.total_keys ?? 0),
      activeCommunityKeys: Number(row.active_keys ?? 0),
      dispatchedToday: Number(row.dispatches_today ?? 0),
      dispatchedCommunal: Number(row.dispatches_communal ?? 0),
    };
  }

  /**
   * Returns all non-revoked, non-quarantined community keys owned by `owner` in this shard (WP-5.9 T-5.9.1).
   */
  public async getOwnerCommunityKeys(
    owner: string
  ): Promise<Array<{ keyId: string; provider: string; status: CoordinatorKeyStatus }>> {
    const sql = this.ensureSchema();
    const rows = sql
      .exec(
        `SELECT key_id, provider, status
           FROM keys
          WHERE owner = ?
            AND status NOT IN ('REVOKED', 'QUARANTINED')
          ORDER BY key_id ASC`,
        owner
      )
      .toArray();
    return rows.map((r) => ({
      keyId: String(r.key_id),
      provider: String(r.provider),
      status: String(r.status) as CoordinatorKeyStatus,
    }));
  }

  /**
   * Returns per-key dispatch counters and status for the requested key IDs (or all keys when omitted) (WP-5.10 T-5.10.2).
   */
  public async getKeysCounterMap(
    keyIds?: string[]
  ): Promise<
    Record<
      string,
      {
        dispatchedToday: number;
        dispatchedCommunal: number;
        status: CoordinatorKeyStatus;
        observationUntil: number | null;
      }
    >
  > {
    const sql = this.ensureSchema();
    const filterSet = keyIds && keyIds.length > 0 ? new Set(keyIds) : null;
    const rows = sql
      .exec(
        `SELECT key_id, status, observation_until, dispatches_today, dispatches_communal
           FROM keys`
      )
      .toArray();
    const out: Record<
      string,
      {
        dispatchedToday: number;
        dispatchedCommunal: number;
        status: CoordinatorKeyStatus;
        observationUntil: number | null;
      }
    > = {};
    for (const r of rows) {
      const kid = String(r.key_id);
      if (filterSet && !filterSet.has(kid)) continue;
      out[kid] = {
        dispatchedToday: Number(r.dispatches_today ?? 0),
        dispatchedCommunal: Number(r.dispatches_communal ?? 0),
        status: String(r.status) as CoordinatorKeyStatus,
        observationUntil:
          typeof r.observation_until === "number" ? Number(r.observation_until) : null,
      };
    }
    return out;
  }

  /**
   * 60-second alarm:
   * - Promotes OBSERVATION keys past `observation_until`
   * - Reactivates COOLDOWN keys past `reactivate_at`
   * - Prunes expired `brakes`, old `borrower_window` rows, and 24h-expired `settled_leases` / `latency_samples`
   * - Hourly sub-tick (WP-5.10 T-5.10.1): snapshots shard telemetry stats into `meta`
   * - Reconciles against D1 every 5 minutes
   */
  public async alarm(): Promise<void> {
    const sql = this.ensureSchema();
    const now = this.clock.now();

    await this.promoteObservationKeys(false, now);
    await this.promoteAndResetBuckets(now);

    // Prune expired brakes and old borrower_window / owner_service_window / settled_leases / latency_samples
    sql.exec("DELETE FROM brakes WHERE until <= ?", now);
    const cutoffMinute = Math.floor((now - BORROWER_WINDOW_MINUTES * 60_000) / 60_000);
    sql.exec("DELETE FROM borrower_window WHERE minute < ?", cutoffMinute);
    const cutoffHour = Math.floor((now - 24 * 3_600_000) / 3_600_000);
    sql.exec("DELETE FROM owner_service_window WHERE hour < ?", cutoffHour);
    sql.exec("DELETE FROM settled_leases WHERE settled_at <= ?", now - SETTLED_LEASE_TTL_MS);
    sql.exec("DELETE FROM latency_samples WHERE recorded_at <= ?", now - SETTLED_LEASE_TTL_MS);

    // Hourly sub-tick (WP-5.10 T-5.10.1 & WP-5.12 T-5.12.1): compute and cache shard stats snapshot + pool:bands
    const currentHourBucket = String(Math.floor(now / 3_600_000));
    if (this.getMeta("last_hourly_tick") !== currentHourBucket) {
      const st = await this.stats();
      this.setMeta("last_hourly_tick", currentHourBucket);
      this.setMeta("hourly_stats_json", JSON.stringify(st));
      const bandCap =
        st.utilisationPct < 60
          ? 450
          : st.utilisationPct < 80
          ? 300
          : st.utilisationPct < 95
          ? 150
          : 100;
      const prevBandCap = Number(this.getMeta("pool:band_cap") ?? "0");
      this.setMeta("pool:band_cap", String(bandCap));
      this.setMeta(
        "pool:bands",
        JSON.stringify({
          utilisationPct: st.utilisationPct,
          bandCap,
          updatedAt: now,
        })
      );
      const shardProv = this.getMeta("provider");
      const coordNs = (this.env as unknown as { POOL_COORDINATOR?: DurableObjectNamespace })
        ?.POOL_COORDINATOR;
      if (
        prevBandCap !== bandCap &&
        shardProv &&
        coordNs &&
        typeof coordNs.idFromName === "function" &&
        typeof coordNs.get === "function"
      ) {
        try {
          const bandsStub = coordNs.get(coordNs.idFromName("pool:bands")) as unknown as {
            setPoolBand?(provider: string, utilisationPct: number, bandCap: number): Promise<void>;
          };
          if (typeof bandsStub.setPoolBand === "function") {
            await bandsStub.setPoolBand(shardProv, st.utilisationPct, bandCap);
          }
        } catch (err) {
          void err;
        }
      }
    }

    // Expire ROTATING project hashes into TOMBSTONED after 30 minutes (WP-5.11 T-5.11.3)
    if (this.env?.DB && typeof this.env.DB.prepare === "function") {
      await this.env.DB.prepare(
        `UPDATE project_hash_registry
            SET state = 'TOMBSTONED',
                tombstone_until = rotating_until + ?,
                updated_at = ?
          WHERE state = 'ROTATING'
            AND rotating_until IS NOT NULL
            AND rotating_until <= ?`
      )
        .bind(14 * 86_400_000, now, now)
        .run()
        .catch((err) => {
          void err;
        });
    }

    // Reconcile against D1 every 5 minutes when a D1 binding and provider are present
    const lastReconcile = Number(this.getMeta("last_reconcile_ms") ?? "0");
    const knownProvider = this.getMeta("provider");
    if (
      this.env?.DB &&
      knownProvider &&
      now - lastReconcile >= RECONCILE_INTERVAL_MS
    ) {
      await this.reconcile(knownProvider);
    }

    if (typeof this.ctx.storage?.setAlarm === "function") {
      await this.ctx.storage.setAlarm(now + ALARM_INTERVAL_MS);
    }
  }

  /**
   * Only the test-only clock endpoint remains on HTTP `fetch`; all legacy HTTP routes are removed.
   */
  public async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/__test__/clock") {
      if (req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as { ms?: number };
        this.setClockForTest(Number(body.ms));
        return Response.json({ now: this.clock.now() });
      }
      const alarm =
        typeof this.ctx.storage?.getAlarm === "function"
          ? await this.ctx.storage.getAlarm()
          : null;
      return Response.json({ now: this.clock.now(), alarm });
    }

    return new Response("Not Found", { status: 404 });
  }

  /**
   * Stores a provider band entry in `pool:bands` (WP-5.12 T-5.12.1).
   */
  public async setPoolBand(
    provider: string,
    utilisationPct: number,
    bandCap: number
  ): Promise<void> {
    this.ensureSchema();
    const canon = canonicalCoordinatorProvider(provider);
    const existingRaw = this.getMeta("pool:bands_map");
    let map: Record<string, { utilisationPct: number; bandCap: number; updatedAt: number }> = {};
    if (existingRaw) {
      try {
        map = JSON.parse(existingRaw) as typeof map;
      } catch (err) {
        void err;
      }
    }
    map[canon] = {
      utilisationPct: Math.trunc(utilisationPct),
      bandCap: Math.trunc(bandCap),
      updatedAt: this.clock.now(),
    };
    this.setMeta("pool:bands_map", JSON.stringify(map));
  }

  /**
   * Returns the current `pool:bands` map (WP-5.12 T-5.12.1).
   */
  public async getPoolBands(): Promise<
    Record<string, { utilisationPct: number; bandCap: number; updatedAt: number }>
  > {
    this.ensureSchema();
    const existingRaw = this.getMeta("pool:bands_map");
    if (existingRaw) {
      try {
        return JSON.parse(existingRaw) as Record<
          string,
          { utilisationPct: number; bandCap: number; updatedAt: number }
        >;
      } catch (err) {
        void err;
      }
    }
    const selfBands = this.getMeta("pool:bands");
    const prov = this.getMeta("provider");
    if (selfBands && prov) {
      try {
        const parsed = JSON.parse(selfBands) as {
          utilisationPct: number;
          bandCap: number;
          updatedAt: number;
        };
        return { [prov]: parsed };
      } catch (err) {
        void err;
      }
    }
    return {};
  }

  /**
   * Public RPC accessor for the DO's current clock timestamp.
   */
  public getNow(): number {
    return this.clock.now();
  }

  /**
   * Test-only RPC: switches this DO to a fixed clock. Throws outside the
   * test environment (env.KC_ENV !== "test").
   */
  public setClockForTest(ms: number): void {
    const envRecord = this.env as unknown as { KC_ENV?: string } | undefined;
    if (envRecord?.KC_ENV !== "test") {
      throw new Error("setClockForTest is only available when KC_ENV=test");
    }
    this.clock = { now: () => ms };
  }
}
