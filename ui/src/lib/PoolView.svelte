<script lang="ts">
  import { onMount } from 'svelte';
  import LinkGithubButton from './LinkGithubButton.svelte';
  import type { APIKey, RequestLog, PoolStats, CU } from './types';

  interface ProviderPool {
    provider: string;
    active_keys: number;
    observation_keys: number;
    quarantined_keys: number;
    u_pool_percent: number;
    w_provider: number;
    p90_latency_ms: number;
    eye_for_eye_accessible: boolean;
  }

  interface PoolTelemetryData {
    total_active_keys: number;
    keys_in_observation: number;
    keys_quarantined: number;
    pool_utilization_percent: number;
    provider_pools: ProviderPool[];
    snapshot_time: string;
  }

  interface ContributionData {
    total_keys: number;
    community_active_keys: number;
    requests_served_for_community_today: number;
    personal_requests_today: number;
    community_debt_cu: number;
    cu_contributed_24h: number;
    cu_borrowed_24h: number;
    net_cu: number;
  }

  interface Props {
    keys?: APIKey[];
    logs?: RequestLog[];
    stats?: PoolStats;
    cuUsedToday?: CU;
    isRefreshing?: boolean;
    autoRefresh?: boolean;
    proxyEndpoint?: string;
    isEndpointCopied?: boolean;
    communityPool?: boolean;
    onRefresh?: () => void;
    onToggleAutoRefresh?: () => void;
    onDeleteKey?: (id: string) => Promise<void>;
    onTestKey?: (id: string) => Promise<void>;
    onOpenAddModal?: () => void;
    onCopyEndpoint?: () => void;
    onNavigateDocs?: () => void;
  }

  let {
    communityPool = true,
    isRefreshing = false,
    onRefresh,
  }: Props = $props();

  let subTab = $state<'community' | 'provider' | 'contribution'>('community');
  let telemetry = $state<PoolTelemetryData>({
    total_active_keys: 0,
    keys_in_observation: 0,
    keys_quarantined: 0,
    pool_utilization_percent: 0,
    provider_pools: [],
    snapshot_time: '',
  });
  let contribution = $state<ContributionData>({
    total_keys: 0,
    community_active_keys: 0,
    requests_served_for_community_today: 0,
    personal_requests_today: 0,
    community_debt_cu: 0,
    cu_contributed_24h: 0,
    cu_borrowed_24h: 0,
    net_cu: 0,
  });
  let isLocked = $state(false);
  let loading = $state(false);

  async function loadPoolData() {
    if (!communityPool) {
      isLocked = true;
      return;
    }
    loading = true;
    try {
      const [telRes, contRes] = await Promise.all([
        fetch('/api/pool/telemetry', { credentials: 'same-origin' }),
        fetch('/api/pool/contribution', { credentials: 'same-origin' }),
      ]);
      if (telRes.status === 403 || contRes.status === 403) {
        isLocked = true;
        return;
      }
      isLocked = false;
      if (telRes.ok) {
        telemetry = await telRes.json();
      }
      if (contRes.ok) {
        contribution = await contRes.json();
      }
    } catch {
      // Non-blocking fallback
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void loadPoolData();
  });
</script>

