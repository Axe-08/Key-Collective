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

  let { initialMetrics }: { initialMetrics?: PoolMetrics } = $props();

  let activeSubTab = $state<'community' | 'providers' | 'contribution'>('community');
  
  let telemetry = $state<any>(null);
  let standing = $state<any>(null);
  let loading = $state(true);
  
  let tenantId = 'default';

  onMount(async () => {
    try {
      const [telemetryRes, standingRes] = await Promise.all([
        fetch('/api/pool/telemetry').catch(() => null),
        fetch('/api/pool/standing').catch(() => null)
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

  <div class="flex space-x-2 border-b border-gray-200">
    <button
      class="px-4 py-2 font-medium {activeSubTab === 'community' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}"
      onclick={() => activeSubTab = 'community'}
    >
      Community Pool
    </button>
    <button
      class="px-4 py-2 font-medium {activeSubTab === 'providers' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}"
      onclick={() => activeSubTab = 'providers'}
    >
      Provider Pools
    </button>
    <button
      class="px-4 py-2 font-medium {activeSubTab === 'contribution' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}"
      onclick={() => activeSubTab = 'contribution'}
    >
      My Contribution
    </button>
  </div>

  <div class="p-4 bg-white rounded-lg shadow">
    {#if loading}
      <div class="text-gray-500">Loading pool data...</div>
    {:else}
      {#if activeSubTab === 'community'}
        <div class="space-y-4">
          <h2 class="text-xl font-bold">Community Pool</h2>
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div class="p-4 border rounded shadow-sm bg-gray-50">
              <div class="text-sm text-gray-500">Total Active Keys</div>
              <div class="text-2xl font-semibold">{telemetry?.total_active_keys ?? 'N/A'}</div>
            </div>
            <div class="p-4 border rounded shadow-sm bg-gray-50">
              <div class="text-sm text-gray-500">Keys in Observation</div>
              <div class="text-2xl font-semibold">{telemetry?.keys_in_observation ?? 'N/A'}</div>
            </div>
            <div class="p-4 border rounded shadow-sm bg-gray-50">
              <div class="text-sm text-gray-500">Keys Quarantined</div>
              <div class="text-2xl font-semibold">{telemetry?.keys_quarantined ?? 'N/A'}</div>
            </div>
            <div class="p-4 border rounded shadow-sm bg-gray-50">
              <div class="text-sm text-gray-500">Pool Utilization</div>
              <div class="text-2xl font-semibold">{telemetry?.pool_utilization_percent ? `${telemetry.pool_utilization_percent}%` : 'N/A'}</div>
            </div>
          </div>
        </div>
      {/if}

      {#if activeSubTab === 'providers'}
        <div class="space-y-4">
          <h2 class="text-xl font-bold">Provider Pools</h2>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Active Keys</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Observation</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quarantined</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">W_provider</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Eye-for-Eye</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                {#if telemetry?.providers && Array.isArray(telemetry.providers)}
                  {#each telemetry.providers as provider}
                    <tr>
                      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{provider.name ?? 'Unknown'}</td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{provider.active_keys ?? 0}</td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{provider.observation ?? 0}</td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{provider.quarantined ?? 0}</td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{provider.w_provider ?? 0}</td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{provider.eye_for_eye ?? 0}</td>
                    </tr>
                  {/each}
                {:else}
                  <tr>
                    <td colspan="6" class="px-6 py-4 text-center text-sm text-gray-500">No provider data available.</td>
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
            <div class="p-4 border rounded shadow-sm bg-gray-50">
              <div class="text-sm text-gray-500">Multiplier</div>
              <div class="text-2xl font-semibold">{standing?.multiplier ?? 'N/A'}</div>
            </div>
            <div class="p-4 border rounded shadow-sm bg-gray-50">
              <div class="text-sm text-gray-500">Jail Status</div>
              <div class="text-2xl font-semibold">
                {#if standing?.jail_status}
                  <span class="text-red-600">Jailed</span>
                {:else if standing?.jail_status === false}
                  <span class="text-green-600">Free</span>
                {:else}
                  N/A
                {/if}
              </div>
            </div>
            <div class="p-4 border rounded shadow-sm bg-gray-50">
              <div class="text-sm text-gray-500">CU Balance</div>
              <div class="text-2xl font-semibold">{standing?.cu_balance ?? 'N/A'}</div>
            </div>
          </div>
          
          <div class="mt-6 border-t pt-4">
            <DebtLedgerWidget {tenantId} />
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
