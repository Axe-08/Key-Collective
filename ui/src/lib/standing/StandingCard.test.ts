import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import StandingCard from './StandingCard.svelte';
import type { ContributorStandingData } from './types';

describe('WP-6.3 / T-6.3.3 & T-6.3.4: StandingCard Component', () => {
  const pristineStanding: ContributorStandingData = {
    multiplier: 4.5,
    multiplier_pct: 450,
    multiplier_ceiling: 4.5,
    community_debt_cu: 200,
    contributed_cu_24h: 1000,
    net_cu_balance: 800,
    trusted_contributor: false,
    jail_status: 'PRISTINE',
    consecutive_debt_free_days: 3,
    caps: {
      vesting: 450,
      debt: 450,
      band: 450,
    },
    recovery: {
      debt_decay: '20% per day at 00:00 UTC',
      estimated_days: 0,
    },
  };

  const softWarningStanding: ContributorStandingData = {
    multiplier: 1.5,
    multiplier_pct: 150,
    multiplier_ceiling: 1.5,
    community_debt_cu: 650,
    contributed_cu_24h: 1000,
    net_cu_balance: 350,
    trusted_contributor: false,
    jail_status: 'SOFT_WARNING',
    consecutive_debt_free_days: 0,
    caps: {
      vesting: 450,
      debt: 150,
      band: 450,
    },
    recovery: {
      debt_decay: '20% per day at 00:00 UTC',
      estimated_days: 2,
    },
  };

  const hardJailStanding: ContributorStandingData = {
    multiplier: 1.0,
    multiplier_pct: 100,
    multiplier_ceiling: 1.0,
    community_debt_cu: 2500,
    contributed_cu_24h: 1000,
    net_cu_balance: -1500,
    trusted_contributor: false,
    jail_status: 'HARD_JAIL',
    consecutive_debt_free_days: 0,
    caps: {
      vesting: 450,
      debt: 100,
      band: 450,
    },
    recovery: {
      debt_decay: '20% per day at 00:00 UTC',
      estimated_days: 5,
    },
  };

  const trustedStanding: ContributorStandingData = {
    multiplier: 5.0,
    multiplier_pct: 500,
    multiplier_ceiling: 5.0,
    community_debt_cu: 0,
    contributed_cu_24h: 5000,
    net_cu_balance: 5000,
    trusted_contributor: true,
    jail_status: 'PRISTINE',
    consecutive_debt_free_days: 14,
    caps: {
      vesting: 500,
      debt: 500,
      band: 500,
    },
    recovery: {
      debt_decay: '20% per day at 00:00 UTC',
      estimated_days: 0,
    },
  };

  it('renders PRISTINE status with green styling and ratio bar', () => {
    const result = render(StandingCard, {
      props: { standing: pristineStanding },
    });

    expect(result.body).toContain('PRISTINE');
    expect(result.body).toContain('4.50x');
    expect(result.body).toContain('200 CU');
    expect(result.body).toContain('1,000 CU');
    expect(result.body).toContain('data-testid="ratio-bar"');
    expect(result.body).not.toContain('resolve-debt');
  });

  it('renders SOFT_WARNING status with warning badge and capped multiplier', () => {
    const result = render(StandingCard, {
      props: { standing: softWarningStanding },
    });

    expect(result.body).toContain('SOFT_WARNING');
    expect(result.body).toContain('1.50x');
    expect(result.body).toContain('Binding: Debt Cap');
    expect(result.body).toContain('650 CU');
  });

  it('renders HARD_JAIL status with red warning, 1.00x lock, and recovery projection', () => {
    const result = render(StandingCard, {
      props: { standing: hardJailStanding },
    });

    expect(result.body).toContain('HARD_JAIL');
    expect(result.body).toContain('1.00x');
    expect(result.body).toContain('5 days');
    expect(result.body).toContain('20% per day at 00:00 UTC');
  });

  it('renders TRUSTED badge with gold star and streak counter', () => {
    const result = render(StandingCard, {
      props: { standing: trustedStanding },
    });

    expect(result.body).toContain('TRUSTED');
    expect(result.body).toContain('5.00x');
    expect(result.body).toContain('14 days');
  });

  it('never renders resolve debt action buttons', () => {
    const result = render(StandingCard, {
      props: { standing: hardJailStanding },
    });

    expect(result.body).not.toContain('resolve-debt');
    expect(result.body).not.toContain('Resolve debt');
  });
});
