<script lang="ts">
  import type { RequestLog } from './types';

  let {
    logs,
    autoRefresh,
    onToggleAutoRefresh,
    onManualRefresh,
    isRefreshing = false,
  }: {
    logs: RequestLog[];
    autoRefresh: boolean;
    onToggleAutoRefresh: () => void;
    onManualRefresh: () => Promise<void>;
    isRefreshing?: boolean;
  } = $props();

  let statusFilter = $state<string>('all');
  let providerFilter = $state<string>('all');

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatTime(iso: string): { time: string; relative: string } {
    try {
      const date = new Date(iso);
      const time = date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
      let relative = `${diffSec}s ago`;
      if (diffSec >= 60) {
        relative = `${Math.floor(diffSec / 60)}m ago`;
      }
      return { time, relative };
    } catch {
      return { time: '--:--', relative: '' };
    }
  }

  const filteredLogs = $derived(
    logs.filter((log) => {
      if (providerFilter !== 'all' && log.provider !== providerFilter) return false;
      if (statusFilter === '200' && (log.status_code < 200 || log.status_code >= 300)) return false;
      if (statusFilter === '429' && log.status_code !== 429) return false;
      if (statusFilter === '500' && (log.status_code < 500 || log.status_code >= 600)) return false;
      return true;
    })
  );
</script>

<div class="rounded-xl bg-slate-900/70 border border-white/[0.08] shadow-xl backdrop-blur-sm overflow-hidden">
  <!-- Header & Live Auto-Refresh Toolbar -->
  <div class="p-4 border-b border-white/[0.08] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/50">
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold font-mono uppercase tracking-wider text-slate-200">
          Live Request Telemetry
        </h2>
        <span class="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-slate-800 text-slate-300 border border-white/10">
          Last {filteredLogs.length} reqs
        </span>
      </div>

      {#if autoRefresh}
        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
          Live Stream (3s)
        </span>
      {/if}
    </div>

    <!-- Controls -->
    <div class="flex flex-wrap items-center gap-2">
      <!-- Status Filter -->
      <select
        bind:value={statusFilter}
        class="py-1.5 px-2.5 rounded-lg bg-slate-950/70 border border-white/10 text-xs font-mono text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
        aria-label="Filter telemetry logs by HTTP status"
      >
        <option value="all">All Statuses</option>
        <option value="200">2xx Success (OK)</option>
        <option value="429">429 Rate-Limited</option>
        <option value="500">5xx Upstream Errors</option>
      </select>

      <!-- Provider Filter -->
      <select
        bind:value={providerFilter}
        class="py-1.5 px-2.5 rounded-lg bg-slate-950/70 border border-white/10 text-xs font-mono text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
        aria-label="Filter telemetry logs by provider"
      >
        <option value="all">All Providers</option>
        <option value="gemini">Gemini</option>
        <option value="groq">Groq</option>
      </select>

      <!-- Auto-Refresh Toggle -->
      <button
        type="button"
        onclick={onToggleAutoRefresh}
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-all cursor-pointer {autoRefresh
          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
          : 'bg-slate-950/70 border-white/10 text-slate-400 hover:text-slate-200'}"
        title="Toggle 3-second live polling interval"
      >
        <span class="w-2 h-2 rounded-full {autoRefresh ? 'bg-emerald-400' : 'bg-slate-600'}"></span>
        Auto-Refresh
      </button>

      <!-- Manual Refresh -->
      <button
        type="button"
        onclick={onManualRefresh}
        disabled={isRefreshing}
        class="p-1.5 rounded-lg bg-slate-950/70 hover:bg-slate-800 text-slate-400 hover:text-white border border-white/10 transition-colors disabled:opacity-50 cursor-pointer"
        title="Refresh telemetry immediately"
        aria-label="Refresh telemetry"
      >
        <svg class="w-4 h-4 {isRefreshing ? 'animate-spin text-indigo-400' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Telemetry Table -->
  <div class="overflow-x-auto max-h-[440px] overflow-y-auto">
    <table class="w-full text-left text-xs font-mono border-collapse">
      <thead class="sticky top-0 z-10">
        <tr class="border-b border-white/[0.08] bg-slate-950/95 text-slate-400 uppercase tracking-wider text-[11px] backdrop-blur-sm">
          <th class="py-2.5 px-4 font-semibold">Timestamp</th>
          <th class="py-2.5 px-4 font-semibold">Routed Key ID</th>
          <th class="py-2.5 px-4 font-semibold">Provider</th>
          <th class="py-2.5 px-4 font-semibold">Status</th>
          <th class="py-2.5 px-4 font-semibold">Latency</th>
          <th class="py-2.5 px-4 font-semibold text-right">Payload In / Out</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-white/[0.04]">
        {#if filteredLogs.length === 0}
          <tr>
            <td colspan="6" class="py-10 text-center text-slate-500 font-mono">
              No recent requests matching the selected filter.
            </td>
          </tr>
        {:else}
          {#each filteredLogs as log (log.id)}
            {@const timeInfo = formatTime(log.created_at)}
            <tr class="hover:bg-slate-800/30 transition-colors">
              <!-- Timestamp -->
              <td class="py-2.5 px-4 whitespace-nowrap">
                <span class="text-slate-200 font-medium">{timeInfo.time}</span>
                <span class="text-[10px] text-slate-500 ml-1.5">{timeInfo.relative}</span>
              </td>

              <!-- Key ID -->
              <td class="py-2.5 px-4 whitespace-nowrap">
                <span class="px-2 py-0.5 rounded bg-slate-950/80 border border-white/10 text-slate-300 font-mono text-[11px]">
                  {log.key_id}
                </span>
                {#if log.model}
                  <span class="text-[10px] text-slate-500 ml-1.5">{log.model}</span>
                {/if}
              </td>

              <!-- Provider -->
              <td class="py-2.5 px-4 whitespace-nowrap">
                {#if log.provider === 'gemini'}
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    Gemini
                  </span>
                {:else}
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                    Groq
                  </span>
                {/if}
              </td>

              <!-- HTTP Status -->
              <td class="py-2.5 px-4 whitespace-nowrap">
                {#if log.status_code >= 200 && log.status_code < 300}
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    {log.status_code} OK
                  </span>
                {:else if log.status_code === 429}
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    429 RATE LIMIT
                  </span>
                {:else}
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                    <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                    {log.status_code} ERROR
                  </span>
                {/if}
              </td>

              <!-- Latency -->
              <td class="py-2.5 px-4 whitespace-nowrap">
                <span class="font-semibold {log.latency_ms < 250 ? 'text-emerald-400' : log.latency_ms < 600 ? 'text-amber-400' : 'text-rose-400'}">
                  {Math.round(log.latency_ms)} ms
                </span>
              </td>

              <!-- Bytes In / Out -->
              <td class="py-2.5 px-4 text-right whitespace-nowrap text-slate-400">
                <span>{formatBytes(log.bytes_in)}</span>
                <span class="text-slate-600 mx-1">/</span>
                <span class="text-slate-200">{formatBytes(log.bytes_out)}</span>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>
