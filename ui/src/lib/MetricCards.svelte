<script lang="ts">
  import type { PoolStats, APIKey } from './types';

  let { stats, keys }: { stats: PoolStats; keys: APIKey[] } = $props();

  const geminiCount = $derived(keys.filter((k) => k.provider === 'gemini').length);
  const groqCount = $derived(keys.filter((k) => k.provider === 'groq').length);

  const rpmHeadroomPercent = $derived(
    stats.total_rpm_limit > 0
      ? Math.max(0, Math.min(100, Math.round((stats.total_rpm_headroom / stats.total_rpm_limit) * 100)))
      : 0
  );
</script>

<section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
  <!-- Card 1: Total Managed Keys -->
  <div class="relative overflow-hidden rounded-xl bg-slate-900/70 border border-white/[0.08] p-5 shadow-lg backdrop-blur-sm transition-all hover:border-white/15">
    <div class="flex items-center justify-between text-xs font-mono text-slate-400 mb-2">
      <span class="uppercase tracking-wider font-semibold">Total Managed Keys</span>
      <div class="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
        </svg>
      </div>
    </div>
    <div class="flex items-baseline gap-2">
      <span class="text-3xl font-bold font-mono text-white tracking-tight">{stats.total_keys}</span>
      <span class="text-xs text-slate-400 font-mono">active pool</span>
    </div>
    <div class="mt-3 flex items-center gap-2 text-xs font-mono">
      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
        <span class="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
        {geminiCount} Gemini
      </span>
      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
        {groqCount} Groq
      </span>
    </div>
  </div>

  <!-- Card 2: Healthy / Active Keys vs Rate-Limited -->
  <div class="relative overflow-hidden rounded-xl bg-slate-900/70 border border-white/[0.08] p-5 shadow-lg backdrop-blur-sm transition-all hover:border-white/15">
    <div class="flex items-center justify-between text-xs font-mono text-slate-400 mb-2">
      <span class="uppercase tracking-wider font-semibold">Active vs Rate-Limited</span>
      <div class="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      </div>
    </div>
    <div class="flex items-baseline gap-2.5">
      <span class="text-3xl font-bold font-mono text-emerald-400 tracking-tight">{stats.healthy_keys}</span>
      <span class="text-sm font-mono text-slate-400">/</span>
      <span class="text-2xl font-semibold font-mono text-amber-400">{stats.rate_limited_keys}</span>
      {#if stats.invalid_keys > 0}
        <span class="text-xs font-mono text-rose-400 font-semibold">({stats.invalid_keys} invalid)</span>
      {/if}
    </div>
    <div class="mt-3 flex items-center gap-2 text-xs font-mono">
      <span class="inline-flex items-center gap-1.5 text-emerald-300">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        {stats.healthy_keys} Ready
      </span>
      <span class="text-slate-600">•</span>
      <span class="inline-flex items-center gap-1.5 text-amber-300">
        <span class="w-2 h-2 rounded-full bg-amber-400"></span>
        {stats.rate_limited_keys} In Cooldown
      </span>
    </div>
  </div>

  <!-- Card 3: Current Pool Capacity (Total RPM Headroom) -->
  <div class="relative overflow-hidden rounded-xl bg-slate-900/70 border border-white/[0.08] p-5 shadow-lg backdrop-blur-sm transition-all hover:border-white/15">
    <div class="flex items-center justify-between text-xs font-mono text-slate-400 mb-2">
      <span class="uppercase tracking-wider font-semibold">Pool RPM Headroom</span>
      <div class="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </div>
    </div>
    <div class="flex items-baseline justify-between">
      <div class="flex items-baseline gap-1.5">
        <span class="text-3xl font-bold font-mono text-cyan-300 tracking-tight">{stats.total_rpm_headroom}</span>
        <span class="text-xs font-mono text-slate-400">/ {stats.total_rpm_limit} RPM</span>
      </div>
      <span class="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
        {rpmHeadroomPercent}% free
      </span>
    </div>
    <div class="mt-3.5 w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden border border-white/5">
      <div
        class="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-cyan-400 to-indigo-400"
        style="width: {rpmHeadroomPercent}%"
      ></div>
    </div>
  </div>

  <!-- Card 4: Average Upstream Latency -->
  <div class="relative overflow-hidden rounded-xl bg-slate-900/70 border border-white/[0.08] p-5 shadow-lg backdrop-blur-sm transition-all hover:border-white/15">
    <div class="flex items-center justify-between text-xs font-mono text-slate-400 mb-2">
      <span class="uppercase tracking-wider font-semibold">Avg Upstream Latency</span>
      <div class="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </div>
    </div>
    <div class="flex items-baseline gap-2">
      <span class="text-3xl font-bold font-mono text-white tracking-tight">{stats.avg_upstream_latency_ms}</span>
      <span class="text-xs font-mono text-slate-400">ms</span>
    </div>
    <div class="mt-3 flex items-center justify-between text-xs font-mono">
      <span class="inline-flex items-center gap-1.5 {stats.avg_upstream_latency_ms < 300 ? 'text-emerald-400' : stats.avg_upstream_latency_ms < 600 ? 'text-amber-400' : 'text-rose-400'}">
        <span class="w-1.5 h-1.5 rounded-full {stats.avg_upstream_latency_ms < 300 ? 'bg-emerald-400' : stats.avg_upstream_latency_ms < 600 ? 'bg-amber-400' : 'bg-rose-400'}"></span>
        {stats.avg_upstream_latency_ms < 300 ? 'Ultra Fast' : stats.avg_upstream_latency_ms < 600 ? 'Optimal' : 'High Delay'}
      </span>
      <span class="text-[11px] text-slate-500">p95: ~{Math.round(stats.avg_upstream_latency_ms * 1.8)}ms</span>
    </div>
  </div>
</section>
