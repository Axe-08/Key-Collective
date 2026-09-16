<script lang="ts">
  import type { APIKey } from '../types';

  interface Props {
    providerKeys: APIKey[];
    providerKeysLoading: boolean;
    onRotate: (id: string) => void;
    onOpenSwitchPool: (key: APIKey) => void;
    onDelete: (id: string) => void;
  }

  let {
    providerKeys,
    providerKeysLoading,
    onRotate,
    onOpenSwitchPool,
    onDelete,
  }: Props = $props();

  const privateProviderKeys = $derived(providerKeys.filter((k) => !k.pool_type || k.pool_type.toUpperCase() === 'PRIVATE'));
  const communityProviderKeys = $derived(providerKeys.filter((k) => k.pool_type && k.pool_type.toUpperCase() === 'COMMUNITY'));
</script>

<section class="space-y-4">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    <div>
      <h2 class="font-headline-md text-headline-md font-semibold text-on-surface">
        My Provider Keys
      </h2>
      <p class="font-body-sm text-body-sm text-outline">
        Manage keys you have provided to the Community or Private pools.
      </p>
    </div>
  </div>
  
  <div class="rounded-xl border border-outline-variant/30 bg-surface-container-low overflow-hidden flex flex-col p-4 max-h-[300px] overflow-y-auto">
    {#if providerKeysLoading}
      <div class="p-6 text-center text-outline">Loading provider keys...</div>
    {:else}
      <h3 class="text-label-md font-label-md text-on-surface font-semibold mb-2">My Private Provider Keys</h3>
      {#if privateProviderKeys.length === 0}
        <div class="p-4 text-center text-outline text-sm italic border rounded-lg border-outline-variant/20 mb-4">No private provider keys found.</div>
      {:else}
        <div class="overflow-x-auto border border-outline-variant/20 rounded-lg mb-6">
          <table class="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr class="border-b border-outline-variant/30 bg-surface-container/50">
                <th class="p-3 font-label-md text-label-md font-semibold text-on-surface-variant">Provider</th>
                <th class="p-3 font-label-md text-label-md font-semibold text-on-surface-variant">Label</th>
                <th class="p-3 font-label-md text-label-md font-semibold text-on-surface-variant">Key Prefix</th>
                <th class="p-3 font-label-md text-label-md font-semibold text-on-surface-variant">Status</th>
                <th class="p-3 font-label-md text-label-md font-semibold text-on-surface-variant">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each privateProviderKeys as k}
                <tr class="border-b border-outline-variant/10 hover:bg-surface-container/30 transition-colors">
                  <td class="p-3 font-body-sm text-body-sm text-on-surface capitalize">{k.provider}</td>
                  <td class="p-3 font-body-sm text-body-sm text-on-surface">{k.label}</td>
                  <td class="p-3 font-code-sm text-code-sm text-outline font-mono">{k.key_prefix}...</td>
                  <td class="p-3">
                    <span class="px-2 py-1 rounded text-[11px] font-mono font-medium border bg-secondary/10 text-secondary border-secondary/20">
                      {k.status}
                    </span>
                  </td>
                  <td class="p-3 flex items-center gap-2">
                    <button class="text-xs text-primary hover:underline cursor-pointer" onclick={() => onRotate(k.id)}>Rotate</button>
                    <button class="text-xs text-outline hover:underline cursor-pointer" onclick={() => onOpenSwitchPool(k)}>Switch to Community</button>
                    <button class="text-xs text-error hover:underline cursor-pointer" onclick={() => onDelete(k.id)}>Delete</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <h3 class="text-label-md font-label-md text-on-surface font-semibold mb-2">My Contributed Community Keys</h3>
      {#if communityProviderKeys.length === 0}
        <div class="p-4 text-center text-outline text-sm italic border rounded-lg border-outline-variant/20 mb-4">No community provider keys found.</div>
      {:else}
        <div class="overflow-x-auto border border-outline-variant/20 rounded-lg mb-2">
          <table class="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr class="border-b border-outline-variant/30 bg-surface-container/50">
                <th class="p-3 font-label-md text-label-md font-semibold text-on-surface-variant">Provider</th>
                <th class="p-3 font-label-md text-label-md font-semibold text-on-surface-variant">Label</th>
                <th class="p-3 font-label-md text-label-md font-semibold text-on-surface-variant">Key Prefix</th>
                <th class="p-3 font-label-md text-label-md font-semibold text-on-surface-variant">Routing Status</th>
                <th class="p-3 font-label-md text-label-md font-semibold text-on-surface-variant">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each communityProviderKeys as k}
                <tr class="border-b border-outline-variant/10 hover:bg-surface-container/30 transition-colors">
                  <td class="p-3 font-body-sm text-body-sm text-on-surface capitalize">{k.provider}</td>
                  <td class="p-3 font-body-sm text-body-sm text-on-surface">{k.label}</td>
                  <td class="p-3 font-code-sm text-code-sm text-outline font-mono">{k.key_prefix}...</td>
                  <td class="p-3">
                    <span class="px-2 py-1 rounded text-[11px] font-mono font-medium border {k.community_routing_status === 'OBSERVATION' ? 'bg-error/10 text-error border-error/20' : 'bg-secondary/10 text-secondary border-secondary/20'}">
                      {k.community_routing_status || 'OBSERVATION'}
                    </span>
                  </td>
                  <td class="p-3 flex items-center gap-2">
                    <button class="text-xs text-primary hover:underline cursor-pointer" onclick={() => onRotate(k.id)}>Rotate</button>
                    <button class="text-xs text-outline hover:underline cursor-pointer" onclick={() => onOpenSwitchPool(k)}>Switch to Private</button>
                    <button class="text-xs text-error hover:underline cursor-pointer" onclick={() => onDelete(k.id)}>Delete</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  </div>
</section>
