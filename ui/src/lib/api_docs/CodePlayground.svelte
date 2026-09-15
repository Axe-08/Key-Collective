<script lang="ts">
  import type { ModelOption, ResponseChunk } from './types';

  interface Props {
    baseUrl: string;
    bearerToken: string;
    isSessionToken: boolean;
    selectedModel: string;
    isStreaming: boolean;
    activeTab: 'curl' | 'ts' | 'py';
    availableModels: ModelOption[];
    payloadJson: string;
    isSending: boolean;
    simulatedLatency: string;
    simulatedStatus: string;
    responseChunks: ResponseChunk[];
    fallbackModelUsed: string | null;
    activeSnippet: string;
    copiedSnippet: boolean;
    onBearerTokenChange: (val: string) => void;
    onSelectedModelChange: (val: string) => void;
    onStreamingToggle: (val: boolean) => void;
    onActiveTabChange: (tab: 'curl' | 'ts' | 'py') => void;
    onPayloadJsonChange: (val: string) => void;
    onSendRequest: () => void;
    onCopySnippet: () => void;
  }

  let {
    baseUrl,
    bearerToken,
    isSessionToken,
    selectedModel,
    isStreaming,
    activeTab,
    availableModels,
    payloadJson = $bindable(''),
    isSending,
    simulatedLatency,
    simulatedStatus,
    responseChunks,
    fallbackModelUsed,
    activeSnippet,
    copiedSnippet,
    onBearerTokenChange,
    onSelectedModelChange,
    onStreamingToggle,
    onActiveTabChange,
    onSendRequest,
    onCopySnippet,
  }: Props = $props();
</script>

