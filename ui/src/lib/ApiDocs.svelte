<script lang="ts">
  import { onMount } from 'svelte';
  import {
    CANONICAL_MODELS,
    type ProviderFilter,
    type ModelOption,
    type ModelPricingItem,
    type ResponseChunk,
  } from './api_docs/types';
  import {
    generateCurlSnippet,
    generateTsSnippet,
    generatePySnippet,
    generateOpenApiJson,
    generateApiDocsMarkdown,
  } from './api_docs/generators';

  import PricingTable from './api_docs/PricingTable.svelte';
  import CodePlayground from './api_docs/CodePlayground.svelte';
  import EndpointsList from './api_docs/EndpointsList.svelte';

  let {
    proxyEndpoint = 'https://key-col.axe08.tech/v1/chat/completions',
  }: {
    proxyEndpoint?: string;
  } = $props();

  // Base URL derived from endpoint
  const baseUrl = $derived(proxyEndpoint.replace(/\/chat\/completions$/, ''));

  // Target provider filter state
  let activeProvider = $state<ProviderFilter>('OpenAI Compatible');
  const providers: ProviderFilter[] = ['OpenAI Compatible', 'Anthropic', 'Gemini', 'Groq', 'DeepSeek'];

  // Export dropdown state
  let exportMenuOpen = $state(false);

  // Copy feedback state
  let copiedBaseUrl = $state(false);
  let copiedToken = $state(false);
  let copiedSnippet = $state(false);

  // Playground state
  let bearerToken = $state('kc_proj_live_9f83a00c82de19a');
  let isSessionToken = $state(false);
  let selectedModel = $state('gemini-3.8-flash');
  let isStreaming = $state(true);
  let activeTab = $state<'curl' | 'ts' | 'py'>('curl');
  let availableModels = $state<ModelOption[]>(CANONICAL_MODELS);

  onMount(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('kc_auth_token');
      if (stored && stored.trim().length > 0) {
        bearerToken = stored.trim();
        isSessionToken = true;
      }
      fetch('/v1/models')
        .then(r => r.json())
        .then(data => {
          if (data && Array.isArray(data.data) && data.data.length > 0) {
            availableModels = data.data.map((m: any) => ({
              id: m.id,
              provider: m.owned_by || m.provider || 'custom'
            }));
            if (!availableModels.some(m => m.id === selectedModel)) {
              selectedModel = availableModels[0].id;
            }
          }
        })
        .catch(() => {
          // Keep canonical defaults if offline
        });
    }
  });

  let payloadJson = $state(`{\n  "model": "gemini-3.8-flash",\n  "messages": [\n    { "role": "system", "content": "You are an edge AI router." },\n    { "role": "user", "content": "Verify proxy handshake status." }\n  ],\n  "stream": true,\n  "temperature": 0.3\n}`);
  
  $effect(() => {
    try {
      const parsed = JSON.parse(payloadJson);
      let changed = false;
      if (parsed.model !== selectedModel) {
        parsed.model = selectedModel;
        changed = true;
      }
      if (parsed.stream !== isStreaming) {
        parsed.stream = isStreaming;
        changed = true;
      }
      if (changed) {
        payloadJson = JSON.stringify(parsed, null, 2);
      }
    } catch (e) {}
  });

  // Request execution & response state
  let isSending = $state(false);
  let fallbackModelUsed = $state<string | null>(null);
  let simulatedLatency = $state('18ms');
  let simulatedStatus = $state('200 OK');
  let responseChunks = $state<ResponseChunk[]>([
    {
      text: 'data: {"id":"chatcmpl-94k2","object":"chat.completion.chunk","created":17109210,"model":"gemini-3.8-flash","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}',
      class: 'text-outline text-[10px]',
    },
    { text: 'data: {"choices":[{"delta":{"content":"Handshake"}}]}', class: 'text-secondary' },
    { text: 'data: {"choices":[{"delta":{"content":" verified."}}]}', class: 'text-secondary' },
    { text: 'data: {"choices":[{"delta":{"content":" Edge proxy"}}]}', class: 'text-secondary' },
    { text: 'data: {"choices":[{"delta":{"content":" route nominal."}}]}', class: 'text-secondary' },
    {
      text: 'Summary: Handshake verified. Edge proxy route nominal. Zero failover cascades required.',
      class: 'text-on-surface-variant text-[11px] pt-1 font-sans',
    },
    {
      text: 'data: [DONE]   •   cost: 21 µ$',
      class: 'text-outline text-[10px] pt-1 border-t border-outline-variant/20',
    },
  ]);

  // Dynamic code snippets
  const curlSnippet = $derived(generateCurlSnippet(baseUrl, bearerToken, selectedModel, isStreaming));
  const tsSnippet = $derived(generateTsSnippet(baseUrl, bearerToken, selectedModel, isStreaming));
  const pySnippet = $derived(generatePySnippet(baseUrl, bearerToken, selectedModel, isStreaming));

  const activeSnippet = $derived(
    activeTab === 'curl' ? curlSnippet : activeTab === 'ts' ? tsSnippet : pySnippet
  );

  function copyText(text: string, type: 'url' | 'token' | 'snippet') {
    navigator.clipboard.writeText(text);
    if (type === 'url') {
      copiedBaseUrl = true;
      setTimeout(() => (copiedBaseUrl = false), 2000);
    } else if (type === 'token') {
      copiedToken = true;
      setTimeout(() => (copiedToken = false), 2000);
    } else if (type === 'snippet') {
      copiedSnippet = true;
      setTimeout(() => (copiedSnippet = false), 2000);
    }
  }

  async function handleSendRequest() {
    if (isSending) return;
    isSending = true;
    simulatedLatency = '...';
    responseChunks = [
      {
        text: `Establishing edge websocket tunnel to ${selectedModel}...`,
        class: 'text-outline text-[11px] animate-pulse',
      },
    ];

    const startTime = Date.now();
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bearerToken.trim()}`,
          'x-pool-fallback': 'lenient'
        },
        body: payloadJson
      });
      const modelUsed = res.headers.get('x-kc-model-used') || res.headers.get('x-kc-model');
      if (modelUsed && modelUsed !== selectedModel) {
        fallbackModelUsed = modelUsed;
      } else {
        fallbackModelUsed = null;
      }
      
      const latencyMs = Date.now() - startTime;
      simulatedLatency = `${latencyMs}ms`;
      simulatedStatus = `${res.status} ${res.statusText}`;

      if (!res.ok) {
        const errText = await res.text();
        let formattedErr = errText;
        try {
          formattedErr = JSON.stringify(JSON.parse(errText), null, 2);
        } catch {}
        responseChunks = [
          {
            text: formattedErr,
            class: 'text-error text-[11px] font-mono whitespace-pre',
          }
        ];
        isSending = false;
        return;
      }

      if (isStreaming && res.body) {
        responseChunks = [];
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkStr = decoder.decode(value);
          const lines = chunkStr.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              responseChunks = [...responseChunks, { text: line, class: 'text-secondary' }];
            }
          }
        }
      } else {
        const data = await res.text();
        let formattedData = data;
        try {
          formattedData = JSON.stringify(JSON.parse(data), null, 2);
        } catch(e) {}
        
        responseChunks = [
          {
            text: formattedData,
            class: 'text-secondary text-[11px] whitespace-pre',
          }
        ];
      }
    } catch (error) {
      simulatedStatus = 'Error';
      responseChunks = [
        {
          text: String(error),
          class: 'text-error text-[11px]',
        }
      ];
    }
    
    isSending = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSendRequest();
    }
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (exportMenuOpen && target && !target.closest('#exportDropdownContainer')) {
      exportMenuOpen = false;
    }
  }

  const apiDocsMarkdown = $derived(generateApiDocsMarkdown(baseUrl, curlSnippet, tsSnippet, pySnippet));
  const openApiJson = $derived(generateOpenApiJson(baseUrl));

  function downloadOpenAPI() {
    const blob = new Blob([openApiJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'openapi.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    exportMenuOpen = false;
  }

  function downloadMarkdown() {
    const blob = new Blob([apiDocsMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Key_Collective_v3_API_Reference.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    exportMenuOpen = false;
  }

  function handlePrintPdf() {
    exportMenuOpen = false;
    window.print();
  }

  // Live Pricing Data State
  let modelsData = $state<ModelPricingItem[] | null>(null);
  let pricingFilter = $state<'active' | 'all'>('active');

  $effect(() => {
    async function fetchModels() {
      try {
        const res = await fetch('https://key-col.axe08.tech/v1/models');
        if (res.ok) {
          const json = await res.json();
          if (json && Array.isArray(json.data) && json.data.length > 0) {
            modelsData = json.data.map((m: any) => {
              const inputMicro = parseInt(m.pricing?.input_cost_per_mtok_micro || '0', 10);
              const outputMicro = parseInt(m.pricing?.output_cost_per_mtok_micro || '0', 10);
              const input1k = Math.round(inputMicro / 1000);
              const output1k = Math.round(outputMicro / 1000);
              const inputMUsd = (inputMicro / 1000000).toFixed(2);
              const outputMUsd = (outputMicro / 1000000).toFixed(2);
              const isDeprecated = Boolean(m.deprecated || m.deprecated_at);

              let routingEngine = 'Edge Intelligent Routing';
              let bulletClass = 'bg-primary';
              if (isDeprecated) {
                routingEngine = 'Legacy / Deprecated Pool';
                bulletClass = 'bg-amber-500';
              } else if (m.owned_by === 'google') {
                routingEngine = 'Google Edge Direct';
                bulletClass = 'bg-secondary';
              } else if (m.owned_by === 'groq') {
                routingEngine = 'LPU Ultrafast';
                bulletClass = 'bg-primary';
              } else if (m.owned_by === 'anthropic') {
                routingEngine = 'Anthropic Direct';
                bulletClass = 'bg-secondary';
              } else if (m.owned_by === 'openai') {
                routingEngine = 'Azure / OpenAI';
                bulletClass = 'bg-secondary';
              } else if (m.owned_by === 'deepseek') {
                routingEngine = 'Multi-Head Latent';
                bulletClass = 'bg-tertiary';
              }

              return {
                id: m.id,
                owned_by: m.owned_by,
                routing_engine: routingEngine,
                inputCost1kMicro: input1k,
                outputCost1kMicro: output1k,
                inputCostPerMUsd: inputMUsd,
                outputCostPerMUsd: outputMUsd,
                bulletClass,
                isDeprecated,
                sunsetAt: m.sunset_at,
              };
            });
          }
        }
      } catch (err) {
        console.error("Failed to fetch live models pricing:", err);
      }
    }
    fetchModels();
  });
</script>

<svelte:window onkeydown={handleKeydown} onclick={handleClickOutside} />

<div class="space-y-6">
  <!-- Top Documentation Bar & Provider Filter Pills -->
  <div class="rounded-xl bg-surface-container-low/80 backdrop-blur-xl border border-white/[0.08] p-4 specular-top shadow-xl">
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-lg bg-primary-container/20 border border-primary/30 text-primary">
          <span class="material-symbols-outlined" data-icon="terminal">terminal</span>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-headline-sm font-headline-sm font-semibold text-on-surface">API Documentation &amp; Testing Console</h1>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-label-sm bg-secondary-container/20 border border-secondary/30 text-secondary flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span> Ready
            </span>
          </div>
          <p class="text-body-sm font-body-sm text-outline">Low-latency unified proxy gateway for dynamic model failover &amp; key pooling</p>
        </div>
      </div>

      <!-- Export API Docs Button & Dropdown Action -->
      <div class="flex items-center gap-2">
        <div class="relative inline-block text-left" id="exportDropdownContainer">
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg text-label-md font-label-md font-medium text-on-surface bg-surface-container-high border border-outline-variant/40 hover:bg-surface-variant transition-all flex items-center gap-2 active:scale-[0.98] cursor-pointer"
            onclick={() => (exportMenuOpen = !exportMenuOpen)}
          >
            <span class="material-symbols-outlined text-[18px]">download</span>
            <span>Export API Docs</span>
            <span class="material-symbols-outlined text-[16px]">expand_more</span>
          </button>

          {#if exportMenuOpen}
            <div class="origin-top-right absolute right-0 mt-2 w-52 rounded-xl shadow-2xl bg-surface-container-highest border border-outline-variant/50 focus:outline-none z-50 p-1.5 space-y-1">
              <button
                type="button"
                onclick={downloadOpenAPI}
                class="w-full text-left px-3 py-2 text-xs font-code-sm text-on-surface hover:bg-surface-variant rounded-lg flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <span class="material-symbols-outlined text-[16px] text-primary">code</span>
                <span>OpenAPI 3.1 Spec (JSON)</span>
              </button>
              <button
                type="button"
                onclick={downloadMarkdown}
                class="w-full text-left px-3 py-2 text-xs font-code-sm text-on-surface hover:bg-surface-variant rounded-lg flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <span class="material-symbols-outlined text-[16px] text-secondary">description</span>
                <span>Markdown Reference (.md)</span>
              </button>
              <button
                type="button"
                onclick={handlePrintPdf}
                class="w-full text-left px-3 py-2 text-xs font-code-sm text-on-surface hover:bg-surface-variant rounded-lg flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <span class="material-symbols-outlined text-[16px] text-tertiary">picture_as_pdf</span>
                <span>Print / Save as PDF</span>
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Provider Selection Filter Pills -->
    <div class="flex items-center gap-2 mt-4 pt-3 border-t border-outline-variant/20 overflow-x-auto pb-1 custom-scrollbar">
      <span class="text-label-sm font-label-sm text-outline font-mono mr-1">Filter Spec:</span>
      {#each providers as p}
        <button
          type="button"
          onclick={() => (activeProvider = p)}
          class="px-3 py-1 rounded-full text-label-sm font-label-sm transition-all cursor-pointer {activeProvider === p ? 'bg-primary text-on-primary font-medium shadow-sm' : 'bg-surface-container text-outline hover:text-on-surface hover:bg-surface-container-high'}"
        >
          {p}
        </button>
      {/each}
    </div>
  </div>

  <!-- Interactive Live Request Playground -->
  <CodePlayground
    {baseUrl}
    {bearerToken}
    {isSessionToken}
    {selectedModel}
    {isStreaming}
    {activeTab}
    {availableModels}
    bind:payloadJson
    {isSending}
    {simulatedLatency}
    {simulatedStatus}
    {responseChunks}
    {fallbackModelUsed}
    {activeSnippet}
    {copiedSnippet}
    onBearerTokenChange={(val) => (bearerToken = val)}
    onSelectedModelChange={(val) => (selectedModel = val)}
    onStreamingToggle={(val) => (isStreaming = val)}
    onActiveTabChange={(tab) => (activeTab = tab)}
    onPayloadJsonChange={(val) => (payloadJson = val)}
    onSendRequest={handleSendRequest}
    onCopySnippet={() => copyText(activeSnippet, 'snippet')}
  />

  <!-- Live Authoritative Pricing Matrix -->
  <PricingTable
    {modelsData}
    {pricingFilter}
    onFilterChange={(f) => (pricingFilter = f)}
  />

  <!-- Core Gateway Endpoints -->
  <EndpointsList
    {baseUrl}
    {bearerToken}
    {activeProvider}
  />
</div>
