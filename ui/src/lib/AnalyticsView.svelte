<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './api';

  let subTab = $state<'usage' | 'ledger' | 'history'>('usage');
  let isLoading = $state(false);

  let usageRows = $state<Array<{ day: string; provider: string; model: string; requests: number; tokens: number; cu: number }>>([]);
  let ledgerItems = $state<Array<{
    id: string;
    key_id: string;
    provider: string;
    model_id: string;
    cu: number | null;
    prompt_tokens: number;
    completion_tokens: number;
    latency_ms: number;
    status_code: number;
    borrowed: number;
    created_at: string;
  }>>([]);
  let ledgerTotal = $state(0);
  let ledgerOffset = $state(0);
  const ledgerLimit = 25;

  let historyRows = $state<Array<{
    day: string;
    multiplier_pct: number;
    debt_cu: number;
    contributed_cu_24h: number;
    jail_status: string;
  }>>([]);

  async function loadAnalytics() {
    isLoading = true;
    try {
      const [uRes, lRes, hRes] = await Promise.all([
        api.getAnalyticsUsage().catch(() => ({ usage: [] })),
        api.getAnalyticsLedger(ledgerLimit, ledgerOffset).catch(() => ({ items: [], total: 0, limit: ledgerLimit, offset: 0 })),
        api.getAnalyticsMultiplierHistory().catch(() => ({ history: [] })),
      ]);
      usageRows = uRes.usage || [];
      ledgerItems = lRes.items || [];
      ledgerTotal = lRes.total || 0;
      historyRows = hRes.history || [];
    } finally {
      isLoading = false;
    }
  }

  async function loadLedgerPage(newOffset: number) {
    ledgerOffset = Math.max(0, newOffset);
    try {
      const lRes = await api.getAnalyticsLedger(ledgerLimit, ledgerOffset);
      ledgerItems = lRes.items || [];
      ledgerTotal = lRes.total || 0;
    } catch {
      // Non-blocking fallback
    }
  }

  onMount(() => {
    void loadAnalytics();
  });
</script>

