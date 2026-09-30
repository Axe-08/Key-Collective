/**
 * Key Collective v3 — Communal Debt Ledger Tracker
 */

export interface DebtState {
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
  const ratio_pct = dailyContributedCu > 0n 
    ? (communityDebtCu * 100n / dailyContributedCu) 
    : (communityDebtCu > 0n ? 1000n : 0n);

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
): 'PRISTINE' | 'SOFT_WARNING' | 'HARD_JAIL' {
  if (communityDebtCu > 0n) {
    if (multiplierCeiling === 100) return 'HARD_JAIL';
    else if (multiplierCeiling === 150) return 'SOFT_WARNING';
  }
  return 'PRISTINE';
}

export function processDailyDebtReset(state: DebtState): DebtState {
  let consecutiveDebtFreeDays = state.consecutiveDebtFreeDays;
  let trustedContributor = state.trustedContributor;
  let communityDebtCu = state.communityDebtCu;

  if (communityDebtCu === 0n) {
    consecutiveDebtFreeDays++;
    if (consecutiveDebtFreeDays > 30) trustedContributor = true;
  } else {
    consecutiveDebtFreeDays = 0;
    const DECAY_PCT = trustedContributor ? 30n : 20n;
    communityDebtCu = communityDebtCu - (communityDebtCu * DECAY_PCT) / 100n;
    trustedContributor = false;
  }

  const dailyContributedCu = 0n;
  const multiplierCeiling = calculateMultiplierCeiling(communityDebtCu, dailyContributedCu, trustedContributor);

  return {
    communityDebtCu,
    dailyContributedCu,
    trustedContributor,
    consecutiveDebtFreeDays,
    multiplierCeiling,
  };
}
