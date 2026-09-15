<script lang="ts">
  let {
    isProbationary,
    isBuilderOrHigher,
  }: {
    isProbationary: boolean;
    isBuilderOrHigher: boolean;
  } = $props();
</script>

<!-- Interactive Two-Phase Progression Indicator -->
<div class="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 sm:p-4">
  <div class="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono">
    <!-- Phase 1 Step -->
    <div class="flex items-center gap-3 w-full sm:w-auto">
      <div class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold {isProbationary || isBuilderOrHigher ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'}">
        {#if isProbationary || isBuilderOrHigher}
          <span class="material-symbols-outlined text-sm">check</span>
        {:else}
          1
        {/if}
      </div>
      <div>
        <div class="font-semibold text-white flex items-center gap-1.5">
          <span>Phase 1: Ingress Sandbox</span>
          {#if isProbationary}
            <span class="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30">ACTIVE</span>
          {:else if isBuilderOrHigher}
            <span class="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30">PASSED</span>
          {/if}
        </div>
        <div class="text-[11px] text-white/50">Email + Turnstile Nonce • 2 RPM / 50k µ$ cap</div>
      </div>
    </div>

    <!-- Arrow Divider -->
    <span class="hidden sm:inline-block text-white/30 material-symbols-outlined text-sm">arrow_forward</span>

    <!-- Phase 2 Step -->
    <div class="flex items-center gap-3 w-full sm:w-auto">
      <div class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold {isBuilderOrHigher ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/10 text-white/60 border border-white/15'}">
        {#if isBuilderOrHigher}
          <span class="material-symbols-outlined text-sm">verified</span>
        {:else}
          2
        {/if}
      </div>
      <div>
        <div class="font-semibold text-white flex items-center gap-1.5">
          <span>Phase 2: Elevation Gate</span>
          {#if isBuilderOrHigher}
            <span class="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30">ELEVATED</span>
          {:else}
            <span class="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30">PKCE READY</span>
          {/if}
        </div>
        <div class="text-[11px] text-white/50">GitHub OAuth 2.0 PKCE • 60 RPM / 10,000 RPD</div>
      </div>
    </div>
  </div>
</div>
