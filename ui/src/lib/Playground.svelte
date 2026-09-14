<script lang="ts">
  import { onMount } from 'svelte';
  import { type Microdollars, formatMicrodollars } from './types';

  let {
    proxyEndpoint = 'https://key-col.axe08.tech/v1/chat/completions',
    onRefreshMetrics,
  }: {
    proxyEndpoint?: string;
    onRefreshMetrics?: () => void;
  } = $props();

  const baseUrl = $derived(proxyEndpoint.replace(/\/chat\/completions$/, ''));

  let bearerToken = $state('kc_proj_live_9f83a00c82de19a');
  let isSessionToken = $state(false);
  let selectedModel = $state('gemini-3.8-flash');
  let isStreaming = $state(true);
  let activeTab = $state<'curl' | 'ts' | 'py'>('curl');

  let availableModels = $state<{ id: string; provider: string }[]>([
    { id: 'gemini-3.8-flash', provider: 'google' },
    { id: 'gemini-3.5-flash', provider: 'google' },
    { id: 'gemini-3.5-flash-lite', provider: 'google' },
    { id: 'gemini-3.1-pro-preview', provider: 'google' },
    { id: 'gemini-2.5-flash', provider: 'google' },
    { id: 'qwen/qwen3.8-27b', provider: 'groq' },
    { id: 'qwen/qwen3.6-27b', provider: 'groq' },
    { id: 'openai/gpt-oss-120b', provider: 'groq' },
    { id: 'openai/gpt-oss-20b', provider: 'groq' },
    { id: 'deepseek/deepseek-r1-distill-llama-70b', provider: 'deepseek' },
    { id: 'Meta-Llama-3.1-405B-Instruct', provider: 'sambanova' },
    { id: 'llama3.1-70b', provider: 'cerebras' },
  ]);

  onMount(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('kc_auth_token');
      if (stored && stored.trim().length > 0) {
        bearerToken = stored.trim();
        isSessionToken = true;
      }
      fetch('/v1/models')
        .then((r) => r.json())
        .then((data) => {
          if (data && Array.isArray(data.data) && data.data.length > 0) {
            availableModels = data.data.map((m: any) => ({
              id: m.id,
              provider: m.owned_by || m.provider || 'custom',
            }));
            if (!availableModels.some((m) => m.id === selectedModel)) {
              selectedModel = availableModels[0].id;
            }
          }
        })
        .catch(() => {});
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
    } catch {}
  });

  let isSending = $state(false);
  let fallbackModelUsed = $state<string | null>(null);
  let liveLatency = $state<string>('0ms');
  let liveStatus = $state<string>('Ready');
  let liveCostMicros = $state<number>(0);
  let responseChunks = $state<Array<{ text: string; class: string }>>([]);

  const curlSnippet = $derived(`curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${bearerToken}" \\
  -H "x-pool-fallback: lenient" \\
  -d '{
    "model": "${selectedModel}",
    "messages": [{"role": "user", "content": "Ping!"}],
    "stream": ${isStreaming}
  }'`);

  const tsSnippet = $derived(`import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '${bearerToken}',
  baseURL: '${baseUrl}',
  defaultHeaders: { 'x-pool-fallback': 'lenient' }
});

const response = await client.chat.completions.create({
  model: '${selectedModel}',
  messages: [{ role: 'user', content: 'Ping!' }],
  stream: ${isStreaming},
});`);

  const pySnippet = $derived(`from openai import OpenAI

client = OpenAI(
    api_key="${bearerToken}",
    base_url="${baseUrl}",
    default_headers={"x-pool-fallback": "lenient"}
)

stream = client.chat.completions.create(
    model="${selectedModel}",
    messages=[{"role": "user", "content": "Ping!"}],
    stream=${isStreaming ? 'True' : 'False'}
)`);

  const activeSnippet = $derived(
    activeTab === 'curl' ? curlSnippet : activeTab === 'ts' ? tsSnippet : pySnippet
  );

  let copiedSnippet = $state(false);
  function copySnippet() {
    navigator.clipboard.writeText(activeSnippet);
    copiedSnippet = true;
    setTimeout(() => (copiedSnippet = false), 2000);
  }

  async function handleSendRequest() {
    if (isSending) return;
    isSending = true;
    liveLatency = '...';
    liveStatus = 'Routing...';
    responseChunks = [
      {
        text: `[Connecting to regional edge isolate with model: ${selectedModel}...]`,
        class: 'text-outline text-xs animate-pulse font-mono',
      },
    ];

    const startTime = Date.now();
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearerToken.trim()}`,
          'x-pool-fallback': 'lenient',
        },
        body: payloadJson,
      });

      const latency = Date.now() - startTime;
      liveLatency = `${latency}ms`;
      liveStatus = `${res.status} ${res.statusText}`;

      const modelUsed = res.headers.get('x-kc-model-used') || res.headers.get('x-kc-model');
      if (modelUsed && modelUsed !== selectedModel) {
        fallbackModelUsed = modelUsed;
      } else {
        fallbackModelUsed = null;
      }

      const costHeader = res.headers.get('x-request-cost-micros');
      if (costHeader) {
        liveCostMicros = parseInt(costHeader, 10) || 0;
      }

      if (!res.ok) {
        const errText = await res.text();
        let formattedErr = errText;
        try {
          formattedErr = JSON.stringify(JSON.parse(errText), null, 2);
        } catch {}
        responseChunks = [
          {
            text: formattedErr,
            class: 'text-error text-xs font-mono whitespace-pre-wrap',
          },
        ];
        isSending = false;
        if (onRefreshMetrics) onRefreshMetrics();
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
              responseChunks = [...responseChunks, { text: line, class: 'text-secondary font-mono text-xs' }];
            }
          }
        }
      } else {
        const data = await res.text();
        let formattedData = data;
        try {
          formattedData = JSON.stringify(JSON.parse(data), null, 2);
        } catch {}
        responseChunks = [
          {
            text: formattedData,
            class: 'text-secondary text-xs whitespace-pre-wrap font-mono',
          },
        ];
      }

      if (onRefreshMetrics) {
        onRefreshMetrics();
      }
    } catch (err: any) {
      liveStatus = 'Error';
      liveLatency = `${Date.now() - startTime}ms`;
      responseChunks = [
        {
          text: String(err?.message || err),
          class: 'text-error text-xs font-mono',
        },
      ];
    } finally {
      isSending = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSendRequest();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="space-y-6">
  <!-- Header Bar -->
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

  <!-- Playground Grid -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
    <!-- Left Configuration Panel (5 Cols) -->
    <div class="lg:col-span-5 space-y-5">
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
          onclick={handleSendRequest}
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

      <!-- Code Snippets Tab Box -->
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
            onclick={copySnippet}
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
    </div>

    <!-- Right Response & Stream Output Panel (7 Cols) -->
    <div class="lg:col-span-7 space-y-4">
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
    </div>
  </div>
</div>
