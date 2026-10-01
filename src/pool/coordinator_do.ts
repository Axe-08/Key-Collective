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
import { Clock, systemClock } from "../utils/clock";
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
}

export interface CoordinatorLease {
  leaseId: string;
  keyId: string;
  ownerTenantId: string;
  provider: string;
  source: "own_community" | "borrowed";
}

export interface CoordinatorSettleResult {
  settled: boolean;
  duplicate: boolean;
  keyId?: string;
  ownerTenantId?: string;
  borrowed?: boolean;
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
const BORROWER_WINDOW_MINUTES = 5;
const SETTLED_LEASE_TTL_MS = 24 * 60 * 60 * 1000;

export function canonicalCoordinatorProvider(provider: string): "google" | "groq" | string {
  const clean = provider.trim().toLowerCase();
  if (clean === "gemini" || clean === "google") return "google";
  return clean;
}

export class PoolCoordinatorDO extends DurableObject<WorkerEnv> {
  private clock: Clock = systemClock;
  private schemaInitialized = false;

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
        dispatched_today INTEGER NOT NULL DEFAULT 0,
        dispatched_communal INTEGER NOT NULL DEFAULT 0,
        classification TEXT,
        priority_boost INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leases (
        lease_id TEXT PRIMARY KEY,
        key_id TEXT,
        tenant TEXT,
        borrowed INTEGER,
        est_cu INTEGER,
        created_at INTEGER,
        settled_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS settled_leases (
        lease_id TEXT PRIMARY KEY,
        status TEXT,
        cu INTEGER,
        settled_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS borrower_window (
        tenant TEXT,
        minute INTEGER,
        cu INTEGER,
        PRIMARY KEY (tenant, minute)
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
        // Non-blocking sync
        void err;
      }
    }
  }

