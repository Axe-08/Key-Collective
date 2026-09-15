<script lang="ts">
  let {
    isDemoLaunching,
    onLaunchDemo,
  }: {
    isDemoLaunching: boolean;
    onLaunchDemo: () => void;
  } = $props();
</script>

<div class="rounded-xl p-5 bg-gradient-to-r from-white/[0.02] to-indigo-950/20 border border-white/[0.08] flex flex-col justify-between space-y-3">
  <div>
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-amber-400 text-lg">bolt</span>
        <span class="text-sm font-semibold text-white tracking-tight">Quick Start Sandbox</span>
      </div>
      <span class="font-mono text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded flex items-center gap-1">
        <span class="material-symbols-outlined text-xs">timer</span> 15m TTL
      </span>
    </div>
    <p class="text-xs text-white/60 leading-relaxed">
      Instantly test without committing credentials. Spins up an isolated ephemeral edge isolate with 15 RPM proxy rate-limiting.
    </p>
  </div>

  <div class="flex flex-col sm:flex-row items-center gap-3 pt-1">
    <button
      type="button"
      onclick={onLaunchDemo}
      disabled={isDemoLaunching}
      class="w-full sm:w-auto flex-1 px-4 py-2.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 hover:border-white/20 text-white text-xs font-semibold flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer disabled:opacity-50"
    >
      {#if isDemoLaunching}
        <svg class="w-3.5 h-3.5 animate-spin text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25" stroke="currentColor" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="0.9" />
        </svg>
        <span>Spawning DemoDO Isolate...</span>
      {:else}
        <span class="material-symbols-outlined text-amber-400 text-base">terminal</span>
        <span>Launch 15-Min Ephemeral Sandbox</span>
      {/if}
    </button>
    <div class="font-mono text-[10px] text-white/40 flex items-center gap-1.5 shrink-0">
      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
      <span>0 req log stored</span>
    </div>
  </div>
</div>
