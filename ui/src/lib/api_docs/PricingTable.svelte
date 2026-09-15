<script lang="ts">
  import type { ModelPricingItem } from './types';

  interface Props {
    modelsData: ModelPricingItem[] | null;
    pricingFilter: 'active' | 'all';
    onFilterChange: (filter: 'active' | 'all') => void;
  }

  let { modelsData, pricingFilter, onFilterChange }: Props = $props();

  const filteredModels = $derived(
    modelsData
      ? modelsData.filter((m) => (pricingFilter === 'active' ? !m.isDeprecated : true))
      : []
  );
</script>

<div class="rounded-xl bg-surface-container-low/80 backdrop-blur-xl border border-white/[0.08] p-5 specular-top shadow-xl space-y-4">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-outline-variant/20 pb-3">
    <div>
      <h2 class="text-title-lg font-title-lg font-semibold text-on-surface flex items-center gap-2">
        <span class="material-symbols-outlined text-secondary text-[20px]">payments</span>
        Authoritative Fixed-Point Pricing Matrix
      </h2>
      <p class="text-body-sm font-body-sm text-outline">
        Deterministic pricing per model in microdollars (µ$). Zero float conversions. (1 USD = 1,000,000 µ$)
      </p>
    </div>
    <div class="flex items-center gap-1 bg-surface-container-highest/60 p-1 rounded-lg border border-outline-variant/20">
      <button
        type="button"
        onclick={() => onFilterChange('active')}
        class="px-2.5 py-1 text-label-sm font-label-sm rounded font-medium transition-all cursor-pointer {pricingFilter === 'active' ? 'bg-primary text-on-primary shadow-sm' : 'text-outline hover:text-on-surface'}"
      >
        Active Models
      </button>
      <button
        type="button"
        onclick={() => onFilterChange('all')}
        class="px-2.5 py-1 text-label-sm font-label-sm rounded font-medium transition-all cursor-pointer {pricingFilter === 'all' ? 'bg-primary text-on-primary shadow-sm' : 'text-outline hover:text-on-surface'}"
      >
        All (Inc. Deprecated)
      </button>
    </div>
  </div>

  <div class="overflow-x-auto">
    <table class="w-full text-left font-mono text-xs">
      <thead>
        <tr class="text-outline uppercase font-label-sm text-[11px] border-b border-outline-variant/20">
          <th class="py-2.5 px-3">Model</th>
          <th class="py-2.5 px-3">Routing Engine</th>
          <th class="py-2.5 px-3">Input / 1K</th>
          <th class="py-2.5 px-3">Output / 1K</th>
          <th class="py-2.5 px-3">Effective USD / 1M</th>
          <th class="py-2.5 px-3 text-right">Status</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/10 text-on-surface">
        {#if !modelsData}
          <tr>
            <td colspan="6" class="py-6 text-center text-outline">Loading live pricing data from cluster registry...</td>
          </tr>
        {:else if filteredModels.length === 0}
          <tr>
            <td colspan="6" class="py-6 text-center text-outline">No models found for selected filter.</td>
          </tr>
        {:else}
          {#each filteredModels as m}
            <tr class="hover:bg-white/[0.02] transition-colors {m.isDeprecated ? 'opacity-60 bg-amber-500/[0.02]' : ''}">
              <td class="py-2.5 px-3 font-semibold text-primary flex items-center gap-2">
                <span class="w-2 h-2 rounded-full {m.bulletClass}"></span>
                <span>{m.id}</span>
              </td>
              <td class="py-2.5 px-3 text-on-surface-variant">{m.routing_engine}</td>
              <td class="py-2.5 px-3 text-secondary font-medium">{m.inputCost1kMicro} µ$</td>
              <td class="py-2.5 px-3 text-secondary font-medium">{m.outputCost1kMicro} µ$</td>
              <td class="py-2.5 px-3 text-outline">${m.inputCostPerMUsd} / ${m.outputCostPerMUsd}</td>
              <td class="py-2.5 px-3 text-right">
                {#if m.isDeprecated}
                  <span class="px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    Deprecated {m.sunsetAt ? `(${m.sunsetAt.substring(0, 10)})` : ''}
                  </span>
                {:else}
                  <span class="px-2 py-0.5 rounded text-[10px] bg-secondary/10 text-secondary border border-secondary/30">
                    Active
                  </span>
                {/if}
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>
