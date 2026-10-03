<script lang="ts">
  import type { UserTier } from '../../../../src/contracts/v3_types';
  import type { TierMatrixItem } from './types';

  interface Props {
    tierMatrix: TierMatrixItem[];
    selectedTier: UserTier;
  }

  // Read-only: the tier comes from the server (users.tier), never from clicking a card (QA-04).
  let { tierMatrix, selectedTier }: Props = $props();
</script>

<section class="space-y-3">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <h2 class="font-headline-md text-headline-md font-semibold text-on-surface">
        Quota Hierarchy &amp; Governance Tiers
      </h2>
      <div class="group relative cursor-pointer">
        <span class="material-symbols-outlined text-outline text-[16px]">info</span>
        <div class="hidden group-hover:block absolute left-0 bottom-full mb-1 w-56 p-2 rounded bg-surface-container-highest text-on-surface font-body-sm text-body-sm border border-outline-variant/30 shadow-xl z-20">
          Tier limits for reference. Your tier is assigned by the platform. Current: {selectedTier.toUpperCase()}.
        </div>
      </div>
    </div>
    <span class="font-label-sm text-label-sm text-outline font-mono">Horizontal Matrix View</span>
  </div>

  <!-- Scrollable, read-only tier cards -->
  <div class="flex gap-3 overflow-x-auto pb-2 custom-scrollbar -mx-1 px-1">
    {#each tierMatrix as tier}
      {@const isActive = selectedTier === tier.id && (tier.name.includes('Builder') || tier.id !== 'builder' || !tier.name.includes('Starter'))}
      <div
        data-testid="tier-card"
        class="{tier.minWidth} flex-1 text-left rounded-xl p-3.5 flex flex-col justify-between specular-card {isActive ? 'bg-surface-container-high border-2 border-primary shadow-[0_0_20px_rgba(192,193,255,0.18)] relative' : 'bg-surface-container-low/50 border border-outline-variant/20 opacity-80'}"
      >
        {#if isActive}
          <span class="absolute -top-2.5 right-3 font-label-sm text-label-sm px-2 py-0.5 rounded-full bg-primary text-on-primary font-bold shadow-md font-mono">
            CURRENT ACTIVE TIER
          </span>
        {/if}

        <div>
          <div class="flex items-center justify-between {isActive ? 'mt-1' : ''}">
            <span class="font-code-md text-code-md font-semibold font-mono {isActive ? 'text-primary font-bold' : 'text-on-surface'}">
              {tier.name}
            </span>
            {#if !isActive}
              <span class="font-label-sm text-label-sm px-1.5 py-0.5 rounded {tier.badgeClass} font-mono">
                {tier.badge}
              </span>
            {/if}
          </div>

          <div class="mt-2 text-on-surface font-code-sm text-code-sm font-medium font-mono">
            {tier.quotaText}
          </div>
          <p class="font-body-sm text-body-sm text-on-surface-variant mt-1 leading-snug">
            {tier.description}
          </p>
        </div>

        <div class="mt-3 pt-2 {isActive ? 'border-t border-primary/20 flex items-center gap-1 text-primary font-medium' : 'border-t border-outline-variant/10 text-outline'} font-label-sm text-label-sm font-mono">
          {#if isActive}
            <span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
            Active Tier
          {:else}
            {tier.footerText}
          {/if}
        </div>
      </div>
    {/each}
  </div>
</section>
