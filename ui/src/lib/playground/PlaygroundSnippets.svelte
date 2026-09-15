<script lang="ts">
  let {
    activeTab = $bindable('curl'),
    activeSnippet = '',
    onCopySnippet,
    copiedSnippet = false,
  }: {
    activeTab?: 'curl' | 'ts' | 'py';
    activeSnippet?: string;
    onCopySnippet?: () => void;
    copiedSnippet?: boolean;
  } = $props();
</script>

<div class="rounded-xl bg-surface-container-low/80 backdrop-blur-xl border border-white/[0.08] p-4 shadow-xl">
  <div class="flex items-center justify-between mb-2">
    <div class="flex gap-2">
      <button
        type="button"
        class="px-2.5 py-1 rounded text-xs font-mono cursor-pointer {activeTab === 'curl' ? 'bg-primary/20 text-primary border border-primary/40 font-semibold' : 'text-outline hover:text-on-surface'}"
        onclick={() => (activeTab = 'curl')}
      >
        cURL
      </button>
      <button
        type="button"
        class="px-2.5 py-1 rounded text-xs font-mono cursor-pointer {activeTab === 'ts' ? 'bg-primary/20 text-primary border border-primary/40 font-semibold' : 'text-outline hover:text-on-surface'}"
        onclick={() => (activeTab = 'ts')}
      >
        TypeScript
      </button>
      <button
        type="button"
        class="px-2.5 py-1 rounded text-xs font-mono cursor-pointer {activeTab === 'py' ? 'bg-primary/20 text-primary border border-primary/40 font-semibold' : 'text-outline hover:text-on-surface'}"
        onclick={() => (activeTab = 'py')}
      >
        Python
      </button>
    </div>

    <button
      type="button"
      class="p-1 rounded text-outline hover:text-on-surface cursor-pointer flex items-center gap-1"
      onclick={onCopySnippet}
      title="Copy snippet"
    >
      {#if copiedSnippet}
        <span class="material-symbols-outlined text-secondary text-sm">check</span>
        <span class="text-[10px] text-secondary font-mono">Copied</span>
      {:else}
        <span class="material-symbols-outlined text-sm">content_copy</span>
      {/if}
    </button>
  </div>

  <div class="rounded-lg bg-surface-container-lowest border border-outline-variant/30 p-2.5 text-xs font-mono text-on-surface overflow-x-auto">
    <pre class="leading-relaxed select-all"><code>{activeSnippet}</code></pre>
  </div>
</div>