  private promoteAndResetBuckets(now: number): { currentMinute: number; currentDay: string } {
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

    // Roll day buckets
    sql.exec(
      `UPDATE keys
          SET day_bucket = ?, day_count = 0, dispatched_today = 0, dispatched_communal = 0
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
         dispatched_today, dispatched_communal, classification, priority_boost, updated_at
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
   * Acquires a key lease from the coordinator.
   * - `ownOnly: true`: selects from the caller's own COMMUNITY keys (`ACTIVE` or `OBSERVATION`), no debt.
   * - `ownOnly: false`: selects from other contributors' `ACTIVE` COMMUNITY keys, scored by
   *   `priority_boost + min(5000, floor(owner_debt_cu / 10)) + classification_boost + headroom`,
   *   tie-broken round-robin with a rotating cursor.
   */
  public async lease(req: CoordinatorLeaseRequest): Promise<CoordinatorLease | null> {
    const sql = this.ensureSchema();
    const now = this.clock.now();
    this.promoteAndResetBuckets(now);

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
              AND k.day_count < k.rpd_limit
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
      return null;
    }

    const toSafeInt = (v: unknown): number => {
      if (typeof v === "number") return Math.trunc(v);
      if (typeof v === "bigint") return parseInt(v.toString(10), 10);
      if (typeof v === "string") return parseInt(v, 10) || 0;
      return 0;
    };

    const candidates: CandidateRow[] = rawRows.map((r) => ({
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

    const borrowedInt = req.ownOnly ? 0 : 1;
    const estCu = req.estimateCu !== undefined ? toSafeInt(req.estimateCu) : 0;
    const leaseId = `lease_${now.toString(36)}_${crypto.randomUUID().slice(0, 8)}`;

    sql.exec(
      `UPDATE keys
          SET minute_count = minute_count + 1,
              day_count = day_count + 1,
              dispatched_today = dispatched_today + 1,
              dispatched_communal = dispatched_communal + ?,
              updated_at = ?
        WHERE key_id = ?`,
      borrowedInt,
      now,
      chosen.key_id
    );

    sql.exec(
      `INSERT INTO leases (lease_id, key_id, tenant, borrowed, est_cu, created_at, settled_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      leaseId,
      chosen.key_id,
      req.tenant,
      borrowedInt,
      estCu,
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
   * and records borrowed CU in `borrower_window`.
   */
  public async settle(
    leaseId: string,
    status: string,
    cu: number | bigint = 0,
    until?: number
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
      .exec("SELECT key_id, tenant, borrowed FROM leases WHERE lease_id = ?", leaseId)
      .toArray();
    const leaseRow = leaseRows[0];
    const keyId = leaseRow && typeof leaseRow.key_id === "string" ? leaseRow.key_id : undefined;
    const tenant = leaseRow && typeof leaseRow.tenant === "string" ? leaseRow.tenant : undefined;
    const borrowed = leaseRow ? Number(leaseRow.borrowed) === 1 : false;

    let ownerTenantId: string | undefined;
    if (keyId) {
      const kRows = sql.exec("SELECT owner FROM keys WHERE key_id = ?", keyId).toArray();
      if (kRows[0] && typeof kRows[0].owner === "string") {
        ownerTenantId = kRows[0].owner;
      }
    }

    const numericCu = Math.max(0, Number(cu));

    sql.exec(
      "INSERT INTO settled_leases (lease_id, status, cu, settled_at) VALUES (?, ?, ?, ?)",
      leaseId,
      status,
      numericCu,
      now
    );
    sql.exec("UPDATE leases SET settled_at = ? WHERE lease_id = ?", now, leaseId);

    if (borrowed && tenant && numericCu > 0) {
      const minute = Math.floor(now / 60_000);
      sql.exec(
        `INSERT INTO borrower_window (tenant, minute, cu)
         VALUES (?, ?, ?)
         ON CONFLICT(tenant, minute) DO UPDATE SET cu = borrower_window.cu + excluded.cu`,
        tenant,
        minute,
        numericCu
      );
    }

    if (keyId) {
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
        await this.setStatus(keyId, "COOLDOWN", until ?? now + 60_000);
        if (hasDb) {
          await db!
            .prepare(
              "UPDATE api_keys SET status = 'COOLDOWN', status_changed_at = ? WHERE id = ? AND status != 'REVOKED'"
            )
            .bind(now, keyId)
            .run();
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
           dispatched_today, dispatched_communal, classification, priority_boost, updated_at
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

    // Remove keys in this coordinator that are no longer eligible/active in D1
    const existingRows = targetProvider
      ? sql.exec("SELECT key_id FROM keys WHERE provider = ?", targetProvider).toArray()
      : sql.exec("SELECT key_id FROM keys").toArray();

    let removed = 0;
    for (const r of existingRows) {
      const kid = String(r.key_id);
      if (!validIds.has(kid)) {
        sql.exec("DELETE FROM keys WHERE key_id = ?", kid);
        removed += 1;
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
           COALESCE(SUM(dispatched_today), 0) AS dispatched_today,
           COALESCE(SUM(dispatched_communal), 0) AS dispatched_communal
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

    return {
      activeKeys: Number(keyAgg.active_keys ?? 0),
      observationKeys: Number(keyAgg.observation_keys ?? 0),
      cooldownKeys: Number(keyAgg.cooldown_keys ?? 0),
      quarantinedKeys: Number(keyAgg.quarantined_keys ?? 0),
      revokedKeys: Number(keyAgg.revoked_keys ?? 0),
      dispatchedToday: Number(keyAgg.dispatched_today ?? 0),
      dispatchedCommunal: Number(keyAgg.dispatched_communal ?? 0),
      borrowerCuInWindow: parseInt(String(winAgg.total_cu ?? 0), 10) || 0,
      activeBrakes: Number(brakeAgg.cnt ?? 0),
    };
  }

  /**
   * 60-second alarm:
   * - Promotes OBSERVATION keys past `observation_until`
   * - Reactivates COOLDOWN keys past `reactivate_at`
   * - Prunes expired `brakes`, old `borrower_window` rows, and 24h-expired `settled_leases`
   * - Reconciles against D1 every 5 minutes
   */
  public async alarm(): Promise<void> {
    const sql = this.ensureSchema();
    const now = this.clock.now();

    await this.promoteObservationKeys(false, now);
    this.promoteAndResetBuckets(now);

    // Prune expired brakes and old borrower_window / settled_leases
    sql.exec("DELETE FROM brakes WHERE until <= ?", now);
    const cutoffMinute = Math.floor((now - BORROWER_WINDOW_MINUTES * 60_000) / 60_000);
    sql.exec("DELETE FROM borrower_window WHERE minute < ?", cutoffMinute);
    sql.exec("DELETE FROM settled_leases WHERE settled_at <= ?", now - SETTLED_LEASE_TTL_MS);

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
