<script lang="ts">
  import type { TenantKeySurveillanceItem } from '../../../../src/contracts/v3_5_types';

  let {
    keys = [],
    onUpdateRoutingStatus,
    onUpdatePoolMode,
    onDeleteKey,
  }: {
    keys?: TenantKeySurveillanceItem[];
    onUpdateRoutingStatus?: (keyId: string, status: 'ACTIVE' | 'QUARANTINED' | 'OBSERVATION') => void;
    onUpdatePoolMode?: (keyId: string, poolType: 'COMMUNITY' | 'PRIVATE') => void;
    onDeleteKey?: (keyId: string) => void;
  } = $props();

  let searchQuery = $state('');
  let providerFilter = $state<string>('all');
  let statusFilter = $state<string>('all');

  let filteredKeys = $derived.by(() => {
    return keys.filter((k) => {
      if (providerFilter !== 'all' && k.provider !== providerFilter) return false;
      if (statusFilter !== 'all' && k.community_routing_status !== statusFilter) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        return (
          k.id.toLowerCase().includes(q) ||
          k.label.toLowerCase().includes(q) ||
          k.provider.toLowerCase().includes(q) ||
          (k.tenant_id && k.tenant_id.toLowerCase().includes(q))
        );
      }
      return true;
    });
  });
</script>

<div class="space-y-4" data-testid="admin-keys-view">
  <!-- Controls & Search -->
  <div class="flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs">
    <div class="relative w-full sm:w-72">
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Filter keys..."
        class="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-container-highest/60 border border-outline-variant/30 text-on-surface focus:outline-none focus:border-primary text-xs"
      />
      <span class="material-symbols-outlined absolute left-2.5 top-2 text-[14px] text-outline">search</span>
    </div>

    <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
      <select
        bind:value={providerFilter}
        class="px-2.5 py-1.5 rounded-lg bg-surface-container-highest/60 border border-outline-variant/30 text-on-surface text-xs"
      >
        <option value="all">All Providers</option>
        <option value="gemini">Gemini</option>
        <option value="groq">Groq</option>
        <option value="cerebras">Cerebras</option>
        <option value="deepseek">DeepSeek</option>
      </select>

      <select
        bind:value={statusFilter}
        class="px-2.5 py-1.5 rounded-lg bg-surface-container-highest/60 border border-outline-variant/30 text-on-surface text-xs"
      >
        <option value="all">All Routing Statuses</option>
        <option value="ACTIVE">ACTIVE</option>
        <option value="OBSERVATION">OBSERVATION</option>
        <option value="QUARANTINED">QUARANTINED</option>
      </select>
    </div>
  </div>

  <!-- Keys Table -->
  <div class="rounded-xl border border-outline-variant/30 overflow-hidden bg-surface-container-low/70">
    <table class="w-full text-left font-mono text-xs">
      <thead class="bg-surface-container-highest/40 text-outline border-b border-outline-variant/20">
        <tr>
          <th class="py-2.5 px-3 font-medium">Key ID / Prefix</th>
          <th class="py-2.5 px-3 font-medium">Owner</th>
          <th class="py-2.5 px-3 font-medium">Provider</th>
          <th class="py-2.5 px-3 font-medium">Routing Status</th>
          <th class="py-2.5 px-3 font-medium">Pool Mode</th>
          <th class="py-2.5 px-3 font-medium">Limits</th>
          <th class="py-2.5 px-3 font-medium">Dispatches</th>
          <th class="py-2.5 px-3 font-medium text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/10">
        {#if filteredKeys.length === 0}
          <tr>
            <td colspan="8" class="py-8 text-center text-outline">
              No keys matching current filters.
            </td>
          </tr>
        {:else}
          {#each filteredKeys as k (k.id)}
            <tr class="hover:bg-surface-container-highest/30 transition-colors">
              <td class="py-2.5 px-3">
                <div class="font-semibold text-on-surface">{k.label || k.id}</div>
                <div class="text-[10px] text-outline">{k.key_prefix}...{k.key_suffix}</div>
              </td>
              <td class="py-2.5 px-3 text-outline truncate max-w-[120px]">{k.tenant_id || '—'}</td>
              <td class="py-2.5 px-3">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase {k.provider === 'gemini' ? 'bg-primary/15 text-primary' : 'bg-tertiary/15 text-tertiary'}">
                  {k.provider}
                </span>
              </td>
              <td class="py-2.5 px-3">
                {#if k.community_routing_status === 'ACTIVE'}
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-secondary/15 text-secondary border border-secondary/30">
                    ACTIVE
                  </span>
                {:else if k.community_routing_status === 'OBSERVATION'}
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-400/15 text-amber-300 border border-amber-400/30">
                    OBSERVATION
                  </span>
                {:else}
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-error/15 text-error border border-error/30">
                    QUARANTINED
                  </span>
                {/if}
              </td>
              <td class="py-2.5 px-3 text-on-surface">
                <button
                  type="button"
                  onclick={() => onUpdatePoolMode?.(k.id, k.pool_type === 'COMMUNITY' ? 'PRIVATE' : 'COMMUNITY')}
                  class="cursor-pointer hover:underline text-[10px] font-semibold"
                >
                  {k.pool_type}
                </button>
              </td>
              <td class="py-2.5 px-3 text-outline">{k.rpm_limit ?? '—'} RPM / {k.rpd_limit ?? '—'} RPD</td>
              <td class="py-2.5 px-3 text-on-surface">{k.dispatched_today ?? 0} today</td>
              <td class="py-2.5 px-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  {#if k.community_routing_status !== 'ACTIVE'}
                    <button
                      type="button"
                      onclick={() => onUpdateRoutingStatus?.(k.id, 'ACTIVE')}
                      class="px-2 py-0.5 rounded bg-secondary/15 hover:bg-secondary/25 text-secondary text-[10px] font-semibold cursor-pointer"
                      title="Activate Key"
                    >
                      Activate
                    </button>
                  {/if}
                  {#if k.community_routing_status !== 'QUARANTINED'}
                    <button
                      type="button"
                      onclick={() => onUpdateRoutingStatus?.(k.id, 'QUARANTINED')}
                      class="px-2 py-0.5 rounded bg-error/15 hover:bg-error/25 text-error text-[10px] font-semibold cursor-pointer"
                      title="Quarantine Key"
                    >
                      Quarantine
                    </button>
                  {/if}
                  <button
                    type="button"
                    onclick={() => onDeleteKey?.(k.id)}
                    class="p-1 rounded hover:bg-surface-container-highest text-outline hover:text-error cursor-pointer"
                    title="Delete Key"
                  >
                    <span class="material-symbols-outlined text-[14px]">delete</span>
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>
