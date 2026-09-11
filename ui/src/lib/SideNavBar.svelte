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

  let totalKeyCount = $derived(keys.length || stats?.total_keys || 0);

  function handleTabClick(tab: string) {
    if (onSelectTab) {
      onSelectTab(tab);
    }
  }
</script>

<aside class="fixed top-14 left-0 bottom-0 w-64 z-40 flex flex-col justify-between p-4 bg-surface-container-low/90 backdrop-blur-xl border-r border-outline-variant/30 hidden md:flex">
  <!-- Upper Section: Edge Node & Primary Navigation -->
  <div class="space-y-4">
    <!-- Edge Node Header Block -->
    <div class="flex items-center gap-3 p-2.5 rounded-lg bg-surface-container-lowest/60 border border-outline-variant/30">
      <div class="w-9 h-9 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
        <span class="material-symbols-outlined text-[20px]" data-icon="hub">hub</span>
      </div>
      <div class="flex flex-col">
        <span class="text-headline-sm font-headline-sm font-semibold text-on-surface text-[14px] leading-tight">SIN-01 Edge</span>
        <span class="text-label-sm font-label-sm text-secondary flex items-center gap-1 font-mono">
          <span class="w-1.5 h-1.5 rounded-full bg-secondary status-pulse shadow-[0_0_6px_#4edea3]"></span>
          Operational • 12ms
        </span>
      </div>
    </div>

    <!-- Side Nav CTA: New Virtual Pool -->
    <button
      type="button"
      onclick={onOpenAddModal}
      class="w-full py-2 px-3 rounded-lg bg-surface-container-high hover:bg-surface-container-highest/60 text-primary border border-primary/20 flex items-center justify-center gap-2 text-label-md font-label-md font-medium transition-colors active:scale-[0.98] cursor-pointer"
    >
      <span class="material-symbols-outlined text-[16px]" data-icon="add_circle">add_circle</span>
      <span>+ New Virtual Pool</span>
    </button>

    <!-- Primary Tabs (Stitch exact layout & icons) -->
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

      <!-- Key Inventory -->
      <button
        type="button"
        onclick={() => handleTabClick('pool')}
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors active:scale-[0.98] cursor-pointer text-left {activeTab === 'pool' ? 'bg-surface-container-high text-primary font-medium border-l-2 border-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}"
      >
        <span class="material-symbols-outlined text-[18px] text-primary" data-icon="key">key</span>
        <span class="text-label-md font-label-md">Key Inventory</span>
        <span class="ml-auto text-label-sm font-label-sm px-1.5 py-0.2 rounded bg-surface-container text-on-surface-variant font-mono">
          {totalKeyCount}
        </span>
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

      <!-- Failover Topologies -->
      <button
        type="button"
        onclick={() => handleTabClick('pool')}
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50 transition-colors active:scale-[0.98] cursor-pointer text-left"
      >
        <span class="material-symbols-outlined text-[18px]" data-icon="alt_route">alt_route</span>
        <span class="text-label-md font-label-md">Failover Topologies</span>
      </button>

      <!-- Usage & Quotas -->
      <button
        type="button"
        onclick={() => handleTabClick('workbench')}
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50 transition-colors active:scale-[0.98] cursor-pointer text-left"
      >
        <span class="material-symbols-outlined text-[18px]" data-icon="data_usage">data_usage</span>
        <span class="text-label-md font-label-md">Usage &amp; Quotas</span>
      </button>

      <!-- Audit Trail / Telemetry Logs -->
      <button
        type="button"
        onclick={() => handleTabClick('pool')}
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50 transition-colors active:scale-[0.98] cursor-pointer text-left"
      >
        <span class="material-symbols-outlined text-[18px]" data-icon="history">history</span>
        <span class="text-label-md font-label-md">Audit Trail</span>
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

  <!-- Lower Section: Shield Quota, Microdollars Spend & Footer Links -->
  <div class="pt-4 border-t border-outline-variant/30 space-y-2">
    <!-- Shield Quota & Microdollars Spend Card -->
    <div class="px-3 py-2.5 rounded-lg bg-surface-container-lowest/80 border border-outline-variant/20 flex flex-col gap-1.5 shadow-sm">
      <div class="flex justify-between items-center text-label-sm font-label-sm text-outline">
        <span class="flex items-center gap-1 font-medium">
          <span class="material-symbols-outlined text-[13px] text-primary">shield</span>
          Shield Quota
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

    <!-- Documentation Link -->
    <button
      type="button"
      onclick={() => handleTabClick('docs')}
      class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50 text-label-md font-label-md transition-colors cursor-pointer text-left {activeTab === 'docs' ? 'bg-surface-container-high text-primary font-medium' : ''}"
    >
      <span class="material-symbols-outlined text-[18px]" data-icon="menu_book">menu_book</span>
      <span>Documentation</span>
    </button>

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
