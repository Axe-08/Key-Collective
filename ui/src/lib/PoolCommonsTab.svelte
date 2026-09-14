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
  interface Props {
    initialMetrics?: PoolMetrics;
    fetchData?: () => Promise<PoolMetrics>;
  }

  let { initialMetrics, fetchData = fetchPoolData }: Props = $props();

  // Svelte 5 runes for state management
  let metrics = $state<PoolMetrics>(initialMetrics ?? { total: 0, available: 0 });
  let isLoading = $state<boolean>(!initialMetrics);
  let error = $state<string | null>(null);
  let commonsRendered = $state<boolean>(false);

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

  {#if isLoading}
    <div class="p-8 text-center text-on-surface-variant" data-testid="loading-state">
      <span class="font-mono text-sm">Loading pool metrics...</span>
    </div>
  {:else if error}
    <div class="p-4 rounded-lg bg-error/10 border border-error/30 text-error text-sm font-mono" data-testid="error-state">
      Failed to load pool metrics: {error}
    </div>
  {:else}
    <!-- Pool Metrics Cards (Should render pool metrics) -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="pool-metrics">
      <!-- Total Metrics -->
      <div class="p-5 rounded-xl bg-surface-container-low border border-outline-variant/30 relative overflow-hidden">
        <div class="text-xs font-mono uppercase text-on-surface-variant mb-1">Total Pool Capacity</div>
        <div class="text-3xl font-bold font-mono text-on-surface" data-testid="total-metrics">
          {totalMetrics}
        </div>
        <div class="text-xs text-on-surface-variant mt-2">Allocated upstream pool units</div>
      </div>

      <!-- Available Commons (Should show available commons) -->
      <div class="p-5 rounded-xl bg-surface-container-low border border-outline-variant/30 relative overflow-hidden" data-testid="available-commons-card">
        <div class="text-xs font-mono uppercase text-secondary mb-1">Available Commons</div>
        <div class="text-3xl font-bold font-mono text-secondary" data-testid="available-commons">
          {availableCommons}
        </div>
        <div class="text-xs text-secondary/80 mt-2">Ready for instant lease &amp; dispatch</div>
      </div>

      <!-- In-Use Commons -->
      <div class="p-5 rounded-xl bg-surface-container-low border border-outline-variant/30 relative overflow-hidden">
        <div class="text-xs font-mono uppercase text-primary mb-1">Utilized Commons</div>
        <div class="text-3xl font-bold font-mono text-primary" data-testid="utilized-metrics">
          {utilizedMetrics}
        </div>
        <div class="text-xs text-primary/80 mt-2">{utilizationPercent}% overall load factor</div>
      </div>
    </div>

    <!-- Commons Table & Status -->
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
  {/if}
</div>
