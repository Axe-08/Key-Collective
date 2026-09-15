<script lang="ts">
  import { generateCurlSnippet, generateTsSnippet, generatePySnippet } from './generators';

  interface Props {
    baseUrl: string;
    bearerToken: string;
    activeProvider: string;
  }

  let { baseUrl, bearerToken, activeProvider }: Props = $props();

  let expandedEndpoint = $state<string | null>('chat');

  const curlChat = $derived(generateCurlSnippet(baseUrl, bearerToken, 'gemini-3.8-flash', false));
  const tsChat = $derived(generateTsSnippet(baseUrl, bearerToken, 'gemini-3.8-flash', false));
  const pyChat = $derived(generatePySnippet(baseUrl, bearerToken, 'gemini-3.8-flash', false));
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h2 class="text-title-lg font-title-lg font-semibold text-on-surface flex items-center gap-2">
      <span class="material-symbols-outlined text-primary text-[20px]">api</span>
      Core Gateway Endpoints
    </h2>
    <span class="text-xs font-mono text-outline">OpenAI Spec 3.1.0 Compliant</span>
  </div>

  <!-- Endpoint 1: POST /v1/chat/completions -->
  <div class="rounded-xl bg-surface-container-low border border-white/[0.08] overflow-hidden">
    <button
      type="button"
      onclick={() => (expandedEndpoint = expandedEndpoint === 'chat' ? null : 'chat')}
      class="w-full p-4 flex items-center justify-between text-left hover:bg-surface-container-high/40 transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-3">
        <span class="px-2.5 py-1 rounded bg-primary/20 text-primary font-mono text-xs font-bold">POST</span>
        <span class="font-mono text-sm text-on-surface font-semibold">/v1/chat/completions</span>
        <span class="text-xs text-outline hidden sm:inline">— Unified Chat Completions with Automatic Key Pooling</span>
      </div>
      <span class="material-symbols-outlined text-outline transition-transform {expandedEndpoint === 'chat' ? 'rotate-180' : ''}">expand_more</span>
    </button>

    {#if expandedEndpoint === 'chat'}
      <div class="p-4 border-t border-outline-variant/20 space-y-4 bg-surface-container-lowest/50 font-mono text-xs">
        <p class="text-on-surface-variant font-sans">
          Primary LLM proxy hot path. Dispatches across pooled keys, rotating automatically when rate-limit thresholds or upstream outages occur.
        </p>
        <div class="space-y-2">
          <div class="text-outline uppercase text-[10px] font-semibold">Headers</div>
          <div class="p-2 rounded bg-surface-container border border-outline-variant/20 text-on-surface space-y-1">
            <div><span class="text-primary">Authorization:</span> Bearer &lt;token&gt;</div>
            <div><span class="text-primary">Content-Type:</span> application/json</div>
            <div><span class="text-outline">x-pool-fallback:</span> lenient | strict | none <span class="text-outline text-[10px] font-sans">(Optional)</span></div>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Endpoint 2: GET /v1/models -->
  <div class="rounded-xl bg-surface-container-low border border-white/[0.08] overflow-hidden">
    <button
      type="button"
      onclick={() => (expandedEndpoint = expandedEndpoint === 'models' ? null : 'models')}
      class="w-full p-4 flex items-center justify-between text-left hover:bg-surface-container-high/40 transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-3">
        <span class="px-2.5 py-1 rounded bg-secondary/20 text-secondary font-mono text-xs font-bold">GET</span>
        <span class="font-mono text-sm text-on-surface font-semibold">/v1/models</span>
        <span class="text-xs text-outline hidden sm:inline">— Model Catalog with Live Routing Metadata</span>
      </div>
      <span class="material-symbols-outlined text-outline transition-transform {expandedEndpoint === 'models' ? 'rotate-180' : ''}">expand_more</span>
    </button>

    {#if expandedEndpoint === 'models'}
      <div class="p-4 border-t border-outline-variant/20 space-y-3 bg-surface-container-lowest/50 font-mono text-xs">
        <p class="text-on-surface-variant font-sans">
          Returns all supported models across connected provider backends (Gemini, Groq, DeepSeek, Cerebras, OpenAI).
        </p>
      </div>
    {/if}
  </div>

  <!-- Endpoint 3: GET /v1/health -->
  <div class="rounded-xl bg-surface-container-low border border-white/[0.08] overflow-hidden">
    <button
      type="button"
      onclick={() => (expandedEndpoint = expandedEndpoint === 'health' ? null : 'health')}
      class="w-full p-4 flex items-center justify-between text-left hover:bg-surface-container-high/40 transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-3">
        <span class="px-2.5 py-1 rounded bg-secondary/20 text-secondary font-mono text-xs font-bold">GET</span>
        <span class="font-mono text-sm text-on-surface font-semibold">/v1/health</span>
        <span class="text-xs text-outline hidden sm:inline">— Edge Liveness &amp; Cluster Health Probe</span>
      </div>
      <span class="material-symbols-outlined text-outline transition-transform {expandedEndpoint === 'health' ? 'rotate-180' : ''}">expand_more</span>
    </button>

    {#if expandedEndpoint === 'health'}
      <div class="p-4 border-t border-outline-variant/20 space-y-3 bg-surface-container-lowest/50 font-mono text-xs">
        <p class="text-on-surface-variant font-sans">
          Public health probe returning JSON cluster readiness and edge node uptime metrics. Zero auth required.
        </p>
      </div>
    {/if}
  </div>
</div>
