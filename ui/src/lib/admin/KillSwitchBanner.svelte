<script lang="ts">
  let {
    globalKillSwitchActive,
    onDisarm,
  }: {
    globalKillSwitchActive: boolean;
    onDisarm: () => void;
  } = $props();
</script>

{#if globalKillSwitchActive}
  <div class="specular-card p-4 rounded-xl bg-error-container/30 border-2 border-error text-on-error-container flex flex-col sm:flex-row items-center justify-between gap-3 shadow-[0_0_24px_rgba(239,68,68,0.4)] animate-pulse">
    <div class="flex items-center gap-3">
      <span class="material-symbols-outlined text-error text-[28px]">emergency</span>
      <div>
        <h3 class="font-mono font-bold text-[15px] uppercase tracking-wide text-error">
          CRITICAL: Global Edge Proxy Kill Switch Engaged
        </h3>
        <p class="text-xs font-mono text-on-surface-variant">
          All edge isolates are returning HTTP 503 Service Unavailable. Upstream providers are completely shielded.
        </p>
      </div>
    </div>
    <button
      type="button"
      onclick={onDisarm}
      class="px-4 py-1.5 rounded-lg bg-secondary text-charcoal font-mono font-bold text-xs uppercase transition-all hover:bg-secondary-fixed cursor-pointer shrink-0"
    >
      Disarm Kill Switch
    </button>
  </div>
{/if}
