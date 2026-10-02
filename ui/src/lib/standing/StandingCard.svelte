<script lang="ts">
  import { onMount } from 'svelte';
  import type { ContributorStandingData } from './types';
  import { fetchStanding } from './api';

  let {
    standing = null,
    loading = false,
    error = null,
    tenantId,
  }: {
    standing?: ContributorStandingData | null;
    loading?: boolean;
    error?: string | null;
    tenantId?: string;
  } = $props();

  let liveStanding = $state<ContributorStandingData | null>(null);
  let isLoading = $state(false);
  let loadError = $state<string | null>(null);

  async function loadData() {
    isLoading = true;
    loadError = null;
    try {
      const data = await fetchStanding();
      liveStanding = data;
    } catch (err) {
      loadError = (err as Error).message || 'Failed to load contributor standing';
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    if (!standing) {
      loadData();
    }
  });

  const currentStanding = $derived(standing ?? liveStanding);
  const currentLoading = $derived(loading || isLoading);
  const currentError = $derived(error ?? loadError);

  const ratio = $derived.by(() => {
    if (!currentStanding) return 0;
    const debt = currentStanding.community_debt_cu;
    const contrib = Math.max(1, currentStanding.contributed_cu_24h);
    return Math.min(100, Math.round((debt / contrib) * 100));
  });

  const bindingCap = $derived.by(() => {
    if (!currentStanding?.caps) return null;
    const { vesting, debt, band } = currentStanding.caps;
    const minCap = Math.min(vesting, debt, band);
    if (minCap === debt && debt < 450) {
      return { name: 'Debt Cap', value: debt };
    }
    if (minCap === vesting && vesting < 450) {
      return { name: 'Key Vesting', value: vesting };
    }
    if (minCap === band && band < 450) {
      return { name: 'Pool Band', value: band };
    }
    return null;
  });

  const statusTheme = $derived.by(() => {
    const status = currentStanding?.jail_status ?? 'PRISTINE';
    if (status === 'HARD_JAIL') {
      return {
        badgeBg: 'bg-error/20 text-error border-error/40',
        cardBorder: 'border-error/40',
        barColor: 'bg-error',
        title: 'HARD_JAIL',
      };
    }
    if (status === 'SOFT_WARNING') {
      return {
        badgeBg: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
        cardBorder: 'border-amber-500/40',
        barColor: 'bg-amber-400',
        title: 'SOFT_WARNING',
      };
    }
    return {
      badgeBg: 'bg-secondary/20 text-secondary border-secondary/40',
      cardBorder: 'border-secondary/40',
      barColor: 'bg-secondary',
      title: 'PRISTINE',
    };
  });
</script>

<div
  class="specular-border rounded-xl p-5 bg-surface-container-low/80 backdrop-blur-xl border {statusTheme.cardBorder} transition-all space-y-4"
  data-testid="standing-card"
