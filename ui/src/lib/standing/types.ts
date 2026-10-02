/**
 * Key Collective PRD Section 4.2 — Contributor Standing & Multiplier Types
 */

export type JailStatus = 'PRISTINE' | 'SOFT_WARNING' | 'HARD_JAIL';

export interface StandingCaps {
  /** Key age vesting cap (100 = 1.00x, up to 450/500) */
  vesting: number;
  /** Communal debt ratio cap (100 if >100%, 150 if >50%, 450/500 otherwise) */
  debt: number;
  /** Coordinator pool utilization cap (100 if >=95%, up to 450/500) */
  band: number;
}

export interface StandingRecovery {
  debt_decay: string;
  estimated_days: number;
}

export interface ContributorStandingData {
  multiplier: number;
  multiplier_pct: number;
  multiplier_ceiling: number;
  community_debt_cu: number;
  contributed_cu_24h: number;
  daily_contributed_cu?: number;
  cu_contributed_today?: number;
  cu_consumed_today?: number;
  net_cu_balance: number;
  trusted_contributor: boolean;
  jail_status: JailStatus;
  consecutive_debt_free_days: number;
  caps: StandingCaps;
  recovery: StandingRecovery;
}