<div class="rounded-xl bg-surface-container-low/80 backdrop-blur-xl border border-white/[0.08] p-5 specular-top shadow-xl space-y-4">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-outline-variant/20 pb-3">
    <div>
      <h2 class="text-title-lg font-title-lg font-semibold text-on-surface flex items-center gap-2">
        <span class="material-symbols-outlined text-primary text-[20px]">play_circle</span>
        Interactive Live Request Playground
      </h2>
      <p class="text-body-sm font-body-sm text-outline">
        Execute actual edge proxy requests with hot pool rotation, zero latency penalty, and client fallback.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <!-- Bearer Token Indicator / Input -->
      <div class="flex items-center gap-1.5 px-2.5 py-1 bg-surface-container-highest rounded-lg border border-outline-variant/30 text-xs font-mono">
        <span class="material-symbols-outlined text-[14px] text-primary">key</span>
        <input
          type="text"
          value={bearerToken}
          oninput={(e) => onBearerTokenChange(e.currentTarget.value)}
          placeholder="Enter Bearer Token..."
          class="bg-transparent text-on-surface focus:outline-none w-36 sm:w-44 truncate"
        />
        {#if isSessionToken}
          <span class="text-[9px] px-1.5 py-0.2 rounded bg-secondary/15 text-secondary border border-secondary/30">Session</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
    <!-- Left Column: Parameters & Snippet Tabs (6 cols) -->
    <div class="lg:col-span-6 space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <!-- Model Select -->
        <div class="flex-1 min-w-[180px]">
          <label class="block text-label-sm font-label-sm text-outline mb-1 font-mono" for="modelSelect">Target Model</label>
          <select
            id="modelSelect"
            value={selectedModel}
            onchange={(e) => onSelectedModelChange(e.currentTarget.value)}
            class="w-full px-3 py-1.5 bg-surface-container-high rounded-lg border border-outline-variant/40 text-on-surface text-body-sm font-body-sm font-mono focus:outline-none focus:border-primary cursor-pointer"
          >
            {#each availableModels as m}
              <option value={m.id}>{m.id} ({m.provider})</option>
            {/each}
          </select>
        </div>

        <!-- Stream Toggle -->
        <div>
          <span class="block text-label-sm font-label-sm text-outline mb-1 font-mono">Streaming (SSE)</span>
          <button
            type="button"
            onclick={() => onStreamingToggle(!isStreaming)}
            class="px-3 py-1.5 rounded-lg border text-label-sm font-label-sm font-mono transition-all flex items-center gap-1.5 cursor-pointer {isStreaming ? 'bg-secondary/15 border-secondary/40 text-secondary' : 'bg-surface-container-high border-outline-variant/30 text-outline'}"
          >
            <span class="w-2 h-2 rounded-full {isStreaming ? 'bg-secondary animate-pulse' : 'bg-outline'}"></span>
            {isStreaming ? 'SSE Active' : 'Buffered JSON'}
          </button>
        </div>
      </div>

      <!-- JSON Payload Editor -->
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-label-sm font-label-sm text-outline font-mono" for="payloadTextarea">Request Body (JSON)</label>
          <span class="text-[10px] font-mono text-outline">Press Cmd+Enter to Send</span>
        </div>
        <textarea
          id="payloadTextarea"
          bind:value={payloadJson}
          rows="7"
          class="w-full p-3 bg-surface-container-lowest rounded-lg border border-outline-variant/30 text-secondary font-mono text-xs focus:outline-none focus:border-primary custom-scrollbar leading-relaxed"
        ></textarea>
      </div>

      <!-- Code Snippet Tabs -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1 bg-surface-container-high p-1 rounded-lg border border-outline-variant/20 font-mono text-xs">
            <button
              type="button"
              onclick={() => onActiveTabChange('curl')}
              class="px-2.5 py-1 rounded transition-colors cursor-pointer {activeTab === 'curl' ? 'bg-primary text-on-primary font-medium' : 'text-outline hover:text-on-surface'}"
            >
              cURL
            </button>
            <button
              type="button"
              onclick={() => onActiveTabChange('ts')}
              class="px-2.5 py-1 rounded transition-colors cursor-pointer {activeTab === 'ts' ? 'bg-primary text-on-primary font-medium' : 'text-outline hover:text-on-surface'}"
            >
              TypeScript SDK
            </button>
            <button
              type="button"
              onclick={() => onActiveTabChange('py')}
              class="px-2.5 py-1 rounded transition-colors cursor-pointer {activeTab === 'py' ? 'bg-primary text-on-primary font-medium' : 'text-outline hover:text-on-surface'}"
            >
              Python SDK
            </button>
          </div>

          <button
            type="button"
            onclick={onCopySnippet}
            class="px-2 py-1 text-[11px] font-mono rounded bg-surface-container-high border border-outline-variant/30 text-outline hover:text-on-surface flex items-center gap-1 cursor-pointer transition-colors"
          >
            {#if copiedSnippet}
              <span class="material-symbols-outlined text-[13px] text-secondary">check</span>
              <span class="text-secondary">Copied!</span>
            {:else}
              <span class="material-symbols-outlined text-[13px]">content_copy</span>
              <span>Copy Code</span>
            {/if}
          </button>
        </div>

        <pre class="p-3 bg-surface-container-lowest rounded-lg border border-outline-variant/30 text-on-surface font-mono text-xs overflow-x-auto custom-scrollbar max-h-40">{activeSnippet}</pre>
      </div>
    </div>

    <!-- Right Column: Live Response Terminal (6 cols) -->
    <div class="lg:col-span-6 flex flex-col justify-between space-y-4">
      <div class="space-y-2 flex-1 flex flex-col">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-label-sm font-label-sm text-outline font-mono">Edge Terminal Response</span>
            {#if fallbackModelUsed}
              <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 border border-amber-500/30 text-amber-400">
                Cascade fallback: {fallbackModelUsed}
              </span>
            {/if}
          </div>
          <div class="flex items-center gap-3 font-mono text-xs">
            <span class="text-outline">Latency: <strong class="text-secondary">{simulatedLatency}</strong></span>
            <span class="text-outline">Status: <strong class="text-on-surface">{simulatedStatus}</strong></span>
          </div>
        </div>

        <div class="flex-1 p-3 bg-surface-container-lowest rounded-lg border border-outline-variant/30 font-mono text-xs overflow-y-auto max-h-[360px] min-h-[220px] custom-scrollbar space-y-1">
          {#each responseChunks as chunk}
            <div class="{chunk.class}">{chunk.text}</div>
          {/each}
        </div>
      </div>

      <!-- Action Button -->
      <div class="flex items-center justify-end gap-3 pt-2 border-t border-outline-variant/20">
        <button
          type="button"
          disabled={isSending}
          onclick={onSendRequest}
          class="px-5 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold hover:opacity-90 active:scale-[0.98] transition-all flex items-center gap-2 cursor-pointer shadow-[0_0_15px_rgba(128,131,255,0.3)] disabled:opacity-50"
        >
          {#if isSending}
            <span class="material-symbols-outlined animate-spin text-[16px]">refresh</span>
            <span>Routing through Edge...</span>
          {:else}
            <span class="material-symbols-outlined text-[16px]">send</span>
            <span>Send Request</span>
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>
