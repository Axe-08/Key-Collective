<script lang="ts">
  let {
    baseUrl = '',
  }: {
    baseUrl?: string;
  } = $props();
</script>

<div class="rounded-xl bg-surface-container-low/80 backdrop-blur-xl border border-white/[0.08] p-5 shadow-xl specular-top">
  <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
    <div class="flex items-center gap-3">
      <div class="p-2.5 rounded-xl bg-primary-container/20 border border-primary/30 text-primary">
        <span class="material-symbols-outlined text-[24px]">science</span>
      </div>
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-headline-sm font-semibold text-on-surface">Interactive Sandbox Playground</h1>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-secondary-container/20 border border-secondary/30 text-secondary flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span> LIVE GATEWAY
          </span>
        </div>
        <p class="text-body-sm text-outline">
          Test unified completions, verify streaming latency, and validate fallback routing across community and private provider keys.
        </p>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <div class="px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-xs font-mono text-outline">
        Base: <span class="text-primary font-semibold">{baseUrl}</span>
      </div>
    </div>
  </div>
</div>
