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

<header class="w-full border-b border-white/[0.08] bg-[#090B10]/80 backdrop-blur-xl sticky top-0 z-30 specular-border">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
    <!-- Brand & Edge Region Ping -->
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 via-indigo-600 to-purple-700 p-0.5 shadow-lg shadow-indigo-500/20 flex items-center justify-center">
          <div class="w-full h-full bg-[#090B10] rounded-[6px] flex items-center justify-center">
            <svg class="w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          </div>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="font-bold tracking-tight text-white text-base">Key Collective</span>
            <span class="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-semibold">v3.5</span>
            <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono font-medium">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              CF Edge: IAD-01
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Center Navigation Tabs (Obsidian Edge Floating Pill) -->
    <nav class="hidden md:flex items-center p-1 rounded-xl bg-[#0C0F17]/90 border border-white/[0.08] text-xs font-mono backdrop-blur-xl">
      <button
        type="button"
        onclick={() => onSelectTab('pool')}
        class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all cursor-pointer {activeTab === 'pool' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        <span>Pool & Shield</span>
      </button>

      <button
        type="button"
        onclick={() => onSelectTab('workbench')}
        class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all cursor-pointer {activeTab === 'workbench' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}"
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
        class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all cursor-pointer {activeTab === 'docs' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span>API Console & Docs</span>
      </button>
    </nav>

    <!-- Right Quick Actions: Inject Key & OAuth/Sybil Profile -->
    <div class="flex items-center gap-3">
      <!-- Live Refresh Button -->
      <button
        type="button"
        onclick={onRefresh}
        disabled={isRefreshing}
        class="p-2 rounded-lg bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.08] text-slate-400 hover:text-slate-200 transition-all cursor-pointer disabled:opacity-50"
        title="Refresh Pool Telemetry"
      >
        <svg class="w-4 h-4 {isRefreshing ? 'animate-spin text-indigo-400' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
        </svg>
      </button>

      <!-- Add Key Action -->
      <button
        type="button"
        onclick={onOpenAddModal}
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-medium shadow-md shadow-indigo-600/20 border border-indigo-400/30 transition-all cursor-pointer"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span class="hidden sm:inline">Inject Key</span>
      </button>

      <!-- Account & Sybil Gate Trigger -->
      <button
        type="button"
        onclick={onOpenOAuthModal}
        class="flex items-center gap-2 p-1.5 pr-2.5 rounded-lg bg-[#0C0F17] border border-white/[0.08] hover:border-indigo-500/30 transition-all cursor-pointer"
      >
        {#if userAccount?.avatarUrl}
          <img src={userAccount.avatarUrl} alt="Avatar" class="w-6 h-6 rounded-full border border-white/10" />
        {:else}
          <div class="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-[10px] text-indigo-300 font-mono">
            {userAccount?.githubUsername ? userAccount.githubUsername.substring(0, 2).toUpperCase() : 'GH'}
          </div>
        {/if}
        <div class="hidden sm:flex flex-col text-left">
          <span class="text-[11px] font-mono font-medium text-slate-200 leading-tight">
            @{userAccount?.githubUsername || 'anonymous'}
          </span>
          <span class="text-[9px] font-mono text-emerald-400 leading-tight">
            Trust: {userAccount?.sybilScore ?? 98}/100
          </span>
        </div>
      </button>
    </div>
  </div>
</header>
