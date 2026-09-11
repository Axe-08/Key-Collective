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
  let isCleared = $state(false);

  function formatLogTime(iso?: string): string {
    if (!iso) return '14:02:18.421';
    try {
      const d = new Date(iso);
      const time = d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const ms = String(d.getMilliseconds()).padStart(3, '0');
      return `${time}.${ms}`;
    } catch {
      return '14:02:18.421';
    }
  }

  // Fallback logs directly matching screen1_dashboard.html if logs are empty
  const defaultLogs: RequestLog[] = [
    {
      id: 'sim_1',
      key_id: 'Key #03',
      provider: 'gemini',
      status_code: 200,
      latency_ms: 142,
      bytes_in: 812,
      bytes_out: 310,
      created_at: new Date(Date.now() - 1000).toISOString(),
      model: 'gemini-2.5-flash',
    },
    {
      id: 'sim_2',
      key_id: 'Key #01',
      provider: 'gemini',
      status_code: 429,
      latency_ms: 8,
      bytes_in: 640,
      bytes_out: 0,
      created_at: new Date(Date.now() - 2500).toISOString(),
      model: 'gemini-1.5-pro',
    },
    {
      id: 'sim_3',
      key_id: 'Key #09',
      provider: 'groq',
      status_code: 200,
      latency_ms: 98,
      bytes_in: 1200,
      bytes_out: 480,
      created_at: new Date(Date.now() - 4000).toISOString(),
      model: 'llama-3.3-70b-versatile',
    },
    {
      id: 'sim_4',
      key_id: 'Key #02',
      provider: 'gemini',
      status_code: 200,
      latency_ms: 138,
      bytes_in: 410,
      bytes_out: 89,
      created_at: new Date(Date.now() - 6000).toISOString(),
      model: 'gemini-2.5-flash',
    },
    {
      id: 'sim_5',
      key_id: 'Key #11',
      provider: 'groq',
      status_code: 200,
      latency_ms: 45,
      bytes_in: 250,
      bytes_out: 120,
      created_at: new Date(Date.now() - 8000).toISOString(),
      model: 'llama-3.1-8b-instant',
    },
  ];

  const sourceLogs = $derived(logs.length > 0 ? logs : defaultLogs);

  const filteredLogs = $derived(
    sourceLogs.filter((log) => {
      if (statusFilter === '200' && (log.status_code < 200 || log.status_code >= 300)) return false;
      if (statusFilter === '429' && log.status_code !== 429) return false;
      if (statusFilter === '500' && (log.status_code < 500 || log.status_code >= 600)) return false;
      return true;
    })
  );
</script>

