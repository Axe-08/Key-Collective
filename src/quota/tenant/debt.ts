/**
 * Key Collective v3/v4 — Communal Debt Ledger, Multiplier Caps & Jail Status (WP-5.4, WP-5.12)
 */

const TWO_HOURS_MS = 2 * 3_600_000;
const TWELVE_HOURS_MS = 12 * 3_600_000;

export interface CommunityKeyVestingInfo {
  status?: string | null;
  community_routing_status?: string | null;
  pool_type?: string | null;
  drainState?: string | null;
  drain_state?: string | null;
  createdAt?: number | string | null;
  created_at?: number | string | null;
  ageMs?: number;
  ageHours?: number;
}

export interface MultiplierPctInput {
  debtCu: bigint | number;
  contributed24h: bigint | number;
  trusted?: boolean;
  keys?: CommunityKeyVestingInfo[];
  oldestKeyAgeMs?: number | null;
  now?: number;
  utilisationPct?: number | null;
  vestingCap?: number;
  debtCap?: number;
  bandCap?: number;
}

export interface DebtStateInput {
  debtCu?: bigint;
  streak?: number;
  trusted?: boolean;
  contributed24h?: bigint;
  communityDebtCu?: bigint;
  dailyContributedCu?: bigint;
  trustedContributor?: boolean;
  consecutiveDebtFreeDays?: number;
  multiplierCeiling?: number;
  vestingCap?: number;
  bandCap?: number;
}

export interface DebtState {
  debtCu: bigint;
  streak: number;
  trusted: boolean;
  contributed24h: bigint;
  communityDebtCu: bigint;
  dailyContributedCu: bigint;
  trustedContributor: boolean;
  consecutiveDebtFreeDays: number;
  multiplierCeiling: number;
  multiplierPct: number;
}

/**
 * FR-17 + D-16: Computes `vesting_cap` (integer pct, 100 = 1.00x) from the age of the owner's
 * oldest ACTIVE community key whose `drain_state` is `OK` (`DRAINED` keys do not count).
 * - No counting community key -> 100
 * - 0–2 h -> 150
 * - 2–12 h -> 250
 * - >= 12 h -> 450 (500 if trusted)
 */
export function calculateVestingCapPct(
  keysOrOldestAgeMs: CommunityKeyVestingInfo[] | number | null | undefined,
  trustedContributor = false,
  now = Date.now()
): number {
  let oldestAgeMs: number | null = null;

  if (typeof keysOrOldestAgeMs === "number") {
    oldestAgeMs = keysOrOldestAgeMs >= 0 ? keysOrOldestAgeMs : null;
  } else if (Array.isArray(keysOrOldestAgeMs)) {
    for (const k of keysOrOldestAgeMs) {
      const poolType = (k.pool_type ?? "COMMUNITY").toUpperCase();
      if (poolType !== "COMMUNITY") continue;

      const routingStatus = (k.community_routing_status ?? k.status ?? "").toUpperCase();
      if (routingStatus !== "ACTIVE") continue;

      const drain = (k.drainState ?? k.drain_state ?? "OK").toUpperCase();
      if (drain !== "OK") continue;

      let ageMs: number | null = null;
      if (typeof k.ageMs === "number") {
        ageMs = k.ageMs;
      } else if (typeof k.ageHours === "number") {
        ageMs = Math.trunc(k.ageHours * 3_600_000);
      } else {
        const rawCreated = k.createdAt ?? k.created_at;
        if (typeof rawCreated === "number") {
          ageMs = Math.max(0, now - rawCreated);
        } else if (typeof rawCreated === "string") {
          const parsed = Date.parse(rawCreated);
          if (!Number.isNaN(parsed)) {
            ageMs = Math.max(0, now - parsed);
          }
        }
      }

      if (ageMs !== null && ageMs >= 0) {
        if (oldestAgeMs === null || ageMs > oldestAgeMs) {
          oldestAgeMs = ageMs;
        }
      }
    }
  }

  if (oldestAgeMs === null) {
    return 100;
  }
  if (oldestAgeMs < TWO_HOURS_MS) {
    return 150;
  }
  if (oldestAgeMs < TWELVE_HOURS_MS) {
    return 250;
  }
  return trustedContributor ? 500 : 450;
}

/**
 * FR-03: Computes `debt_cap` (integer pct, 100 = 1.00x) from `ratio_pct = debt * 100 / max(contributed_24h, 1)`:
 * - > 100 -> 100 (HARD_JAIL)
 * - > 50 -> 150 (SOFT_WARNING)
 * - else -> 450 / 500 trusted (PRISTINE)
 */
export function calculateDebtCapPct(
  communityDebtCu: bigint | number,
  contributed24h: bigint | number,
  trustedContributor = false
): number {
  const debt = typeof communityDebtCu === "bigint" ? communityDebtCu : BigInt(Math.trunc(communityDebtCu));
  const contrib = typeof contributed24h === "bigint" ? contributed24h : BigInt(Math.trunc(contributed24h));
  const denom = contrib > 1n ? contrib : 1n;
  const ratioPct = (debt * 100n) / denom;

  if (ratioPct > 100n) {
    return 100;
  }
  if (ratioPct > 50n) {
    return 150;
  }
  return trustedContributor ? 500 : 450;
}

/**
 * FR-26: Computes `band_cap` (integer pct, 100 = 1.00x) from coordinator utilisation pct:
 * - < 60% -> 450 (500 if trusted)
 * - < 80% -> 300
 * - < 95% -> 150
 * - >= 95% -> 100
 */
