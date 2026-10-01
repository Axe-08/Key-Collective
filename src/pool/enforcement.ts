/**
 * Key Collective v3 — Commons Enforcement Switch & Would-Deny Tracking
 *
 * Implements WP-5.1 (D-24):
 * - Reads COMMONS_ENFORCEMENT ("observe" | "enforce", default "observe")
 * - Reads optional COMMONS_ENFORCE_RULES (comma-separated list of enforced rules)
 * - Emits commons_would_deny telemetry with SHA-256 hashed tenant IDs
 * - Bounded in-memory event buffer for admin surveillance inspection
 */

import type { WorkerEnv } from "../worker/auth/types";

export type CommonsRule = "brake" | "eye_for_eye" | "share_cap" | "jail";

export interface WouldDenyEvent {
  rule: CommonsRule;
  tenantHash: string;
  detail: string;
  timestamp: number;
}

export interface WouldDenyStats {
  rules: Record<CommonsRule, number>;
  topTenants: Array<{
    tenantHash: string;
    count: number;
    rules: Record<CommonsRule, number>;
  }>;
  total: number;
}

/** Maximum in-memory would-deny events to retain for local aggregation */
const MAX_WOULD_DENY_EVENTS = 10_000;

const inMemoryWouldDenyEvents: WouldDenyEvent[] = [];

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
 * Emits a privacy-preserving telemetry data point and stores the event for admin review.
 */
export async function recordWouldDeny(
  rule: CommonsRule,
  tenantIdOrHash: string,
  detail: string = "",
  aeOrEnv?: unknown
): Promise<void> {
  const tenantHash = await hashTenantId(tenantIdOrHash);
  const now = Date.now();

  const event: WouldDenyEvent = {
    rule,
    tenantHash,
    detail,
    timestamp: now,
  };

  inMemoryWouldDenyEvents.push(event);
  if (inMemoryWouldDenyEvents.length > MAX_WOULD_DENY_EVENTS) {
    inMemoryWouldDenyEvents.shift();
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
 * Aggregates would-deny events over the trailing time window.
 */
export function getWouldDenyStats(hours: number = 24): WouldDenyStats {
  const cutoff = Date.now() - Math.max(1, hours) * 3600 * 1000;
  const recentEvents = inMemoryWouldDenyEvents.filter((e) => e.timestamp >= cutoff);

  const ruleCounts: Record<CommonsRule, number> = {
    brake: 0,
    eye_for_eye: 0,
    share_cap: 0,
    jail: 0,
  };

  const tenantMap = new Map<
    string,
    {
      count: number;
      rules: Record<CommonsRule, number>;
    }
  >();

  for (const event of recentEvents) {
    if (event.rule in ruleCounts) {
      ruleCounts[event.rule]++;
    }

    let tenantData = tenantMap.get(event.tenantHash);
    if (!tenantData) {
      tenantData = {
        count: 0,
        rules: { brake: 0, eye_for_eye: 0, share_cap: 0, jail: 0 },
      };
      tenantMap.set(event.tenantHash, tenantData);
    }

    tenantData.count++;
    if (event.rule in tenantData.rules) {
      tenantData.rules[event.rule]++;
    }
  }

  const topTenants = Array.from(tenantMap.entries())
    .map(([tenantHash, data]) => ({
      tenantHash,
      count: data.count,
      rules: data.rules,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    rules: ruleCounts,
    topTenants,
    total: recentEvents.length,
  };
}

/**
 * Clears recorded events in memory (strictly for unit and integration testing).
 */
export function clearWouldDenyEventsForTest(): void {
  inMemoryWouldDenyEvents.length = 0;
}
