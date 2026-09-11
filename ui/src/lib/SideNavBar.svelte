<script lang="ts">
  import type { PoolStats, APIKey } from './types';
  import type { UserAccount, UserTier } from '../../../src/contracts/v3_types';
  import { type Microdollars, formatMicrodollars } from './types';

  let {
    activeTab = 'pool',
    onSelectTab,
    stats,
    keys = [],
    userAccount,
    onOpenAddModal,
    todaySpendMicrodollars = 42000,
  }: {
    activeTab?: 'pool' | 'workbench' | 'docs' | 'admin' | string;
    onSelectTab?: (tab: string) => void;
    stats?: PoolStats;
    keys?: APIKey[];
    userAccount?: UserAccount;
    onOpenAddModal?: () => void;
    todaySpendMicrodollars?: Microdollars;
  } = $props();

  let quotaPercent = $derived.by(() => {
    if (!stats || !stats.daily_quota_limit || stats.daily_quota_limit === 0) {
      return 42;
    }
    const percent = Math.round((stats.daily_quota_used / stats.daily_quota_limit) * 100);
    return Math.min(100, Math.max(0, percent));
  });

  function handleTabClick(tab: string) {
    if (onSelectTab) {
      onSelectTab(tab);
    }
  }
</script>

<aside class="fixed top-14 left-0 bottom-0 w-64 z-40 flex flex-col justify-between p-4 bg-surface-container-low/90 backdrop-blur-xl border-r border-outline-variant/30 hidden md:flex">
  <!-- Upper Section: Primary Navigation -->
  <div class="space-y-4">
    <!-- Side Nav CTA: Add Provider Key -->
    <button
      type="button"
      onclick={onOpenAddModal}
      class="w-full py-2 px-3 rounded-lg bg-surface-container-high hover:bg-surface-container-highest/60 text-primary border border-primary/20 flex items-center justify-center gap-2 text-label-md font-label-md font-medium transition-colors active:scale-[0.98] cursor-pointer"
    >
      <span class="material-symbols-outlined text-[16px]" data-icon="add_circle">add_circle</span>
      <span>+ Add Provider Key</span>
    </button>

    <!-- Primary Tabs (Overview, Developer Workbench, API Documentation, Admin Panel) -->
    <div class="space-y-1 pt-2">
      <!-- Overview -->
      <button
        type="button"
        onclick={() => handleTabClick('pool')}
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors active:scale-[0.98] cursor-pointer text-left {activeTab === 'pool' ? 'bg-surface-container-high text-primary font-medium border-l-2 border-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}"
      >
        <span class="material-symbols-outlined text-[18px]" data-icon="dashboard">dashboard</span>
        <span class="text-label-md font-label-md">Overview</span>
      </button>

      <!-- Developer Workbench -->
      <button
        type="button"
        onclick={() => handleTabClick('workbench')}
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors active:scale-[0.98] cursor-pointer text-left {activeTab === 'workbench' ? 'bg-surface-container-high text-primary font-medium border-l-2 border-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}"
      >
        <span class="material-symbols-outlined text-[18px]" data-icon="layers">layers</span>
        <span class="text-label-md font-label-md">Developer Workbench</span>
      </button>

      <!-- API Documentation -->
      <button
        type="button"
        onclick={() => handleTabClick('docs')}
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors active:scale-[0.98] cursor-pointer text-left {activeTab === 'docs' ? 'bg-surface-container-high text-primary font-medium border-l-2 border-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}"
      >
        <span class="material-symbols-outlined text-[18px]" data-icon="menu_book">menu_book</span>
        <span class="text-label-md font-label-md">API Documentation</span>
      </button>

      <!-- Admin Panel (Surveillance - visible for admin tier) -->
      {#if userAccount?.tier === 'admin'}
        <button
          type="button"
          onclick={() => handleTabClick('admin')}
          class="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors active:scale-[0.98] cursor-pointer text-left {activeTab === 'admin' ? 'bg-surface-container-high text-primary font-medium border-l-2 border-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}"
        >
          <span class="material-symbols-outlined text-[18px] text-amber-400" data-icon="shield_person">shield_person</span>
          <span class="text-label-md font-label-md text-amber-300">Admin Panel</span>
          <span class="ml-auto text-[9px] font-mono font-bold px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
            ROOT
          </span>
        </button>
      {/if}
    </div>
  </div>

  <!-- Lower Section: Daily Quota Limit, Microdollars Spend & Footer Links -->
  <div class="pt-4 border-t border-outline-variant/30 space-y-2">
    <!-- Daily Quota Limit & Microdollars Spend Card -->
    <div class="px-3 py-2.5 rounded-lg bg-surface-container-lowest/80 border border-outline-variant/20 flex flex-col gap-1.5 shadow-sm">
      <div class="flex justify-between items-center text-label-sm font-label-sm text-outline">
        <span class="flex items-center gap-1 font-medium">
          <span class="material-symbols-outlined text-[13px] text-primary">shield</span>
          Daily Quota Limit
        </span>
        <span class="text-on-surface font-mono font-semibold">{quotaPercent}%</span>
      </div>
      <div class="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden">
        <div class="bg-gradient-to-r from-primary to-secondary h-full rounded-full transition-all duration-500" style="width: {quotaPercent}%;"></div>
      </div>
      <div class="flex justify-between items-center text-[10px] font-mono text-on-surface-variant pt-0.5">
        <span title="Fixed-Point Microdollar Accounting ({todaySpendMicrodollars} µ$)">
          Est: {formatMicrodollars(todaySpendMicrodollars)}
        </span>
        <span class="text-secondary font-medium">0 µ$ actual</span>
      </div>
    </div>

    <!-- Proxy Status Indicator -->
    <div class="flex items-center justify-between px-3 py-1.5 rounded-lg text-on-surface-variant text-label-md font-label-md">
      <span class="flex items-center gap-2">
        <span class="material-symbols-outlined text-[18px]" data-icon="sensors">sensors</span>
        <span>Proxy Status</span>
      </span>
      <span class="inline-flex items-center gap-1.5 text-[10px] text-secondary font-mono">
        <span class="w-2 h-2 rounded-full bg-secondary shadow-[0_0_6px_#4edea3]"></span>
        Active
      </span>
    </div>

    <!-- Support Link -->
    <a
      href="https://github.com/Axe-08/Key-Collective"
      target="_blank"
      rel="noreferrer"
      class="flex items-center gap-3 px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50 text-label-md font-label-md transition-colors"
    >
      <span class="material-symbols-outlined text-[18px]" data-icon="help_center">help_center</span>
      <span>Support</span>
    </a>
  </div>
</aside>
