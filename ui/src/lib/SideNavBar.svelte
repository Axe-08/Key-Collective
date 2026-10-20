<script lang="ts">
  import type { PoolStats, APIKey } from './types';
  import type { UserAccount } from '../../../src/contracts/v3_types';
  import { type CU, formatCu } from './types';

  let {
    activeTab = 'dashboard',
    onSelectTab,
    stats,
    keys = [],
    userAccount,
    onOpenAddModal,
    onOpenReportModal,
    cuUsedToday = 0,
  }: {
    activeTab?: string;
    onSelectTab?: (tab: string) => void;
    stats?: PoolStats;
    keys?: APIKey[];
    userAccount?: UserAccount;
    onOpenAddModal?: () => void;
    onOpenReportModal?: () => void;
    cuUsedToday?: CU;
  } = $props();

  let isDevelopersOpen = $state(true);

  let isAdminHost = $derived(
    typeof window !== 'undefined' && window.location.hostname.startsWith('admin.')
  );

  let quotaPercent = $derived.by(() => {
    const used = cuUsedToday ?? stats?.cu_used_today ?? stats?.daily_quota_used ?? 0;
    const allowance = stats?.cu_allowance_today || stats?.daily_quota_limit || 0;
    if (allowance <= 0 || !used || used <= 0) return 0;
    const ratio = (used / allowance) * 100;
    return ratio > 0 && ratio < 1 ? 1 : Math.min(100, Math.round(ratio));
  });

  function handleTabClick(tab: string) {
    if (onSelectTab) {
      onSelectTab(tab);
    }
  }
</script>