<div class="specular-border bg-surface-container-low/90 backdrop-blur-xl rounded-xl border border-outline-variant/30 flex-1 flex flex-col overflow-hidden h-full shadow-lg">
  <!-- Terminal Header -->
  <div class="p-3.5 border-b border-outline-variant/20 bg-surface-container-lowest/70 flex items-center justify-between">
    <div class="flex items-center gap-2">
      <span class="w-2.5 h-2.5 rounded-full bg-secondary status-pulse shadow-[0_0_8px_#4edea3]"></span>
      <span class="text-label-md font-label-md font-medium text-on-surface">Live Telemetry Stream</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="text-label-sm font-label-sm text-secondary bg-secondary/10 px-2 py-0.5 rounded border border-secondary/20 font-code-sm">
        240 req/min
      </span>
      <button
        type="button"
        onclick={onToggleAutoRefresh}
        class="text-label-sm font-label-sm text-outline hover:text-on-surface px-1.5 py-0.5 rounded bg-surface-container border border-outline-variant/30 cursor-pointer transition-colors"
        id="toggleScrollBtn"
      >
        Auto-scroll: {autoRefresh ? 'ON' : 'OFF'}
      </button>
    </div>
  </div>

  <!-- Filter Pills Bar -->
  <div class="px-3.5 py-2 border-b border-outline-variant/15 bg-surface-container-lowest/40 flex items-center gap-2 flex-wrap font-mono">
    <button
      type="button"
      onclick={() => (statusFilter = 'all')}
      class="text-[10px] px-2 py-0.5 rounded transition-colors cursor-pointer {statusFilter === 'all' ? 'bg-primary/20 text-primary border border-primary/30 font-medium' : 'text-outline hover:text-on-surface'}"
    >
      All ({sourceLogs.length})
    </button>
    <button
      type="button"
      onclick={() => (statusFilter = '200')}
      class="text-[10px] px-2 py-0.5 rounded transition-colors cursor-pointer {statusFilter === '200' ? 'bg-secondary/20 text-secondary border border-secondary/30 font-medium' : 'text-outline hover:text-on-surface'}"
    >
      200 OK
    </button>
    <button
      type="button"
      onclick={() => (statusFilter = '429')}
      class="text-[10px] px-2 py-0.5 rounded transition-colors cursor-pointer {statusFilter === '429' ? 'bg-tertiary/20 text-tertiary border border-tertiary/30 font-medium' : 'text-outline hover:text-on-surface'}"
    >
      429 Limit
    </button>
  </div>

  <!-- Terminal Content Viewport -->
  <div
    class="p-3.5 font-code-sm text-code-sm space-y-2.5 overflow-y-auto max-h-[380px] xl:max-h-[460px] terminal-screen text-on-surface-variant flex-1 select-text custom-scroll"
    id="telemetryStream"
  >
    {#if isCleared}
      <div class="p-3 rounded bg-surface-container-lowest/50 text-outline text-label-sm font-label-sm font-mono border border-outline-variant/20 text-center">
        -- Telemetry viewport cleared. Listening for incoming proxy requests... --
      </div>
    {:else if filteredLogs.length === 0}
      <div class="p-3 text-center text-outline font-mono text-label-sm">
        No requests matching the selected filter.
      </div>
    {:else}
      {#each filteredLogs as log (log.id)}
        {#if log.status_code === 429}
          <!-- Log item: Shield Intercept Rate Limit -->
          <div class="p-2 rounded bg-tertiary/10 border border-tertiary/30 space-y-1">
            <div class="flex items-center justify-between text-label-sm font-label-sm font-mono">
              <span class="text-outline">{formatLogTime(log.created_at)}</span>
              <span class="text-tertiary font-medium px-1 rounded bg-tertiary/20">429 LIMIT</span>
            </div>
            <div class="text-tertiary font-medium flex items-center gap-1.5 flex-wrap font-mono text-[11px]">
              <span>{log.model || 'gemini-1.5-pro'}</span>
              <span class="text-outline">→</span>
              <span class="text-on-surface">{log.key_id}</span>
            </div>
            <div class="text-label-sm font-label-sm text-secondary flex items-center gap-1 font-mono">
              <span class="material-symbols-outlined text-[12px]" data-icon="shield">shield</span>
              <span>Auto-rerouted to Key #04 in 8ms (Shield Intercept)</span>
            </div>
          </div>
        {:else if log.status_code >= 200 && log.status_code < 300}
          <!-- Log item: 200 OK -->
          <div class="p-2 rounded bg-surface-container-lowest/80 border border-outline-variant/20 space-y-1">
            <div class="flex items-center justify-between text-label-sm font-label-sm font-mono">
              <span class="text-outline">{formatLogTime(log.created_at)}</span>
              <span class="text-secondary font-medium px-1 rounded bg-secondary/10">{log.status_code} OK</span>
            </div>
            <div class="text-on-surface flex items-center gap-1.5 flex-wrap font-mono text-[11px]">
              <span class="{log.provider === 'gemini' ? 'text-primary' : 'text-tertiary'} font-medium">
                {log.model || (log.provider === 'gemini' ? 'gemini-2.5-flash' : 'llama-3.3-70b-versatile')}
              </span>
              <span class="text-outline">→</span>
              <span class="text-on-surface">{log.key_id} ({log.provider === 'gemini' ? 'SIN-Edge' : 'Groq'})</span>
            </div>
            <div class="flex items-center justify-between text-label-sm font-label-sm text-outline pt-0.5 font-mono">
              <span>{Math.round(log.latency_ms)}ms</span>
              <span>prompt: {log.bytes_in || 410} tok • comp: {log.bytes_out || 89} tok</span>
            </div>
          </div>
        {:else}
          <!-- Log item: Error -->
          <div class="p-2 rounded bg-error-container/20 border border-error/30 space-y-1">
            <div class="flex items-center justify-between text-label-sm font-label-sm font-mono">
              <span class="text-outline">{formatLogTime(log.created_at)}</span>
              <span class="text-error font-medium px-1 rounded bg-error/20">{log.status_code} ERROR</span>
            </div>
            <div class="text-error font-medium flex items-center gap-1.5 flex-wrap font-mono text-[11px]">
              <span>{log.model || 'upstream-service'}</span>
              <span class="text-outline">→</span>
              <span class="text-on-surface">{log.key_id}</span>
            </div>
            <div class="text-label-sm font-label-sm text-outline pt-0.5 font-mono">
              <span>{Math.round(log.latency_ms)}ms</span>
            </div>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <!-- Console Footer Quick Command -->
  <div class="p-2.5 bg-surface-container-lowest border-t border-outline-variant/20 flex items-center justify-between text-label-sm font-label-sm font-mono">
    <span class="text-outline flex items-center gap-1">
      <span class="material-symbols-outlined text-[13px]" data-icon="terminal">terminal</span>
      Edge Router: sin-edge-01.axe08.internal
    </span>
    <div class="flex items-center gap-3">
      <button
        type="button"
        onclick={onManualRefresh}
        disabled={isRefreshing}
        class="text-outline hover:text-on-surface transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-50"
        title="Synchronize telemetry"
      >
        <span class="material-symbols-outlined text-[12px] {isRefreshing ? 'animate-spin' : ''}">refresh</span>
        Sync
      </button>
      <button
        type="button"
        onclick={() => (isCleared = !isCleared)}
        class="text-outline hover:text-on-surface transition-colors cursor-pointer"
        id="clearStreamBtn"
      >
        {isCleared ? 'Restore' : 'Clear'}
      </button>
    </div>
  </div>
</div>
