<script lang="ts">
  import type { PoolStats } from './types';

  let {
    stats,
    onOpenAddModal,
    onRefresh,
    isRefreshing = false,
  }: {
    stats: PoolStats;
    onOpenAddModal: () => void;
    onRefresh: () => void;
    isRefreshing?: boolean;
  } = $props();

  const quotaPercent = $derived(
    stats.daily_quota_limit > 0
      ? Math.min(100, Math.round((stats.daily_quota_used / stats.daily_quota_limit) * 1000) / 10)
      : 0
  );
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
            <span class="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-semibold">Proxy v1.2</span>
          </div>
          <p class="text-[11px] text-slate-400 font-mono hidden sm:block">Intelligent LLM Pool & Rate-Limit Shield</p>
        </div>
      </div>

      <div class="hidden md:flex items-center gap-2 pl-3 border-l border-white/10">
        <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-mono font-medium {stats.proxy_status === 'healthy' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25' : stats.proxy_status === 'degraded' ? 'bg-amber-500/10 text-amber-300 border border-amber-500/25' : 'bg-rose-500/10 text-rose-300 border border-rose-500/25'}">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full {stats.proxy_status === 'healthy' ? 'bg-emerald-400 opacity-75' : stats.proxy_status === 'degraded' ? 'bg-amber-400 opacity-75' : 'bg-rose-400 opacity-75'}"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 {stats.proxy_status === 'healthy' ? 'bg-emerald-500' : stats.proxy_status === 'degraded' ? 'bg-amber-500' : 'bg-rose-500'}"></span>
          </span>
          <span>Key Collective Proxy Active</span>
        </div>
      </div>
    </div>

    <!-- Master Daily Quota Counter & Actions -->
    <div class="flex items-center gap-4">
      <!-- Master Daily Quota Widget -->
      <div class="hidden lg:flex items-center gap-3 px-3.5 py-1.5 rounded-lg bg-slate-900/80 border border-white/[0.08] shadow-inner">
        <div class="flex flex-col">
          <div class="flex items-center justify-between gap-3 text-[11px] font-mono">
            <span class="text-slate-400 uppercase tracking-wider font-semibold">Master Daily Quota</span>
            <span class="text-slate-200 font-semibold">{stats.daily_quota_used.toLocaleString()} / {stats.daily_quota_limit.toLocaleString()}</span>
          </div>
          <div class="w-44 h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1.5 border border-white/5">
            <div
              class="h-full rounded-full transition-all duration-500 {quotaPercent > 85 ? 'bg-rose-500' : quotaPercent > 65 ? 'bg-amber-500' : 'bg-gradient-to-r from-indigo-500 to-emerald-400'}"
              style="width: {quotaPercent}%"
            ></div>
          </div>
        </div>
        <span class="text-xs font-mono font-medium {quotaPercent > 85 ? 'text-rose-400' : quotaPercent > 65 ? 'text-amber-400' : 'text-emerald-400'}">
          {quotaPercent}%
        </span>
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

      <!-- Quick Add API Key Button -->
      <button
        type="button"
        onclick={onOpenAddModal}
        class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-medium font-mono shadow-lg shadow-indigo-900/30 border border-indigo-400/30 transition-all hover:shadow-indigo-600/40 active:scale-[0.98] cursor-pointer"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
        </svg>
        <span>Add API Key</span>
      </button>
    </div>
  </div>
</header>
