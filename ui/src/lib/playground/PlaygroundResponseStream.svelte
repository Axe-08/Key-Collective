<script lang="ts">
  import { formatMicrodollars } from '../types';

  let {
    liveStatus = 'Ready',
    liveLatency = '0ms',
    liveCostMicros = 0,
    selectedModel = '',
    fallbackModelUsed = null,
    responseChunks = [],
  }: {
    liveStatus?: string;
    liveLatency?: string;
    liveCostMicros?: number;
    selectedModel?: string;
    fallbackModelUsed?: string | null;
    responseChunks?: Array<{ text: string; class: string }>;
  } = $props();
</script>

<div class="rounded-xl bg-surface-container-low/80 backdrop-blur-xl border border-white/[0.08] p-5 shadow-xl specular-top">
  <div class="flex items-center justify-between pb-3 border-b border-outline-variant/20 mb-3">
    <div class="flex items-center gap-2">
      <span class="material-symbols-outlined text-secondary text-[18px]">terminal</span>
      <span class="text-label-md font-semibold text-on-surface">Response Stream &amp; Metadata</span>
    </div>

    <div class="flex items-center gap-3 text-xs font-mono">
      <span class="px-2 py-0.5 rounded bg-surface-container-high border border-outline-variant/30 text-on-surface font-semibold">
        Status: <span class={liveStatus.startsWith('200') ? 'text-secondary' : liveStatus === 'Ready' ? 'text-outline' : 'text-error'}>{liveStatus}</span>
      </span>
      <span class="text-outline">Latency: <span class="text-primary font-semibold">{liveLatency}</span></span>
      {#if liveCostMicros > 0}
        <span class="text-outline">Cost: <span class="text-secondary font-semibold">{formatMicrodollars(liveCostMicros)}</span></span>
      {/if}
    </div>
  </div>

  {#if fallbackModelUsed && fallbackModelUsed !== selectedModel}
    <div class="mb-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2">
      <span class="material-symbols-outlined text-amber-400 text-[18px]">warning</span>
      <div>
        <span class="font-bold">Cascade Fallback Triggered:</span>
        Target model <code class="font-mono text-on-surface">{selectedModel}</code> was rate-limited. Served seamlessly by <code class="font-mono text-secondary font-bold">{fallbackModelUsed}</code>.
      </div>
    </div>
  {/if}

  <div class="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-4 min-h-[380px] max-h-[600px] overflow-y-auto custom-scroll font-mono text-xs">
    {#if responseChunks.length === 0}
      <div class="flex flex-col items-center justify-center h-[340px] text-outline text-center space-y-2">
        <span class="material-symbols-outlined text-[36px] text-outline/50">play_circle</span>
        <p>No active response yet. Configure parameters and click "Send Request".</p>
        <p class="text-[11px] text-outline/70">Incoming tokens and latency metrics will render here in real-time.</p>
      </div>
    {:else}
      <div class="space-y-1.5">
        {#each responseChunks as chunk}
          <div class={chunk.class}>{chunk.text}</div>
        {/each}
      </div>
    {/if}
  </div>
</div>