<aside class="fixed top-14 left-0 bottom-0 w-64 z-40 flex flex-col justify-between p-4 bg-surface-container-low/90 backdrop-blur-xl border-r border-outline-variant/30 hidden md:flex" data-testid="side-nav-bar">
  <!-- Upper Section: Primary Navigation -->
  <div class="space-y-4">
    <!-- Side Nav CTA: Add Provider Key -->
    <button
      type="button"
      onclick={onOpenAddModal}
      class="w-full py-2 px-3 rounded-lg bg-surface-container-high hover:bg-surface-container-highest/60 text-primary border border-primary/20 flex items-center justify-center gap-2 text-label-md font-label-md font-medium transition-colors active:scale-[0.98] cursor-pointer"
    >
      <span class="material-symbols-outlined text-[16px]" data-icon="add_circle">add_circle</span>
      <span>Add Provider Key</span>
    </button>

    <!-- Primary 4 Top-Level Tabs per PRD Section 4: Dashboard / Keys / Pool / Analytics -->
    <div class="space-y-1 pt-2" role="navigation" aria-label="Main Navigation">
      <!-- 1. Dashboard -->
      <button
        type="button"
        data-testid="nav-tab-dashboard"
        onclick={() => handleTabClick('dashboard')}
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors active:scale-[0.98] cursor-pointer text-left {activeTab === 'dashboard' || activeTab === 'workbench' ? 'bg-surface-container-high text-primary font-medium border-l-2 border-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}"
      >
        <span class="material-symbols-outlined text-[18px]" data-icon="dashboard">dashboard</span>
        <span class="text-label-md font-label-md">Dashboard</span>
      </button>

      <!-- 2. Keys -->
      <button
        type="button"
        data-testid="nav-tab-keys"
        onclick={() => handleTabClick('keys')}
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors active:scale-[0.98] cursor-pointer text-left {activeTab === 'keys' ? 'bg-surface-container-high text-primary font-medium border-l-2 border-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}"
      >
        <span class="material-symbols-outlined text-[18px]" data-icon="vpn_key">vpn_key</span>
        <span class="text-label-md font-label-md">Keys</span>
        <span class="ml-auto text-[10px] font-mono px-1.5 py-0.2 rounded bg-surface-container text-outline">
          {keys.length}
        </span>
      </button>

      <!-- 3. Pool -->
      <button
        type="button"
        data-testid="nav-tab-pool"
        onclick={() => handleTabClick('pool')}
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors active:scale-[0.98] cursor-pointer text-left {activeTab === 'pool' || activeTab === 'commons' ? 'bg-surface-container-high text-primary font-medium border-l-2 border-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}"
      >
        <span class="material-symbols-outlined text-[18px]" data-icon="groups">groups</span>
        <span class="text-label-md font-label-md">Pool</span>
      </button>

      <!-- 4. Analytics -->
      <button
        type="button"
        data-testid="nav-tab-analytics"
        onclick={() => handleTabClick('analytics')}
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors active:scale-[0.98] cursor-pointer text-left {activeTab === 'analytics' ? 'bg-surface-container-high text-primary font-medium border-l-2 border-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}"
      >
        <span class="material-symbols-outlined text-[18px]" data-icon="insights">insights</span>
        <span class="text-label-md font-label-md">Analytics</span>
      </button>

      <!-- Developers Menu (Playground & API Docs) -->
      <div class="pt-3 border-t border-outline-variant/20 mt-2">
        <button
          type="button"
          data-testid="nav-developers-toggle"
          onclick={() => (isDevelopersOpen = !isDevelopersOpen)}
          class="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-outline hover:text-on-surface cursor-pointer"
        >
          <span>Developers</span>
          <span class="material-symbols-outlined text-[16px]">
            {isDevelopersOpen ? 'expand_less' : 'expand_more'}
          </span>
        </button>

        {#if isDevelopersOpen}
          <div class="space-y-1 mt-1 pl-2">
            <button
              type="button"
              data-testid="nav-tab-playground"
              onclick={() => handleTabClick('playground')}
              class="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors cursor-pointer text-left {activeTab === 'playground' ? 'bg-surface-container-high text-primary font-medium border-l-2 border-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}"
            >
              <span class="material-symbols-outlined text-[17px] text-emerald-400">science</span>
              <span class="text-xs">Playground</span>
            </button>

            <button
              type="button"
              data-testid="nav-tab-docs"
              onclick={() => handleTabClick('docs')}
              class="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors cursor-pointer text-left {activeTab === 'docs' ? 'bg-surface-container-high text-primary font-medium border-l-2 border-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}"
            >
              <span class="material-symbols-outlined text-[17px]">menu_book</span>
              <span class="text-xs">API Documentation</span>
            </button>
          </div>
        {/if}
      </div>

      <!-- Admin Panel (only on admin.* or admin tier) -->
      {#if isAdminHost || userAccount?.tier === 'admin'}
        <div class="space-y-1 pt-2 border-t border-outline-variant/20">
          <button
            type="button"
            data-testid="nav-tab-admin"
            onclick={() => handleTabClick('admin')}
            class="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors active:scale-[0.98] cursor-pointer text-left {activeTab === 'admin' ? 'bg-surface-container-high text-primary font-medium border-l-2 border-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}"
          >
            <span class="material-symbols-outlined text-[18px] text-amber-400">shield_person</span>
            <span class="text-label-md font-label-md text-amber-300">Admin Panel</span>
          </button>
        </div>
      {/if}
    </div>
  </div>

  <!-- Lower Section: Daily Quota Limit, CU Accounting & Footer Links -->
  <div class="pt-4 border-t border-outline-variant/30 space-y-2">
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
        <span class="text-secondary font-medium" title="Credit Unit Accounting ({cuUsedToday ?? stats?.cu_used_today ?? 0} CU)">
          {formatCu(cuUsedToday ?? stats?.cu_used_today ?? 0)} CU today
        </span>
        {#if stats?.cu_allowance_today || stats?.daily_quota_limit}
          <span class="text-outline">
            / {formatCu(stats.cu_allowance_today || stats.daily_quota_limit)} CU limit
          </span>
        {/if}
      </div>
    </div>

    <!-- Report / Takedown Link -->
    <button
      type="button"
      data-testid="nav-tab-report"
      onclick={() => handleTabClick('report')}
      class="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-error hover:bg-error/10 text-label-md font-label-md transition-colors cursor-pointer text-left"
    >
      <span class="material-symbols-outlined text-[18px]" data-icon="security">security</span>
      <span>Report / Takedown</span>
    </button>

    <!-- Support / GitHub Issues Link -->
    <a
      href="https://github.com/Axe-08/Key-Collective/issues"
      target="_blank"
      rel="noopener noreferrer"
      data-testid="nav-link-support"
      class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container/50 text-label-md font-label-md transition-colors cursor-pointer text-left"
    >
      <div class="flex items-center gap-3">
        <span class="material-symbols-outlined text-[18px]" data-icon="help">help</span>
        <span>Support</span>
      </div>
      <span class="material-symbols-outlined text-[14px] text-outline">open_in_new</span>
    </a>
  </div>
</aside>
