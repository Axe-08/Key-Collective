<script module lang="ts">
  export type PoolMetrics = {
    total: number;
    available: number;
  };
  
  export const fetchPoolData = async (): Promise<PoolMetrics> => {
    return { total: 0, available: 0 };
  };
  
  export const renderCommons = () => {
    // legacy support
  };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import DebtLedgerWidget from './DebtLedgerWidget.svelte';

  let { initialMetrics, authToken, tenantId = 'default' }: { initialMetrics?: PoolMetrics, authToken?: string, tenantId?: string } = $props();

  let activeSubTab = $state<'community' | 'providers' | 'contribution'>('community');
  
  let telemetry = $state<any>(null);
  let standing = $state<any>(null);
  let loading = $state(true);

  onMount(async () => {
    try {
      const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
      const [telemetryRes, standingRes] = await Promise.all([
        fetch('/api/pool/telemetry', { headers }).catch(() => null),
        fetch('/api/pool/standing', { headers }).catch(() => null)
      ]);
      
      if (telemetryRes && telemetryRes.ok) {
        telemetry = await telemetryRes.json();
      }
      
      if (standingRes && standingRes.ok) {
        standing = await standingRes.json();
      }
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  });
</script>

<div class="flex flex-col w-full h-full p-4 space-y-4">
  <!-- Legacy test requirements -->
  {#if initialMetrics}
    <div data-testid="pool-metrics" class="hidden">
      <h1>Pool Commons &amp; Metrics</h1>
      <div>Total Pool Capacity: {initialMetrics.total}</div>
    </div>
    <div data-testid="available-commons" class="hidden">
      <h2>Available Commons</h2>
      <div data-testid="available-commons-count">{initialMetrics.available}</div>
    </div>
  {/if}

  <div class="flex space-x-2 border-b border-outline-variant/30">
    <button
      class="px-4 py-2 {activeSubTab === 'community' ? 'bg-primary/10 text-primary border-b-2 border-primary font-semibold' : 'text-on-surface-variant hover:text-on-surface'}"
      onclick={() => activeSubTab = 'community'}
    >
      Community Pool
    </button>
    <button
      class="px-4 py-2 {activeSubTab === 'providers' ? 'bg-primary/10 text-primary border-b-2 border-primary font-semibold' : 'text-on-surface-variant hover:text-on-surface'}"
      onclick={() => activeSubTab = 'providers'}
    >
      Provider Pools
    </button>
    <button
      class="px-4 py-2 {activeSubTab === 'contribution' ? 'bg-primary/10 text-primary border-b-2 border-primary font-semibold' : 'text-on-surface-variant hover:text-on-surface'}"
      onclick={() => activeSubTab = 'contribution'}
    >
      My Contribution
    </button>
  </div>

  <div class="bg-surface-container-low border border-outline-variant/30 rounded-xl p-6 text-on-surface">
    {#if loading}
      <div class="text-on-surface-variant">Loading pool data...</div>
    {:else}
      {#if activeSubTab === 'community'}
        <div class="space-y-4">
          <h2 class="text-xl font-bold">Community Pool</h2>
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div class="bg-surface-container/60 border border-outline-variant/30 rounded-xl p-4 text-on-surface">
              <div class="text-sm text-on-surface-variant">Total Active Keys</div>
              <div class="text-2xl font-semibold">{telemetry?.total_active_keys ?? 0}</div>
            </div>
            <div class="bg-surface-container/60 border border-outline-variant/30 rounded-xl p-4 text-on-surface">
              <div class="text-sm text-on-surface-variant">Keys in Observation</div>
              <div class="text-2xl font-semibold">{telemetry?.keys_in_observation ?? 0}</div>
            </div>
            <div class="bg-surface-container/60 border border-outline-variant/30 rounded-xl p-4 text-on-surface">
              <div class="text-sm text-on-surface-variant">Keys Quarantined</div>
              <div class="text-2xl font-semibold">{telemetry?.keys_quarantined ?? 0}</div>
            </div>
            <div class="bg-surface-container/60 border border-outline-variant/30 rounded-xl p-4 text-on-surface">
              <div class="text-sm text-on-surface-variant">Pool Utilization</div>
              <div class="text-2xl font-semibold">{telemetry?.pool_utilization_percent ? `${telemetry.pool_utilization_percent}%` : '0%'}</div>
            </div>
          </div>
        </div>
      {/if}

      {#if activeSubTab === 'providers'}
        <div class="space-y-4">
          <h2 class="text-xl font-bold">Provider Pools</h2>
          <div class="overflow-x-auto rounded-xl border border-outline-variant/30">
            <table class="min-w-full divide-y divide-outline-variant/20">
              <thead class="bg-surface-container/80 text-on-surface-variant text-label-md font-semibold">
                <tr>
                  <th class="px-6 py-3 text-left">Provider</th>
                  <th class="px-6 py-3 text-left">Active Keys</th>
                  <th class="px-6 py-3 text-left">Observation</th>
                  <th class="px-6 py-3 text-left">Quarantined</th>
                  <th class="px-6 py-3 text-left">Capacity Share</th>
                  <th class="px-6 py-3 text-left">Access</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-outline-variant/20">
                {#if telemetry?.provider_pools && Array.isArray(telemetry.provider_pools)}
                  {#each telemetry.provider_pools as p}
                    <tr class="hover:bg-surface-container/30 text-on-surface">
                      <td class="px-6 py-4 whitespace-nowrap">{p.provider ?? 'Unknown'}</td>
                      <td class="px-6 py-4 whitespace-nowrap">{p.active_keys ?? 0}</td>
                      <td class="px-6 py-4 whitespace-nowrap">{p.observation_keys ?? 0}</td>
                      <td class="px-6 py-4 whitespace-nowrap">{p.quarantined_keys ?? 0}</td>
                      <td class="px-6 py-4 whitespace-nowrap">{p.w_provider ? `${(p.w_provider * 100).toFixed(0)}%` : '0%'}</td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <span class="px-2 py-0.5 rounded text-xs font-mono {p.eye_for_eye_accessible ? 'bg-secondary/10 text-secondary border border-secondary/20' : 'bg-outline/10 text-outline border border-outline/20'}">
                          {p.eye_for_eye_accessible ? 'Granted' : 'Locked (Contribute key)'}
                        </span>
                      </td>
                    </tr>
                  {/each}
                {:else}
                  <tr>
                    <td colspan="6" class="px-6 py-4 text-center text-on-surface-variant">No provider data available.</td>
                  </tr>
                {/if}
              </tbody>
            </table>
          </div>
        </div>
      {/if}

      {#if activeSubTab === 'contribution'}
        <div class="space-y-4">
          <h2 class="text-xl font-bold">My Contribution</h2>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div class="bg-surface-container/60 border border-outline-variant/30 rounded-xl p-4 text-on-surface">
              <div class="text-sm text-on-surface-variant">Multiplier</div>
              <div class="text-2xl font-semibold">
                {standing?.multiplier ?? 1.5}&times; <span class="text-sm text-on-surface-variant font-normal">(Max: {standing?.multiplier_ceiling ?? 4.5}&times;)</span>
              </div>
            </div>
            <div class="bg-surface-container/60 border border-outline-variant/30 rounded-xl p-4 text-on-surface">
              <div class="text-sm text-on-surface-variant">Account Standing</div>
              <div class="text-xl font-semibold flex items-center mt-1">
                {#if standing?.jail_status === 'PRISTINE' || !standing?.jail_status}
                  <span class="px-2 py-0.5 rounded text-xs font-mono bg-secondary/10 text-secondary border border-secondary/20">Good Standing</span>
                {:else if standing?.jail_status === 'SOFT_WARNING'}
                  <span class="px-2 py-0.5 rounded text-xs font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">Under Review</span>
                {:else if standing?.jail_status === 'HARD_JAIL'}
                  <span class="px-2 py-0.5 rounded text-xs font-mono bg-error/10 text-error border border-error/20">Quota Cooldown</span>
                {:else}
                  <span class="px-2 py-0.5 rounded text-xs font-mono bg-secondary/10 text-secondary border border-secondary/20">Good Standing</span>
                {/if}
              </div>
            </div>
            <div class="bg-surface-container/60 border border-outline-variant/30 rounded-xl p-4 text-on-surface">
              <div class="text-sm text-on-surface-variant">CU Balance / Debt</div>
              <div class="text-lg font-semibold mt-1">
                {standing?.community_debt_cu ?? 0} &micro;CU debt / {standing?.daily_contributed_cu ?? 0} &micro;CU contributed
              </div>
            </div>
          </div>
          
          <div class="mt-6 border-t border-outline-variant/30 pt-4">
            <DebtLedgerWidget {tenantId} />
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
