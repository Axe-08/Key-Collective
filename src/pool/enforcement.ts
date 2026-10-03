/**
 * Key Collective v3 — Commons Enforcement Switch & Would-Deny Tracking
 *
 * Implements WP-5.1 (D-24):
 * - Reads COMMONS_ENFORCEMENT ("observe" | "enforce", default "observe")
 * - Reads optional COMMONS_ENFORCE_RULES (comma-separated list of enforced rules)
 * - Emits commons_would_deny telemetry with SHA-256 hashed tenant IDs
 * - Durable hourly would-deny counters in D1 (would_deny_hourly, WP-F.10 AU-03)
 */

import type { WorkerEnv } from "../worker/auth/types";
import { Logger } from "../utils/logger";

export type CommonsRule = "brake" | "eye_for_eye" | "share_cap" | "jail";

export interface WouldDenyStats {
  rules: Record<CommonsRule, number>;
  topTenants: Array<{
    tenantHash: string;
    count: number;
    rules: Record<CommonsRule, number>;
  }>;
  total: number;
}

const HOUR_MS = 3_600_000;
const COMMONS_RULES: readonly CommonsRule[] = ["brake", "eye_for_eye", "share_cap", "jail"];

function emptyRuleCounts(): Record<CommonsRule, number> {
  return { brake: 0, eye_for_eye: 0, share_cap: 0, jail: 0 };
}

function isCommonsRule(value: string): value is CommonsRule {
  return (COMMONS_RULES as readonly string[]).includes(value);
}

function d1From(aeOrEnv: unknown): D1Database | null {
  if (!aeOrEnv || typeof aeOrEnv !== "object" || !("DB" in aeOrEnv)) return null;
  const db = (aeOrEnv as { DB?: unknown }).DB;
  if (db && typeof db === "object" && typeof (db as { prepare?: unknown }).prepare === "function") {
    return db as D1Database;
  }
  return null;
}

/**
 * Computes SHA-256 hex digest for a tenant identifier to ensure privacy in telemetry.
 */