export function calculateBandCapPct(
  utilisationPct: number | null | undefined,
  trustedContributor = false
): number {
  if (utilisationPct === null || utilisationPct === undefined) {
    return trustedContributor ? 500 : 450;
  }
  const util = Math.trunc(utilisationPct);
  if (util < 60) {
    return trustedContributor ? 500 : 450;
  }
  if (util < 80) {
    return 300;
  }
  if (util < 95) {
    return 150;
  }
  return 100;
}

/**
 * WP-5.12 T-5.12.1: Computes `multiplier_pct = min(vesting_cap, debt_cap, band_cap)` using integer math.
 */
export function calculateMultiplierPct(
  inputOrDebtCu: MultiplierPctInput | bigint | number,
  contributed24h?: bigint | number,
  trustedContributor = false,
  options?: {
    keys?: CommunityKeyVestingInfo[];
    oldestKeyAgeMs?: number | null;
    now?: number;
    utilisationPct?: number | null;
    vestingCap?: number;
    debtCap?: number;
    bandCap?: number;
  }
): number {
  if (typeof inputOrDebtCu === "object" && inputOrDebtCu !== null) {
    const inp = inputOrDebtCu;
    const trusted = Boolean(inp.trusted);
    const vestingCap =
      inp.vestingCap ??
      (inp.keys !== undefined
        ? calculateVestingCapPct(inp.keys, trusted, inp.now)
        : inp.oldestKeyAgeMs !== undefined
        ? calculateVestingCapPct(inp.oldestKeyAgeMs, trusted, inp.now)
        : trusted
        ? 500
        : 450);
    const debtCap =
      inp.debtCap ?? calculateDebtCapPct(inp.debtCu, inp.contributed24h, trusted);
    const bandCap =
      inp.bandCap ?? calculateBandCapPct(inp.utilisationPct, trusted);
    return Math.min(vestingCap, debtCap, bandCap);
  }

  const debt = inputOrDebtCu;
  const contrib = contributed24h ?? 0n;
  const vestingCap =
    options?.vestingCap ??
    (options?.keys !== undefined
      ? calculateVestingCapPct(options.keys, trustedContributor, options.now)
      : options?.oldestKeyAgeMs !== undefined
      ? calculateVestingCapPct(options.oldestKeyAgeMs, trustedContributor, options.now)
      : trustedContributor
      ? 500
      : 450);
  const debtCap =
    options?.debtCap ?? calculateDebtCapPct(debt, contrib, trustedContributor);
  const bandCap =
    options?.bandCap ?? calculateBandCapPct(options?.utilisationPct, trustedContributor);
  return Math.min(vestingCap, debtCap, bandCap);
}

export const calculateMultiplierCeiling = calculateMultiplierPct;

/**
 * WP-5.12 T-5.12.1 / T-5.12.3: Derives jail status directly from `ratio_pct = debt * 100 / max(contributed_24h, 1)`
 * without depending on `multiplierCeiling === 100`.
 */
export function determineJailStatus(
  communityDebtCu: bigint,
  contributed24h: bigint = 0n
): "PRISTINE" | "SOFT_WARNING" | "HARD_JAIL" {
  if (communityDebtCu <= 0n) {
    return "PRISTINE";
  }
  const denom = contributed24h > 1n ? contributed24h : 1n;
  const ratioPct = (communityDebtCu * 100n) / denom;
  if (ratioPct > 100n) {
    return "HARD_JAIL";
  }
  if (ratioPct > 50n) {
    return "SOFT_WARNING";
  }
  return "PRISTINE";
}

/**
 * WP-5.12 T-5.12.3: Computes `estimated_days` = smallest `n` (1..30) with `debt * 0.8^n <= contributed_24h`
 * using integer floor decay (`d = d - (d * 20n) / 100n`).
 */
export function estimateJailRecoveryDays(
  debtCu: bigint | number,
  contributed24h: bigint | number
): number {
  let d = typeof debtCu === "bigint" ? debtCu : BigInt(Math.max(0, Math.trunc(debtCu)));
  const c =
    typeof contributed24h === "bigint"
      ? contributed24h
      : BigInt(Math.max(0, Math.trunc(contributed24h)));

  if (d <= c) {
    return 0;
  }

  for (let day = 1; day <= 30; day++) {
    const decay = (d * 20n) / 100n;
    d = decay > 0n ? d - decay : d - 1n;
    if (d <= c) {
      return day;
    }
  }
  return 30;
}

export function nightlyReset(s: DebtStateInput): DebtState {
  const currentDebt = s.debtCu ?? s.communityDebtCu ?? 0n;
  const currentStreak = s.streak ?? s.consecutiveDebtFreeDays ?? 0;
  const currentTrusted = s.trusted ?? s.trustedContributor ?? false;
  const contributed = s.contributed24h ?? s.dailyContributedCu ?? 0n;

  const decayPct = currentTrusted ? 30n : 20n; // decided BEFORE trust changes
  const debt = currentDebt - (currentDebt * decayPct) / 100n; // floor, integer
  const streak = currentDebt === 0n ? currentStreak + 1 : 0;
  const trusted = currentDebt > 0n ? false : currentTrusted || streak >= 7;
  const multiplierPct = calculateMultiplierPct({
    debtCu: debt,
    contributed24h: contributed,
    trusted,
    vestingCap: s.vestingCap,
    bandCap: s.bandCap,
  });

  return {
    debtCu: debt,
    streak,
    trusted,
    contributed24h: contributed,
    communityDebtCu: debt,
    dailyContributedCu: contributed,
    trustedContributor: trusted,
    consecutiveDebtFreeDays: streak,
    multiplierCeiling: multiplierPct,
    multiplierPct,
  };
}
