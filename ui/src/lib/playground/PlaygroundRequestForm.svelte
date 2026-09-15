<script lang="ts">
  let {
    bearerToken = $bindable(''),
    isSessionToken = false,
    selectedModel = $bindable(''),
    availableModels = [],
    isStreaming = $bindable(true),
    payloadJson = $bindable(''),
    isSending = false,
    onSendRequest,
  }: {
    bearerToken?: string;
    isSessionToken?: boolean;
    selectedModel?: string;
    availableModels?: { id: string; provider: string }[];
    isStreaming?: boolean;
    payloadJson?: string;
    isSending?: boolean;
    onSendRequest?: () => void;
  } = $props();
</script>

<div class="rounded-xl bg-surface-container-low/80 backdrop-blur-xl border border-white/[0.08] p-5 shadow-xl specular-top space-y-4">
  <h2 class="text-label-lg font-semibold text-on-surface flex items-center gap-2">
    <span class="material-symbols-outlined text-primary text-[18px]">tune</span>
    <span>Request Parameters</span>
  </h2>

  <!-- Bearer Token -->
  <div>
    <div class="flex justify-between items-center mb-1">
      <label for="playToken" class="text-label-sm uppercase tracking-wider text-outline font-mono">Authorization Token</label>
      {#if isSessionToken}
        <span class="text-[10px] text-emerald-400 font-mono font-semibold flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> ACTIVE SESSION
        </span>
      {:else}
        <span class="text-[10px] text-secondary font-mono flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-indigo-400"></span> SANDBOX PREFILL
        </span>
      {/if}
    </div>
    <div class="relative">
      <span class="material-symbols-outlined absolute left-2.5 top-2 text-outline text-sm">key</span>
      <input
        id="playToken"
        bind:value={bearerToken}
        class="w-full pl-8 pr-3 py-1.5 text-xs font-mono rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface focus:border-primary focus:outline-none"
        placeholder="Bearer kc_live_..."
      />
    </div>
  </div>

  <!-- Model Selection -->
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <div>
      <label for="playModel" class="block text-label-sm uppercase tracking-wider text-outline mb-1 font-mono">Model</label>
      <select
        id="playModel"
        bind:value={selectedModel}
        class="w-full py-2 px-2.5 text-xs font-mono rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface focus:border-primary focus:outline-none cursor-pointer"
      >
        {#each availableModels as m (m.id)}
          <option value={m.id}>{m.id} ({m.provider})</option>
        {/each}
      </select>
    </div>

    <!-- Streaming SSE Toggle -->
    <div>
      <span class="block text-label-sm uppercase tracking-wider text-outline mb-1 font-mono">Streaming (SSE)</span>
      <button
        type="button"
        onclick={() => (isStreaming = !isStreaming)}
        class="w-full flex items-center justify-between h-[38px] px-3 rounded-lg bg-surface-container-lowest border border-outline-variant/40 cursor-pointer hover:border-outline-variant/60 transition-colors"
      >
        <span class="text-xs font-mono flex items-center gap-1.5 {isStreaming ? 'text-secondary font-semibold' : 'text-outline'}">
          <span class="w-2 h-2 rounded-full {isStreaming ? 'bg-secondary animate-pulse' : 'bg-outline'}"></span>
          <span>{isStreaming ? 'SSE Active' : 'Buffered'}</span>
        </span>
        <span class="w-4 h-4 rounded border flex items-center justify-center {isStreaming ? 'bg-secondary border-secondary text-surface-container-lowest' : 'bg-surface-container border-outline-variant/50'}">
          {#if isStreaming}
            <span class="material-symbols-outlined text-[11px] font-bold">check</span>
          {/if}
        </span>
      </button>
    </div>
  </div>

  <!-- JSON Request Body Editor -->
  <div>
    <div class="flex items-center justify-between mb-1">
      <label for="playPayload" class="text-label-sm uppercase tracking-wider text-outline font-mono">JSON Body</label>
      <span class="text-[10px] font-mono text-outline">application/json</span>
    </div>
    <textarea
      id="playPayload"
      bind:value={payloadJson}
      rows="9"
      class="w-full p-3 text-xs font-mono rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface focus:border-primary focus:outline-none resize-y"
      spellcheck="false"
    ></textarea>
  </div>

  <!-- Execute Action Button -->
  <button
    type="button"
    class="w-full py-2.5 rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-fixed-dim transition-all shadow-[0_0_20px_rgba(192,193,255,0.25)] flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer disabled:opacity-60"
    disabled={isSending}
    onclick={onSendRequest}
  >
    {#if isSending}
      <span class="material-symbols-outlined animate-spin text-[18px]">sync</span>
      <span>Dispatching Request...</span>
    {:else}
      <span class="material-symbols-outlined text-[18px]">play_arrow</span>
      <span>Send Request (Cmd + Enter)</span>
    {/if}
  </button>
</div>
