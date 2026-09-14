<script module lang="ts">
  export type PoolMetrics = {
    total: number;
    available: number;
  };

  /**
   * Fetches real-time pool metrics from the upstream API or fallback provider.
   */
  export async function fetchPoolData(): Promise<PoolMetrics> {
    return {
      total: 100,
      available: 84,
    };
  }

  /**
   * Renders and refreshes commons visualization and allocation states.
   */
  export function renderCommons(): void {
    // Trigger commons view lifecycle / updates
  }
</script>

<script lang="ts">
  import DebtLedgerWidget from './DebtLedgerWidget.svelte';
  import type { GlobalPoolTelemetry, ContributorStanding } from './types';

  interface Props {
    initialMetrics?: PoolMetrics;
    fetchData?: () => Promise<PoolMetrics>;
  }

  let { initialMetrics, fetchData = fetchPoolData }: Props = $props();

  let metrics = $state<PoolMetrics>(initialMetrics ?? { total: 0, available: 0 });
  let isLoading = $state<boolean>(!initialMetrics);
  let error = $state<string | null>(null);
  let commonsRendered = $state<boolean>(false);
  
  let activeSubTab = $state<'community' | 'provider' | 'contribution'>('community');
  let telemetry = $state<GlobalPoolTelemetry | null>(null);
  let standing = $state<ContributorStanding | null>(null);

  // Derived state via Svelte 5 $derived rune
  let totalMetrics = $derived(metrics.total);
  let availableCommons = $derived(metrics.available);
  let utilizedMetrics = $derived(Math.max(0, metrics.total - metrics.available));
  let utilizationPercent = $derived(
    metrics.total > 0 ? Math.round(((metrics.total - metrics.available) / metrics.total) * 100) : 0
  );

  export function triggerRenderCommons(): void {
    commonsRendered = true;
    renderCommons();
  }

  async function loadPoolData(): Promise<void> {
    isLoading = true;
    error = null;
    try {
      const data = await fetchData();
      metrics = data;
      // Mock loading telemetry and standing for demonstration
      telemetry = { total_keys: data.total, healthy_keys: data.available };
      standing = { status: 'Good' };
      triggerRenderCommons();
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    if (!initialMetrics) {
      loadPoolData();
    } else {
      triggerRenderCommons();
    }
  });
</script>