>
  {#if currentLoading && !currentStanding}
    <div class="flex items-center justify-center py-8 text-outline font-mono text-sm gap-2">
      <span class="animate-spin material-symbols-outlined text-[18px]">progress_activity</span>
      <span>Loading contributor standing...</span>
    </div>
  {:else if currentError && !currentStanding}
    <div class="p-4 rounded bg-error/10 border border-error/30 text-error text-sm font-mono flex items-center justify-between">
      <span>{currentError}</span>
      <button
        type="button"
        onclick={loadData}
        class="px-2 py-1 bg-error/20 rounded hover:bg-error/30 text-xs font-semibold cursor-pointer"
      >
        Retry
      </button>
    </div>
  {:else if currentStanding}
    <!-- Header: Multiplier & Status Banner -->
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div>
        <div class="text-xs uppercase tracking-wider text-outline font-medium font-mono">
          Contributor Standing
        </div>
        <div class="flex items-baseline gap-2 mt-1">
          <span class="text-3xl font-bold font-mono text-on-surface">
            {currentStanding.multiplier.toFixed(2)}x
          </span>
          <span class="text-xs text-outline font-mono">
            / {(currentStanding.multiplier_ceiling || currentStanding.multiplier).toFixed(2)}x ceiling
          </span>
        </div>
      </div>

      <div class="flex items-center gap-2">
        {#if currentStanding.trusted_contributor}
          <span
            class="px-2 py-1 rounded text-xs font-mono font-semibold bg-amber-400/20 text-amber-300 border border-amber-400/40 flex items-center gap-1"
            title="Trusted Contributor with 7+ days debt-free streak"
          >
            <span class="material-symbols-outlined text-[14px]">star</span>
            TRUSTED
          </span>
        {/if}

        <span class="px-2.5 py-1 rounded text-xs font-mono font-bold border {statusTheme.badgeBg}">
          {currentStanding.jail_status}
        </span>
      </div>
    </div>

    <!-- Active Binding Cap Pill -->
    {#if bindingCap}
      <div class="flex items-center gap-1.5 text-xs font-mono text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded">
        <span class="material-symbols-outlined text-[14px]">lock_clock</span>
        <span>Binding: {bindingCap.name} ({(bindingCap.value / 100).toFixed(2)}x)</span>
      </div>
    {/if}

    <!-- Debt vs Contribution Ratio Bar -->
    <div class="space-y-1.5" data-testid="ratio-bar">
      <div class="flex items-center justify-between text-xs font-mono text-outline">
        <span>Communal Debt Ratio</span>
        <span class="text-on-surface font-medium">{ratio}%</span>
      </div>

      <div class="relative w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
        <div
          class="{statusTheme.barColor} h-full transition-all duration-500 rounded-full"
          style="width: {ratio}%;"
        ></div>
        <!-- 50% Threshold marker (Soft Warning) -->
        <div class="absolute top-0 bottom-0 left-1/2 w-0.5 bg-amber-400/70" title="50% Soft Warning Limit"></div>
      </div>

      <div class="flex justify-between text-[10px] font-mono text-outline">
        <span>0%</span>
        <span class="text-amber-400">50% Soft Warning</span>
        <span class="text-error">100% Hard Jail</span>
      </div>
    </div>

    <!-- Metrics Grid -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-outline-variant/20 font-mono text-xs">
      <div class="p-2 rounded bg-surface-container-highest/40">
        <div class="text-[10px] text-outline uppercase">24h Contribution</div>
        <div class="text-sm font-semibold text-primary mt-0.5">
          {currentStanding.contributed_cu_24h.toLocaleString()} CU
        </div>
      </div>

      <div class="p-2 rounded bg-surface-container-highest/40">
        <div class="text-[10px] text-outline uppercase">Communal Debt</div>
        <div class="text-sm font-semibold text-tertiary mt-0.5">
          {currentStanding.community_debt_cu.toLocaleString()} CU
        </div>
      </div>

      <div class="p-2 rounded bg-surface-container-highest/40">
        <div class="text-[10px] text-outline uppercase">Net CU Balance</div>
        <div class="text-sm font-semibold {currentStanding.net_cu_balance >= 0 ? 'text-secondary' : 'text-error'} mt-0.5">
          {currentStanding.net_cu_balance.toLocaleString()} CU
        </div>
      </div>

      <div class="p-2 rounded bg-surface-container-highest/40">
        <div class="text-[10px] text-outline uppercase">Debt-Free Streak</div>
        <div class="text-sm font-semibold text-on-surface mt-0.5">
          {currentStanding.consecutive_debt_free_days} days
        </div>
      </div>
    </div>

    <!-- Recovery Projection Banner (if in Warning or Jail) -->
    {#if currentStanding.jail_status === 'HARD_JAIL' || currentStanding.jail_status === 'SOFT_WARNING'}
      <div class="p-3 rounded bg-surface-container-highest/60 border border-outline-variant/30 space-y-1 font-mono text-xs">
        <div class="flex items-center gap-1.5 font-semibold text-on-surface">
          <span class="material-symbols-outlined text-[16px] text-tertiary">trending_up</span>
          <span>Recovery Projection</span>
        </div>
        <div class="text-outline text-[11px] leading-relaxed">
          Estimated recovery: <span class="text-on-surface font-medium">{currentStanding.recovery?.estimated_days ?? 0} days</span>
          via decay rate of <span class="text-primary font-medium">{currentStanding.recovery?.debt_decay ?? '20% per day at 00:00 UTC'}</span>,
          or by providing active community keys.
        </div>
      </div>
    {/if}
  {/if}
</div>