<div class="space-y-6 font-mono" data-testid="analytics-view">
  <!-- Header -->
  <div class="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/20">
    <div>
      <div class="flex items-center gap-2 mb-1">
        <span class="text-xs uppercase tracking-wider text-primary">Telemetry &amp; Accounting</span>
        <span class="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 border border-primary/30 text-primary">
          Integer CU Rollups
        </span>
      </div>
      <h1 class="text-headline-md text-on-surface font-semibold tracking-tight">
        Analytics, Usage Ledger &amp; Multiplier History
      </h1>
    </div>

    <button
      type="button"
      onclick={loadAnalytics}
      class="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-xs text-on-surface flex items-center gap-1.5 border border-outline-variant/30 cursor-pointer"
    >
      <span class="material-symbols-outlined text-[16px] {isLoading ? 'animate-spin' : ''}">refresh</span>
      <span>Refresh</span>
    </button>
  </div>

  <!-- Sub-Tabs: Usage / Usage Ledger / Multiplier History -->
  <div class="flex items-center gap-2 border-b border-outline-variant/20 pb-2" role="tablist">
    <button
      type="button"
      role="tab"
      aria-selected={subTab === 'usage'}
      onclick={() => (subTab = 'usage')}
      class="px-3.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1.5 {subTab === 'usage' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span class="material-symbols-outlined text-[16px]">bar_chart</span>
      <span>Usage</span>
    </button>

    <button
      type="button"
      role="tab"
      aria-selected={subTab === 'ledger'}
      onclick={() => (subTab = 'ledger')}
      class="px-3.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1.5 {subTab === 'ledger' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span class="material-symbols-outlined text-[16px]">receipt_long</span>
      <span>Usage Ledger</span>
    </button>

    <button
      type="button"
      role="tab"
      aria-selected={subTab === 'history'}
      onclick={() => (subTab = 'history')}
      class="px-3.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1.5 {subTab === 'history' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span class="material-symbols-outlined text-[16px]">timeline</span>
      <span>Multiplier History</span>
    </button>
  </div>

  {#if subTab === 'usage'}
    <!-- Daily CU Rollup by Model -->
    <div class="rounded-xl border border-outline-variant/30 overflow-hidden bg-surface-container-low/70" data-testid="analytics-subtab-usage">
      <table class="w-full text-left text-xs">
        <thead class="bg-surface-container-highest/40 text-outline border-b border-outline-variant/20">
          <tr>
            <th class="py-2.5 px-3 font-medium">Day (UTC)</th>
            <th class="py-2.5 px-3 font-medium">Provider</th>
            <th class="py-2.5 px-3 font-medium">Model</th>
            <th class="py-2.5 px-3 font-medium">Total Requests</th>
            <th class="py-2.5 px-3 font-medium">Total Tokens</th>
            <th class="py-2.5 px-3 font-medium text-right">Total CU</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-outline-variant/10">
          {#if usageRows.length === 0}
            <tr>
              <td colspan="6" class="py-8 text-center text-outline">No daily usage rollups recorded yet.</td>
            </tr>
          {:else}
            {#each usageRows as row}
              <tr class="hover:bg-surface-container-highest/30">
                <td class="py-2.5 px-3 text-on-surface">{row.day}</td>
                <td class="py-2.5 px-3 uppercase text-outline">{row.provider}</td>
                <td class="py-2.5 px-3 text-primary font-semibold">{row.model}</td>
                <td class="py-2.5 px-3 text-on-surface">{row.requests.toLocaleString()}</td>
                <td class="py-2.5 px-3 text-outline">{row.tokens.toLocaleString()}</td>
                <td class="py-2.5 px-3 text-right font-semibold text-secondary">{row.cu.toLocaleString()} CU</td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  {/if}

  {#if subTab === 'ledger'}
    <!-- Paginated Cost Ledger -->
    <div class="space-y-3" data-testid="analytics-subtab-ledger">
      <div class="rounded-xl border border-outline-variant/30 overflow-hidden bg-surface-container-low/70">
        <table class="w-full text-left text-xs">
          <thead class="bg-surface-container-highest/40 text-outline border-b border-outline-variant/20">
            <tr>
              <th class="py-2.5 px-3 font-medium">Timestamp</th>
              <th class="py-2.5 px-3 font-medium">Provider</th>
              <th class="py-2.5 px-3 font-medium">Model</th>
              <th class="py-2.5 px-3 font-medium">Tokens (In/Out)</th>
              <th class="py-2.5 px-3 font-medium">Latency</th>
              <th class="py-2.5 px-3 font-medium">Status</th>
              <th class="py-2.5 px-3 font-medium">Source</th>
              <th class="py-2.5 px-3 font-medium text-right">CU</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-outline-variant/10">
            {#if ledgerItems.length === 0}
              <tr>
                <td colspan="8" class="py-8 text-center text-outline">No ledger entries recorded yet.</td>
              </tr>
            {:else}
              {#each ledgerItems as item (item.id)}
                <tr class="hover:bg-surface-container-highest/30">
                  <td class="py-2.5 px-3 text-outline">{new Date(item.created_at).toLocaleString()}</td>
                  <td class="py-2.5 px-3 uppercase text-outline">{item.provider}</td>
                  <td class="py-2.5 px-3 text-on-surface font-semibold">{item.model_id}</td>
                  <td class="py-2.5 px-3 text-outline">{item.prompt_tokens} / {item.completion_tokens}</td>
                  <td class="py-2.5 px-3 text-on-surface">{item.latency_ms} ms</td>
                  <td class="py-2.5 px-3">
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-bold {item.status_code < 400 ? 'bg-secondary/15 text-secondary' : 'bg-error/15 text-error'}">
                      {item.status_code}
                    </span>
                  </td>
                  <td class="py-2.5 px-3">
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase {item.borrowed ? 'bg-amber-500/15 text-amber-300' : 'bg-primary/15 text-primary'}">
                      {item.borrowed ? 'BORROWED' : 'OWN'}
                    </span>
                  </td>
                  <td class="py-2.5 px-3 text-right font-semibold text-on-surface">{(item.cu ?? 0).toLocaleString()} CU</td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>

      <!-- Pagination Controls -->
      {#if ledgerTotal > ledgerLimit}
        <div class="flex items-center justify-between text-xs text-outline">
          <span>Showing {ledgerOffset + 1}–{Math.min(ledgerOffset + ledgerLimit, ledgerTotal)} of {ledgerTotal}</span>
          <div class="flex items-center gap-2">
            <button
              type="button"
              disabled={ledgerOffset === 0}
              onclick={() => loadLedgerPage(ledgerOffset - ledgerLimit)}
              class="px-3 py-1 rounded bg-surface-container-high disabled:opacity-40 cursor-pointer"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={ledgerOffset + ledgerLimit >= ledgerTotal}
              onclick={() => loadLedgerPage(ledgerOffset + ledgerLimit)}
              class="px-3 py-1 rounded bg-surface-container-high disabled:opacity-40 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if subTab === 'history'}
    <!-- Standing / Multiplier History -->
    <div class="rounded-xl border border-outline-variant/30 overflow-hidden bg-surface-container-low/70" data-testid="analytics-subtab-history">
      <table class="w-full text-left text-xs">
        <thead class="bg-surface-container-highest/40 text-outline border-b border-outline-variant/20">
          <tr>
            <th class="py-2.5 px-3 font-medium">Day (UTC)</th>
            <th class="py-2.5 px-3 font-medium">Multiplier</th>
            <th class="py-2.5 px-3 font-medium">Communal Debt</th>
            <th class="py-2.5 px-3 font-medium">24h Contribution</th>
            <th class="py-2.5 px-3 font-medium">Standing Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-outline-variant/10">
          {#if historyRows.length === 0}
            <tr>
              <td colspan="5" class="py-8 text-center text-outline">No nightly standing snapshots recorded yet.</td>
            </tr>
          {:else}
            {#each historyRows as h (h.day)}
              <tr class="hover:bg-surface-container-highest/30">
                <td class="py-2.5 px-3 text-on-surface font-semibold">{h.day}</td>
                <td class="py-2.5 px-3 text-primary font-bold">{(h.multiplier_pct / 100).toFixed(2)}x</td>
                <td class="py-2.5 px-3 {h.debt_cu > 0 ? 'text-amber-300' : 'text-outline'}">{h.debt_cu.toLocaleString()} CU</td>
                <td class="py-2.5 px-3 text-secondary">{h.contributed_cu_24h.toLocaleString()} CU</td>
                <td class="py-2.5 px-3">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase {h.jail_status === 'PRISTINE' ? 'bg-secondary/15 text-secondary' : h.jail_status === 'SOFT_WARNING' ? 'bg-amber-500/15 text-amber-300' : 'bg-error/15 text-error'}">
                    {h.jail_status}
                  </span>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  {/if}
</div>