export async function hashTenantId(tenantId: string): Promise<string> {
  if (/^[a-f0-9]{64}$/i.test(tenantId)) {
    return tenantId.toLowerCase();
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(tenantId);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Determines whether a specific commons rule should be actively enforced or observed.
 *
 * Defaults to "observe" unless:
 * 1. env.COMMONS_ENFORCEMENT is explicitly "enforce"
 * 2. If env.COMMONS_ENFORCE_RULES is defined, rule must be present in the comma-separated list.
 */
export function commonsEnforcement(
  rule: CommonsRule,
  env?: Partial<WorkerEnv> | Record<string, unknown>
): "observe" | "enforce" {
  if (!env || !env.COMMONS_ENFORCEMENT) {
    return "observe";
  }

  const mode = String(env.COMMONS_ENFORCEMENT).trim().toLowerCase();
  if (mode !== "enforce") {
    return "observe";
  }

  const enforceRules = env.COMMONS_ENFORCE_RULES;
  if (typeof enforceRules === "string" && enforceRules.trim().length > 0) {
    const rulesList = enforceRules
      .split(",")
      .map((r) => r.trim().toLowerCase())
      .filter((r) => r.length > 0);
    if (rulesList.length > 0) {
      return rulesList.includes(rule.toLowerCase()) ? "enforce" : "observe";
    }
  }

  return "enforce";
}

/**
 * Records a hypothetical refusal event when a commons rule triggers under observe mode.
 * Emits a privacy-preserving telemetry data point and upserts the hourly counter in D1
 * (`would_deny_hourly`) when the env carries a `DB` binding. The D1 write goes through
 * `waitUntil` when one is given; a failure is logged and never thrown.
 */
export async function recordWouldDeny(
  rule: CommonsRule,
  tenantIdOrHash: string,
  detail: string = "",
  aeOrEnv?: unknown,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<void> {
  const tenantHash = await hashTenantId(tenantIdOrHash);
  const now = Date.now();
  const logger = new Logger({ traceId: "commons-would-deny", tenantId: tenantHash });

  const db = d1From(aeOrEnv);
  if (db) {
    const write = db
      .prepare(
        `INSERT INTO would_deny_hourly (hour_utc, rule, tenant_hash, count) VALUES (?, ?, ?, 1)
         ON CONFLICT(hour_utc, rule, tenant_hash) DO UPDATE SET count = count + 1`
      )
      .bind(Math.floor(now / HOUR_MS), rule, tenantHash)
      .run()
      .then(
        () => undefined,
        (err: unknown) => {
          logger.error("would_deny_write_failed", { rule, error: err });
        }
      );
    if (waitUntil) {
      waitUntil(write);
    } else {
      await write;
    }
  }

  // Extract analytics dataset binding from argument
  let ae: { writeDataPoint?: (point: unknown) => void } | null = null;
  if (aeOrEnv && typeof aeOrEnv === "object") {
    if ("writeDataPoint" in aeOrEnv && typeof (aeOrEnv as { writeDataPoint: unknown }).writeDataPoint === "function") {
      ae = aeOrEnv as { writeDataPoint: (point: unknown) => void };
    } else if ("TELEMETRY" in aeOrEnv && (aeOrEnv as { TELEMETRY?: { writeDataPoint?: unknown } }).TELEMETRY) {
      const tel = (aeOrEnv as { TELEMETRY?: { writeDataPoint?: unknown } }).TELEMETRY;
      if (tel && typeof tel.writeDataPoint === "function") {
        ae = tel as { writeDataPoint: (point: unknown) => void };
      }
    }
  }

  if (ae && typeof ae.writeDataPoint === "function") {
    try {
      ae.writeDataPoint({
        blobs: ["commons_would_deny", rule, tenantHash, detail],
        doubles: [now],
        indexes: [tenantHash],
      });
    } catch (err) {
      // Non-blocking telemetry invariant
      void err;
    }
  }
}

/**
 * Aggregates would-deny counts from D1 over the trailing `hours` hourly buckets
 * (the current hour included).
 */
export async function getWouldDenyStats(db: D1Database, hours: number = 24): Promise<WouldDenyStats> {
  const windowHours = Math.max(1, Math.floor(hours));
  const minHour = Math.floor(Date.now() / HOUR_MS) - windowHours + 1;

  const ruleRows = await db
    .prepare(
      "SELECT rule, SUM(count) AS total FROM would_deny_hourly WHERE hour_utc >= ? GROUP BY rule"
    )
    .bind(minHour)
    .all<{ rule: string; total: number }>();

  const ruleCounts = emptyRuleCounts();
  let total = 0;
  for (const row of ruleRows.results ?? []) {
    const n = Number(row.total) || 0;
    if (isCommonsRule(row.rule)) {
      ruleCounts[row.rule] += n;
    }
    total += n;
  }

  const tenantRows = await db
    .prepare(
      `SELECT w.tenant_hash, w.rule, SUM(w.count) AS total
         FROM would_deny_hourly w
         JOIN (
           SELECT tenant_hash, SUM(count) AS t
             FROM would_deny_hourly
            WHERE hour_utc >= ?
            GROUP BY tenant_hash
            ORDER BY t DESC, tenant_hash ASC
            LIMIT 10
         ) top ON top.tenant_hash = w.tenant_hash
        WHERE w.hour_utc >= ?
        GROUP BY w.tenant_hash, w.rule`
    )
    .bind(minHour, minHour)
    .all<{ tenant_hash: string; rule: string; total: number }>();

  const tenantMap = new Map<string, { count: number; rules: Record<CommonsRule, number> }>();
  for (const row of tenantRows.results ?? []) {
    let tenantData = tenantMap.get(row.tenant_hash);
    if (!tenantData) {
      tenantData = { count: 0, rules: emptyRuleCounts() };
      tenantMap.set(row.tenant_hash, tenantData);
    }
    const n = Number(row.total) || 0;
    tenantData.count += n;
    if (isCommonsRule(row.rule)) {
      tenantData.rules[row.rule] += n;
    }
  }

  const topTenants = Array.from(tenantMap.entries())
    .map(([tenantHash, data]) => ({ tenantHash, count: data.count, rules: data.rules }))
    .sort((a, b) => b.count - a.count || a.tenantHash.localeCompare(b.tenantHash));

  return { rules: ruleCounts, topTenants, total };
}
