<script lang="ts">
  import type { PoolStats } from './types';
  import type { UserAccount, UserTier } from '../../../src/contracts/v3_types';

  let {
    stats,
    activeTab = 'pool',
    onSelectTab,
    userAccount,
    onOpenAddModal,
    onOpenOAuthModal,
    onRefresh,
    isRefreshing = false,
  }: {
    stats: PoolStats;
    activeTab: 'pool' | 'workbench' | 'docs';
    onSelectTab: (tab: 'pool' | 'workbench' | 'docs') => void;
    userAccount?: UserAccount;
    onOpenAddModal: () => void;
    onOpenOAuthModal: () => void;
    onRefresh: () => void;
    isRefreshing?: boolean;
  } = $props();

  const quotaPercent = $derived(
    stats.daily_quota_limit > 0
      ? Math.min(100, Math.round((stats.daily_quota_used / stats.daily_quota_limit) * 1000) / 10)
      : 0
  );

  function getTierBadgeColor(tier?: UserTier): string {
    switch (tier) {
      case 'admin':
        return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
      case 'ultra':
        return 'bg-purple-500/10 text-purple-300 border-purple-500/30';
      case 'max':
        return 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30';
      case 'builder':
        return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
      case 'probationary':
        return 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30';
      case 'demo':
        return 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30';
      default:
        return 'bg-slate-500/10 text-slate-300 border-slate-500/30';
    }
  }
</script>

<header class="w-full border-b border-white/[0.08] bg-[#0c0f17]/90 backdrop-blur-md sticky top-0 z-30">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
    <!-- Brand & Proxy Status Badge -->
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-0.5 shadow-lg shadow-indigo-500/20 flex items-center justify-center">
          <div class="w-full h-full bg-[#0d111a] rounded-[6px] flex items-center justify-center">
            <svg class="w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          </div>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="font-bold tracking-tight text-white text-base">Key Collective</span>
            <span class="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-semibold">v3.0</span>
          </div>
          <p class="text-[11px] text-slate-400 font-mono hidden sm:block">Intelligent LLM Pool & Rate-Limit Shield</p>
        </div>
      </div>
    </div>

    <!-- Center Navigation Tabs -->
    <nav class="hidden md:flex items-center p-1 rounded-xl bg-slate-950/80 border border-white/[0.08] text-xs font-mono">
      <button
        type="button"
        onclick={() => onSelectTab('pool')}
        class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all {activeTab === 'pool' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        <span>Pool & Shield</span>
      </button>

      <button
        type="button"
        onclick={() => onSelectTab('workbench')}
        class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all {activeTab === 'workbench' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <span>Developer Workbench</span>
        {#if userAccount?.tier}
          <span class="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase border {getTierBadgeColor(userAccount.tier)}">
            {userAccount.tier}
          </span>
        {/if}
      </button>

      <button
        type="button"
        onclick={() => onSelectTab('docs')}
        class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all {activeTab === 'docs' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span>API Docs</span>
      </button>
    </nav>

    <!-- Master Daily Quota Counter & Actions -->
    <div class="flex items-center gap-3">
      <!-- Master Daily Quota Widget -->
      <div class="hidden xl:flex items-center gap-3 px-3 py-1 rounded-lg bg-slate-900/80 border border-white/[0.08] shadow-inner">
        <div class="flex flex-col">
          <div class="flex items-center justify-between gap-3 text-[10px] font-mono">
            <span class="text-slate-400 uppercase tracking-wider font-semibold">Master Quota</span>
            <span class="text-slate-200 font-semibold">{stats.daily_quota_used.toLocaleString()} / {stats.daily_quota_limit.toLocaleString()}</span>
          </div>
          <div class="w-32 h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1 border border-white/5">
            <div
              class="h-full rounded-full transition-all duration-500 {quotaPercent > 85 ? 'bg-rose-500' : quotaPercent > 65 ? 'bg-amber-500' : 'bg-gradient-to-r from-indigo-500 to-emerald-400'}"
              style="width: {quotaPercent}%"
            ></div>
          </div>
        </div>
      </div>

      <!-- Sync / Refresh Button -->
      <button
        type="button"
        onclick={onRefresh}
        class="p-2 rounded-lg text-slate-400 hover:text-white bg-slate-900/60 hover:bg-slate-800 border border-white/[0.08] transition-all hover:border-white/20 active:scale-95"
        title="Refresh stats and pool status"
        aria-label="Refresh pool state"
      >
        <svg class="w-4 h-4 {isRefreshing ? 'animate-spin text-indigo-400' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
        </svg>
      </button>

      <!-- Quick Add API Key Button (shows on pool tab) -->
      {#if activeTab === 'pool'}
        <button
          type="button"
          onclick={onOpenAddModal}
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-medium font-mono shadow-lg shadow-indigo-900/30 border border-indigo-400/30 transition-all active:scale-[0.98] cursor-pointer"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
          </svg>
          <span class="hidden sm:inline">Add Key</span>
        </button>
      {/if}

      <!-- GitHub OAuth & Account Card Button -->
      <button
        type="button"
        onclick={onOpenOAuthModal}
        class="inline-flex items-center gap-2 pl-2 pr-3 py-1 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-white/[0.1] hover:border-indigo-500/40 transition-all text-xs font-mono shadow-md cursor-pointer"
        title="View account profile, authorization tier, and anti-sybil validation"
      >
        {#if userAccount?.avatarUrl}
          <img
            src={userAccount.avatarUrl}
            alt={userAccount.githubUsername}
            class="w-6 h-6 rounded-full border border-indigo-500/40 object-cover"
          />
        {:else}
          <div class="w-6 h-6 rounded-full bg-slate-800 border border-white/20 flex items-center justify-center text-[10px] font-bold text-indigo-400">
            {userAccount?.githubUsername ? userAccount.githubUsername.slice(0, 2).toUpperCase() : 'GH'}
          </div>
        {/if}

        <div class="flex flex-col text-left">
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-slate-200">@{userAccount?.githubUsername || 'guest'}</span>
            <span class="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase border {getTierBadgeColor(userAccount?.tier)}">
              {userAccount?.tier || 'demo'}
            </span>
          </div>
        </div>

        <svg class="w-3.5 h-3.5 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Mobile Tab Bar (shows below header on small screens) -->
  <div class="md:hidden flex items-center justify-around px-4 py-2 border-t border-white/[0.06] bg-[#090b10] text-xs font-mono">
    <button
      type="button"
      onclick={() => onSelectTab('pool')}
      class="px-3 py-1 rounded {activeTab === 'pool' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400'}"
    >
      Pool & Shield
    </button>
    <button
      type="button"
      onclick={() => onSelectTab('workbench')}
      class="px-3 py-1 rounded {activeTab === 'workbench' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400'}"
    >
      Workbench
    </button>
    <button
      type="button"
      onclick={() => onSelectTab('docs')}
      class="px-3 py-1 rounded {activeTab === 'docs' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400'}"
    >
      API Docs
    </button>
  </div>
</header>
