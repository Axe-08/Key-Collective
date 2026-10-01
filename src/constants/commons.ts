/**
 * Key Collective — Commons Economy Constants (Phase 5, WP-5.6+)
 */

/** Minimum total borrowed CU in the 5-minute window before surge brake evaluates (default 2,000 CU) */
export const BRAKE_MIN_POOL_CU = 2000;

/** Minimum distinct active borrowers in the 5-minute window before surge brake evaluates (default 3) */
export const BRAKE_MIN_ACTIVE_BORROWERS = 3;

/** Maximum percentage share of 5-minute borrowed CU for a single tenant before surge brake triggers (default 35%) */
export const BRAKE_MAX_TENANT_SHARE_PCT = 35;

/** Duration in milliseconds of a surge brake refusal lock (default 60,000 ms = 60s) */
export const BRAKE_DURATION_MS = 60_000;

/** Trailing borrower window in minutes for surge brake evaluation */
export const BORROWER_WINDOW_MINUTES = 5;

/**
 * Computes the cold-start owner share cap percentage (FR-12, WP-5.7 T-5.7.2):
 * - For N <= 1: 100%
 * - For 2 <= N <= 5: 40%
 * - For N > 5: max(20%, floor(200 / N)%)
 */
export function computeOwnerShareCapPct(activeOwnersCount: number): number {
  const n = Math.trunc(activeOwnersCount);
  if (n <= 1) return 100;
  if (n <= 5) return 40;
  return Math.max(20, Math.floor(200 / n));
}

