/**
 * Key Collective v3 — Communal Debt Ledger Tracker
 */

export interface DebtState {
  communityDebtMicroCu: bigint;
  dailyContributedCu: bigint;
  trustedContributor: boolean;
  consecutiveDebtFreeDays: number;
  multiplierCeiling: number;
}

export function calculateMultiplierCeiling(
  communityDebtMicroCu: bigint,
  dailyContributedCu: bigint,
  trustedContributor: boolean
): number {
  const ratio = dailyContributedCu > 0n 
    ? Number(communityDebtMicroCu * 100n / dailyContributedCu) 
    : (communityDebtMicroCu > 0n ? 1000 : 0);

  if (ratio > 100) {
    return 100;
  } else if (ratio > 50) {
    return 150;
  } else {
    return trustedContributor ? 500 : 450;
  }
}

export function determineJailStatus(
  communityDebtMicroCu: bigint,
  multiplierCeiling: number
): 'PRISTINE' | 'SOFT_WARNING' | 'HARD_JAIL' {
  if (communityDebtMicroCu > 0n) {
    if (multiplierCeiling === 100) return 'HARD_JAIL';
    else if (multiplierCeiling === 150) return 'SOFT_WARNING';
  }
  return 'PRISTINE';
}

export function processDailyDebtReset(state: DebtState): DebtState {
  let consecutiveDebtFreeDays = state.consecutiveDebtFreeDays;
  let trustedContributor = state.trustedContributor;
  let communityDebtMicroCu = state.communityDebtMicroCu;

  if (communityDebtMicroCu === 0n) {
    consecutiveDebtFreeDays++;
    if (consecutiveDebtFreeDays > 30) trustedContributor = true;
  } else {
    consecutiveDebtFreeDays = 0;
    trustedContributor = false;
    
    const decay = trustedContributor ? 0.3 : 0.2;
    const decayAmount = BigInt(Math.floor(Number(communityDebtMicroCu) * decay));
    communityDebtMicroCu = communityDebtMicroCu > decayAmount ? communityDebtMicroCu - decayAmount : 0n;
  }

  const dailyContributedCu = 0n;
  const multiplierCeiling = calculateMultiplierCeiling(communityDebtMicroCu, dailyContributedCu, trustedContributor);

  return {
    communityDebtMicroCu,
    dailyContributedCu,
    trustedContributor,
    consecutiveDebtFreeDays,
    multiplierCeiling,
  };
}
