/**
 * Key Collective v3 — Communal Debt Ledger Tracker
 */

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
}

export function calculateMultiplierCeiling(
  communityDebtCu: bigint,
  dailyContributedCu: bigint,
  trustedContributor: boolean
): number {
  const ratio_pct =
    dailyContributedCu > 0n
      ? (communityDebtCu * 100n) / dailyContributedCu
      : communityDebtCu > 0n
        ? 1000n
        : 0n;

  if (ratio_pct > 100n) {
    return 100;
  } else if (ratio_pct > 50n) {
    return 150;
  } else {
    return trustedContributor ? 500 : 450;
  }
}

export function determineJailStatus(
  communityDebtCu: bigint,
  multiplierCeiling: number
): "PRISTINE" | "SOFT_WARNING" | "HARD_JAIL" {
  if (communityDebtCu > 0n) {
    if (multiplierCeiling === 100) return "HARD_JAIL";
    else if (multiplierCeiling === 150) return "SOFT_WARNING";
  }
  return "PRISTINE";
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
  const multiplierCeiling = calculateMultiplierCeiling(debt, contributed, trusted);

  return {
    debtCu: debt,
    streak,
    trusted,
    contributed24h: contributed,
    communityDebtCu: debt,
    dailyContributedCu: contributed,
    trustedContributor: trusted,
    consecutiveDebtFreeDays: streak,
    multiplierCeiling,
  };
}