<div class="space-y-6 font-mono" data-testid="pool-view">
  <!-- Header -->
  <div class="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/20">
    <div>
      <div class="flex items-center gap-2 mb-1">
        <span class="text-xs uppercase tracking-wider text-secondary">Reciprocal Commons</span>
        <span class="px-1.5 py-0.5 rounded text-[10px] bg-secondary/10 border border-secondary/30 text-secondary">
          Eye-for-an-Eye Pool
        </span>
      </div>
      <h1 class="text-headline-md text-on-surface font-semibold tracking-tight">
        Community Pool &amp; Provider Shards
      </h1>
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={() => { void loadPoolData(); onRefresh?.(); }}
        class="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-xs text-on-surface flex items-center gap-1.5 border border-outline-variant/30 cursor-pointer"
      >
        <span class="material-symbols-outlined text-[16px] {loading || isRefreshing ? 'animate-spin' : ''}">refresh</span>
        <span>Refresh Telemetry</span>
      </button>
    </div>
  </div>

  {#if !communityPool || isLocked}
    <!-- Locked CTA for Google-only users without GitHub linked (D-05) -->
    <div class="rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-center space-y-4 max-w-xl mx-auto my-8" data-testid="pool-locked-cta">
      <div class="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto text-amber-300">
        <span class="material-symbols-outlined text-[24px]">lock</span>
      </div>
      <h2 class="text-base font-bold text-on-surface">
        Link GitHub to Join the Community Pool
      </h2>
      <p class="text-xs text-outline leading-relaxed">
        To prevent Sybil abuse in the reciprocal commons, Community Pool participation requires a verified GitHub account (PRD D-05). You can still use Private Pool keys at any time.
      </p>
      <div class="pt-2 flex justify-center">
        <LinkGithubButton />
      </div>
    </div>
  {:else}
    <!-- Sub-Tabs: Community / Provider / My Contribution -->
    <div class="flex items-center gap-2 border-b border-outline-variant/20 pb-2" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={subTab === 'community'}
        onclick={() => (subTab = 'community')}
        class="px-3.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1.5 {subTab === 'community' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
      >
        <span class="material-symbols-outlined text-[16px]">groups</span>
        <span>Community</span>
      </button>

      <button
        type="button"
        role="tab"
        aria-selected={subTab === 'provider'}
        onclick={() => (subTab = 'provider')}
        class="px-3.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1.5 {subTab === 'provider' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
      >
        <span class="material-symbols-outlined text-[16px]">dns</span>
        <span>Provider</span>
      </button>

      <button
        type="button"
        role="tab"
        aria-selected={subTab === 'contribution'}
        onclick={() => (subTab = 'contribution')}
        class="px-3.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1.5 {subTab === 'contribution' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
      >
        <span class="material-symbols-outlined text-[16px]">volunteer_activism</span>
        <span>My Contribution</span>
      </button>
    </div>

    {#if subTab === 'community'}
      <!-- Community Sub-Tab -->
      <div class="space-y-4" data-testid="pool-subtab-community">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30">
            <span class="text-[10px] text-outline uppercase block">Active Community Keys</span>
            <span class="text-xl font-bold text-secondary mt-1 block">{telemetry.total_active_keys}</span>
          </div>

          <div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30">
            <span class="text-[10px] text-outline uppercase block">In 24h Observation</span>
            <span class="text-xl font-bold text-amber-300 mt-1 block">{telemetry.keys_in_observation}</span>
          </div>

          <div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30">
            <span class="text-[10px] text-outline uppercase block">Quarantined Keys</span>
            <span class="text-xl font-bold text-error mt-1 block">{telemetry.keys_quarantined}</span>
          </div>

          <div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30">
            <span class="text-[10px] text-outline uppercase block">Pool Utilization</span>
            <span class="text-xl font-bold text-primary mt-1 block">{telemetry.pool_utilization_percent}%</span>
          </div>
        </div>
      </div>
    {/if}

    {#if subTab === 'provider'}
      <!-- Provider Sub-Tab -->
      <div class="rounded-xl border border-outline-variant/30 overflow-hidden bg-surface-container-low/70" data-testid="pool-subtab-provider">
        <table class="w-full text-left text-xs">
          <thead class="bg-surface-container-highest/40 text-outline border-b border-outline-variant/20">
            <tr>
              <th class="py-2.5 px-3 font-medium">Provider</th>
              <th class="py-2.5 px-3 font-medium">Active Keys</th>
              <th class="py-2.5 px-3 font-medium">Observation</th>
              <th class="py-2.5 px-3 font-medium">Quarantined</th>
              <th class="py-2.5 px-3 font-medium">Utilization</th>
              <th class="py-2.5 px-3 font-medium">Scarcity Weight (w)</th>
              <th class="py-2.5 px-3 font-medium">p90 Latency</th>
              <th class="py-2.5 px-3 font-medium">Eye-for-Eye Access</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-outline-variant/10">
            {#if telemetry.provider_pools.length === 0}
              <tr>
                <td colspan="8" class="py-8 text-center text-outline">No provider pool shards reported.</td>
              </tr>
            {:else}
              {#each telemetry.provider_pools as p (p.provider)}
                <tr class="hover:bg-surface-container-highest/30">
                  <td class="py-2.5 px-3 font-semibold uppercase text-on-surface">{p.provider}</td>
                  <td class="py-2.5 px-3 text-secondary font-semibold">{p.active_keys}</td>
                  <td class="py-2.5 px-3 text-amber-300">{p.observation_keys}</td>
                  <td class="py-2.5 px-3 text-error">{p.quarantined_keys}</td>
                  <td class="py-2.5 px-3 text-on-surface">{p.u_pool_percent}%</td>
                  <td class="py-2.5 px-3 text-primary">{p.w_provider}x</td>
                  <td class="py-2.5 px-3 text-outline">{p.p90_latency_ms} ms</td>
                  <td class="py-2.5 px-3">
                    {#if p.eye_for_eye_accessible}
                      <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-secondary/15 text-secondary border border-secondary/30">
                        UNLOCKED
                      </span>
                    {:else}
                      <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-container-highest text-outline">
                        LOCKED
                      </span>
                    {/if}
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    {/if}

    {#if subTab === 'contribution'}
      <!-- My Contribution Sub-Tab -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="pool-subtab-contribution">
        <div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30">
          <span class="text-[10px] text-outline uppercase block">Active Community Keys</span>
          <span class="text-xl font-bold text-secondary mt-1 block">
            {contribution.community_active_keys} / {contribution.total_keys}
          </span>
        </div>

        <div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30">
          <span class="text-[10px] text-outline uppercase block">Requests Served for Community</span>
          <span class="text-xl font-bold text-primary mt-1 block">
            {contribution.requests_served_for_community_today.toLocaleString()}
          </span>
        </div>

        <div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30">
          <span class="text-[10px] text-outline uppercase block">Personal Requests Today</span>
          <span class="text-xl font-bold text-on-surface mt-1 block">
            {contribution.personal_requests_today.toLocaleString()}
          </span>
        </div>

        <div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30">
          <span class="text-[10px] text-outline uppercase block">24h CU Contributed</span>
          <span class="text-xl font-bold text-secondary mt-1 block">
            {contribution.cu_contributed_24h.toLocaleString()} CU
          </span>
        </div>

        <div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30">
          <span class="text-[10px] text-outline uppercase block">Current Communal Debt</span>
          <span class="text-xl font-bold {contribution.community_debt_cu > 0 ? 'text-amber-300' : 'text-on-surface'} mt-1 block">
            {contribution.community_debt_cu.toLocaleString()} CU
          </span>
        </div>

        <div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30">
          <span class="text-[10px] text-outline uppercase block">Net Reciprocal Balance</span>
          <span class="text-xl font-bold {contribution.net_cu >= 0 ? 'text-secondary' : 'text-error'} mt-1 block">
            {contribution.net_cu >= 0 ? '+' : ''}{contribution.net_cu.toLocaleString()} CU
          </span>
        </div>
      </div>
    {/if}
  {/if}
</div>
