<script lang="ts">
  import type { PoolType } from '../types';

  let {
    selectedPoolType = $bindable(),
    isGitHubAuth,
  }: {
    selectedPoolType: PoolType;
    isGitHubAuth: boolean;
  } = $props();
</script>

<div>
  <span class="block text-slate-400 font-semibold mb-2 uppercase tracking-wider text-[10px]">
    Pool Routing Mode
  </span>
  <div class="grid grid-cols-2 gap-3">
    <button
      type="button"
      disabled={!isGitHubAuth}
      onclick={() => selectedPoolType = 'COMMUNITY'}
      class="flex flex-col gap-1 p-3 rounded-xl border transition-all text-left {selectedPoolType === 'COMMUNITY'
        ? 'bg-indigo-950/40 border-indigo-500/50 text-indigo-200 shadow-md shadow-indigo-950/40 ring-1 ring-indigo-500/40'
        : 'bg-slate-900/40 border-white/10 text-slate-400 hover:border-white/20'} {!isGitHubAuth ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}"
    >
      <div class="font-bold text-white text-xs flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Community (recommended)
      </div>
      <div class="text-[10px] text-slate-400 leading-tight">Key is accessible to all collective members. Earns standing.</div>
    </button>

    <button
      type="button"
      onclick={() => selectedPoolType = 'PRIVATE'}
      class="flex flex-col gap-1 p-3 rounded-xl border transition-all text-left cursor-pointer {selectedPoolType === 'PRIVATE'
        ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200 shadow-md shadow-emerald-950/40 ring-1 ring-emerald-500/40'
        : 'bg-slate-900/40 border-white/10 text-slate-400 hover:border-white/20'}"
    >
      <div class="font-bold text-white text-xs flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        Private
      </div>
      <div class="text-[10px] text-slate-400 leading-tight">Key is reserved strictly for your personal use.</div>
    </button>
  </div>
  {#if !isGitHubAuth}
    <div class="mt-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5">
      <span class="text-amber-400 font-bold text-sm">🔒</span>
      <div class="flex-1">
        <p class="text-amber-300 font-semibold text-xs tracking-wide">GitHub Authentication Required</p>
        <p class="text-[10px] text-amber-200/70 mt-0.5">Only GitHub-authenticated accounts may contribute to the Community Pool.</p>
      </div>
    </div>
  {/if}
</div>