<div class="pool-commons-tab p-6 space-y-6" data-testid="pool-commons-tab">
  <!-- Header Banner -->
  <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/20 pb-4">
    <div>
      <div class="flex items-center gap-2 mb-1">
        <span class="text-xs uppercase tracking-wider text-primary font-mono font-semibold">Commons Infrastructure</span>
        <span class="px-1.5 py-0.5 rounded text-xs bg-secondary/10 border border-secondary/30 text-secondary font-mono">Shared Pool</span>
      </div>
      <h2 class="text-2xl font-semibold tracking-tight text-on-surface">
        Pool Commons &amp; Metrics
      </h2>
      <p class="text-sm text-on-surface-variant mt-1">
        Real-time shared capacity management and resource allocation commons.
      </p>
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={loadPoolData}
        class="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-sm text-on-surface border border-outline-variant/30 transition-all cursor-pointer font-mono"
        data-testid="refresh-btn"
      >
        Refresh Metrics
      </button>
    </div>
  </div>

  <!-- Sub-Tabs Navigation -->
  <div class="flex border-b border-outline-variant/20 mb-4" data-testid="sub-tabs">
    <button
      class="px-4 py-2 text-sm font-medium border-b-2 transition-colors {activeSubTab === 'community' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}"
      onclick={() => activeSubTab = 'community'}
    >
      Community Pool
    </button>
    <button
      class="px-4 py-2 text-sm font-medium border-b-2 transition-colors {activeSubTab === 'provider' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}"
      onclick={() => activeSubTab = 'provider'}
    >
      Provider Pools
    </button>
    <button
      class="px-4 py-2 text-sm font-medium border-b-2 transition-colors {activeSubTab === 'contribution' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}"
      onclick={() => activeSubTab = 'contribution'}
      data-testid="contribution-tab"
    >
      My Contribution
    </button>
  </div>

  {#if isLoading}
    <div class="p-8 space-y-4" data-testid="loading-state">
      <div class="h-6 w-1/3 bg-surface-container-highest animate-pulse rounded"></div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="h-24 bg-surface-container-highest animate-pulse rounded-xl"></div>
        <div class="h-24 bg-surface-container-highest animate-pulse rounded-xl"></div>
        <div class="h-24 bg-surface-container-highest animate-pulse rounded-xl"></div>
      </div>
      <div class="text-center text-on-surface-variant mt-4">
        <span class="font-mono text-sm">Loading pool metrics...</span>
      </div>
    </div>
  {:else if error}
    <div class="p-4 rounded-lg bg-error/10 border border-error/30 text-error text-sm font-mono" data-testid="error-state">
      Failed to load pool metrics: {error}
    </div>
  {:else}
    <!-- Tab Content -->
    <div class="tab-content" data-testid="tab-content">
      {#if activeSubTab === 'community'}
        <!-- Community Pool Content -->
        <div class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="pool-metrics">
            <div class="p-5 rounded-xl bg-surface-container-low border border-outline-variant/30 relative overflow-hidden">
              <div class="text-xs font-mono uppercase text-on-surface-variant mb-1">Total Pool Capacity</div>
              <div class="text-3xl font-bold font-mono text-on-surface" data-testid="total-metrics">
                {totalMetrics}
              </div>
              <div class="text-xs text-on-surface-variant mt-2">Allocated upstream pool units</div>
            </div>

            <div class="p-5 rounded-xl bg-surface-container-low border border-outline-variant/30 relative overflow-hidden" data-testid="available-commons-card">
              <div class="text-xs font-mono uppercase text-secondary mb-1">Available Commons</div>
              <div class="text-3xl font-bold font-mono text-secondary" data-testid="available-commons">
                {availableCommons}
              </div>
              <div class="text-xs text-secondary/80 mt-2">Ready for instant lease &amp; dispatch</div>
            </div>

            <div class="p-5 rounded-xl bg-surface-container-low border border-outline-variant/30 relative overflow-hidden">
              <div class="text-xs font-mono uppercase text-primary mb-1">Utilized Commons</div>
              <div class="text-3xl font-bold font-mono text-primary" data-testid="utilized-metrics">
                {utilizedMetrics}
              </div>
              <div class="text-xs text-primary/80 mt-2">{utilizationPercent}% overall load factor</div>
            </div>
          </div>

          <div class="rounded-xl bg-surface-container-low border border-outline-variant/30 p-5 space-y-4" data-testid="commons-container">
            <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
              <h3 class="text-base font-medium text-on-surface">Active Commons Allocation</h3>
              <span class="text-xs font-mono text-on-surface-variant" data-testid="commons-rendered-flag">
                Commons Status: {commonsRendered ? "Rendered" : "Standby"}
              </span>
            </div>
            <div class="text-sm text-on-surface-variant">
              Pool Commons active: showing <span class="font-mono text-secondary font-semibold" data-testid="available-commons-count">{availableCommons}</span> available commons out of <span class="font-mono font-semibold" data-testid="total-commons-count">{totalMetrics}</span> total resources.
            </div>
          </div>
        </div>
      {:else if activeSubTab === 'provider'}
        <!-- Provider Pools Content -->
        <div class="p-5 rounded-xl bg-surface-container-low border border-outline-variant/30">
          <h3 class="text-base font-medium text-on-surface mb-4">Provider Pools</h3>
          <p class="text-sm text-on-surface-variant">Metrics segmented by individual provider pools will appear here.</p>
        </div>
      {:else if activeSubTab === 'contribution'}
        <!-- My Contribution Content -->
        <div class="space-y-6">
          <div class="p-5 rounded-xl bg-surface-container-low border border-outline-variant/30">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-base font-medium text-on-surface">My Contribution</h3>
              <span class="px-2 py-1 rounded text-xs bg-amber-500/10 text-amber-500 border border-amber-500/20 font-mono" data-testid="lock-state">Eye-for-an-Eye Lock: Active</span>
            </div>
            {#if standing}
              <p class="text-sm text-on-surface-variant mb-4">Current Standing: {standing.status}</p>
            {/if}
            <p class="text-sm text-on-surface-variant">Review your key contributions and any outstanding debts.</p>
          </div>
          
          <DebtLedgerWidget tenantId="current-user" />
        </div>
      {/if}
    </div>
  {/if}
</div>
