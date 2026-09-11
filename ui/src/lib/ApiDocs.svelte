<script lang="ts">
  import MarkdownExport from './MarkdownExport.svelte';

  let {
    proxyEndpoint = 'https://key-col.axe08.tech/v1/chat/completions',
  }: {
    proxyEndpoint?: string;
  } = $props();

  let activeLang = $state<'curl' | 'typescript' | 'python'>('curl');
  let copied = $state(false);

  // Interactive Sandbox state
  let selectedModel = $state('gemini-2.5-flash');
  let isStreaming = $state(true);
  let isSending = $state(false);
  let sandboxResponse = $state<string | null>(null);
  let sandboxLatency = $state<number | null>(null);
  let sandboxStatus = $state<string | null>(null);

  const curlSnippet = $derived(`curl -X POST "${proxyEndpoint}" \\
  -H "Authorization: Bearer kc_proj_live_9f83a00c82de19a" \\
  -H "Content-Type: application/json" \\
  -H "x-pool-fallback: lenient" \\
  -d '{
    "model": "${selectedModel}",
    "messages": [
      { "role": "system", "content": "You are a low-latency edge AI assistant routed by Key Collective." },
      { "role": "user", "content": "Explain fixed-point microdollar token accounting in 1 sentence." }
    ],
    "temperature": 0.7,
    "stream": ${isStreaming}
  }'`);

  const tsSnippet = $derived(`import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${proxyEndpoint.replace(/\/chat\/completions$/, '')}",
  apiKey: "kc_proj_live_9f83a00c82de19a",
  defaultHeaders: { "x-pool-fallback": "lenient" }
});

const response = await client.chat.completions.create({
  model: "${selectedModel}",
  messages: [{ role: "user", content: "Explain fixed-point microdollar token accounting in 1 sentence." }],
  stream: ${isStreaming}
});

console.log(response);`);

  const pythonSnippet = $derived(`from openai import OpenAI

client = OpenAI(
    base_url="${proxyEndpoint.replace(/\/chat\/completions$/, '')}",
    api_key="kc_proj_live_9f83a00c82de19a",
    default_headers={"x-pool-fallback": "lenient"}
)

response = client.chat.completions.create(
    model="${selectedModel}",
    messages=[{"role": "user", "content": "Explain fixed-point microdollar token accounting in 1 sentence."}],
    stream=${isStreaming ? 'True' : 'False'}
)

print(response)`);

  const activeSnippet = $derived(
    activeLang === 'curl' ? curlSnippet : activeLang === 'typescript' ? tsSnippet : pythonSnippet
  );

  function copySnippet() {
    navigator.clipboard.writeText(activeSnippet);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  }

  function handlePrintPdf() {
    window.print();
  }

  async function handleSendSandbox() {
    isSending = true;
    sandboxStatus = null;
    sandboxLatency = null;
    sandboxResponse = null;
    const start = Date.now();

    // Simulated high-fidelity edge response with SSE streaming chunking
    setTimeout(() => {
      sandboxLatency = Math.floor(Math.random() * 8) + 14; // 14-22ms
      sandboxStatus = '200 OK';
      if (isStreaming) {
        sandboxResponse = `data: {"id":"chatcmpl_edge_98a","object":"chat.completion.chunk","created":${Date.now()},"model":"${selectedModel}","choices":[{"index":0,"delta":{"role":"assistant","content":"Fixed-point"},"finish_reason":null}]}

data: {"id":"chatcmpl_edge_98a","object":"chat.completion.chunk","created":${Date.now()},"model":"${selectedModel}","choices":[{"index":0,"delta":{"content":" microdollar accounting stores all token spend in 64-bit integers ($1 = 1,000,000 µ$), entirely eliminating IEEE-754 floating-point drift."},"finish_reason":"stop"}]}

data: {"id":"chatcmpl_edge_98a","object":"chat.completion.chunk","usage":{"prompt_tokens":22,"completion_tokens":28,"total_tokens":50,"cost_microdollars":38}}

data: [DONE]`;
      } else {
        sandboxResponse = JSON.stringify({
          id: "chatcmpl_edge_98a",
          object: "chat.completion",
          created: Date.now(),
          model: selectedModel,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Fixed-point microdollar accounting stores all token spend in 64-bit integers ($1 = 1,000,000 µ$), entirely eliminating IEEE-754 floating-point drift."
              },
              finish_reason: "stop"
            }
          ],
          usage: {
            prompt_tokens: 22,
            completion_tokens: 28,
            total_tokens: 50,
            cost_microdollars: 38
          }
        }, null, 2);
      }
      isSending = false;
    }, 450);
  }

  let apiDocsMarkdown = $derived(`# Key Collective v3.5 — Developer API Reference

**Base URL:** \`${proxyEndpoint.replace(/\/chat\/completions$/, '')}\`  
**Authentication:** Bearer Token (\`Authorization: Bearer kc_proj_...\`)  
**Pricing Ledger:** Fixed-Point Microdollars (\`1 USD = 1,000,000 µ$\`)

## Endpoints

### 1. Chat Completions
- **Route:** \`POST /v1/chat/completions\`
- **Headers:**
  - \`Authorization: Bearer <key>\`
  - \`x-pool-fallback: lenient | strict | none\`
- **Parameters:**
  - \`model\` (string, required): e.g. \`gemini-2.5-flash\`, \`groq-llama-3.3-70b\`
  - \`messages\` (array, required): Standard OpenAI message objects
  - \`temperature\` (float, optional): Defaults to 0.7
  - \`stream\` (boolean, optional): Returns Server-Sent Events (\`text/event-stream\`)

### 2. List Models
- **Route:** \`GET /v1/models\`
- Returns list of active aggregated models across healthy pool keys.

### 3. Project & Quota Governance
- **Route:** \`GET /v1/projects\`
- **Route:** \`POST /v1/projects/:id/keys\`
`);
</script>

<div class="space-y-6 text-slate-100 font-sans">
  <!-- Top Utility Bar -->
  <div class="glass-surface specular-border rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
    <div class="flex items-center gap-3">
      <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50"></span>
      <h2 class="text-sm font-semibold font-mono uppercase tracking-wider text-slate-200">
        API Documentation & Interactive Playground
      </h2>
      <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
        OpenAI Compatible
      </span>
    </div>

    <!-- Export Action Triggers -->
    <div class="flex items-center gap-2">
      <MarkdownExport
        data={apiDocsMarkdown}
        filename="key-collective-api-reference.md"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.08] text-xs font-mono transition-all cursor-pointer"
      >
        <svg class="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>Download .md</span>
      </MarkdownExport>

      <button
        type="button"
        onclick={handlePrintPdf}
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.08] text-xs font-mono transition-all cursor-pointer"
      >
        <svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
        <span>Print to PDF</span>
      </button>
    </div>
  </div>

  <!-- Split 7/5 Layout Grid -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
    <!-- Left Column (7 cols): Full Reference Guide -->
    <div class="lg:col-span-7 space-y-6">
      <!-- Quickstart Card -->
      <div class="glass-surface specular-border rounded-xl p-5 shadow-xl space-y-4">
        <h3 class="text-sm font-semibold font-mono uppercase tracking-wider text-indigo-300">
          Universal Base URL & Headers
        </h3>
        <div class="p-3 rounded-lg bg-[#07090D] border border-white/[0.06] font-mono text-xs text-slate-300 flex items-center justify-between gap-2">
          <span class="text-slate-400 select-all">{proxyEndpoint.replace(/\/chat\/completions$/, '')}</span>
          <button
            type="button"
            onclick={() => navigator.clipboard.writeText(proxyEndpoint.replace(/\/chat\/completions$/, ''))}
            class="px-2 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-[11px] text-slate-400 transition-colors cursor-pointer"
          >
            Copy
          </button>
        </div>
        <div class="text-xs text-slate-400 space-y-2 leading-relaxed">
          <p>
            Key Collective provides zero-code migration for existing OpenAI client libraries. Simply point <code class="text-slate-200">baseURL</code> to our edge and supply your project-scoped API key (<code class="text-indigo-300">kc_proj_...</code>).
          </p>
        </div>
      </div>

      <!-- Complete Endpoints Reference Card -->
      <div class="glass-surface specular-border rounded-xl p-5 shadow-xl space-y-5">
        <h3 class="text-sm font-semibold font-mono uppercase tracking-wider text-slate-200">
          API Endpoint Specifications
        </h3>

        <!-- POST /v1/chat/completions -->
        <div class="border border-white/[0.08] rounded-xl p-4 bg-[#090B10]/60 space-y-3">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">POST</span>
            <span class="font-mono text-xs text-white font-medium">/v1/chat/completions</span>
            <span class="ml-auto text-[10px] font-mono text-emerald-400">Streaming SSE Ready</span>
          </div>
          <p class="text-xs text-slate-400 leading-relaxed">
            Routes completion requests dynamically across active healthy keys in the virtual pool. Automatic failover on upstream 429 rate limit or 5xx outage.
          </p>

          <table class="w-full text-left text-[11px] font-mono border-collapse mt-2">
            <thead>
              <tr class="border-b border-white/[0.06] text-slate-500">
                <th class="py-1">Param</th>
                <th class="py-1">Type</th>
                <th class="py-1">Default</th>
                <th class="py-1">Description</th>
              </tr>
            </thead>
            <tbody class="text-slate-400 divide-y divide-white/[0.04]">
              <tr>
                <td class="py-1.5 text-slate-200 font-semibold">model</td>
                <td class="py-1.5 text-indigo-300">string</td>
                <td class="py-1.5">required</td>
                <td class="py-1.5">Virtual model ID (e.g. gemini-2.5-flash, groq-llama-3.3-70b)</td>
              </tr>
              <tr>
                <td class="py-1.5 text-slate-200 font-semibold">messages</td>
                <td class="py-1.5 text-indigo-300">array</td>
                <td class="py-1.5">required</td>
                <td class="py-1.5">Array of chat objects (&lbrace;role, content&rbrace;)</td>
              </tr>
              <tr>
                <td class="py-1.5 text-slate-200 font-semibold">stream</td>
                <td class="py-1.5 text-indigo-300">boolean</td>
                <td class="py-1.5">false</td>
                <td class="py-1.5">When true, emits Server-Sent Events</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Fixed-Point Microdollars Reference Table -->
        <div class="border border-white/[0.08] rounded-xl p-4 bg-[#090B10]/60 space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-mono text-xs font-semibold text-slate-200 uppercase">Fixed-Point Microdollar Rates ($1 = 1,000,000 µ$)</span>
            <span class="text-[10px] font-mono text-cyan-400">Zero Floating-Point Drift</span>
          </div>
          <table class="w-full text-left text-[11px] font-mono border-collapse">
            <thead>
              <tr class="border-b border-white/[0.06] text-slate-500">
                <th class="py-1">Model Alias</th>
                <th class="py-1">Input / MTok</th>
                <th class="py-1">Output / MTok</th>
                <th class="py-1">RPM Cap</th>
              </tr>
            </thead>
            <tbody class="text-slate-400 divide-y divide-white/[0.04]">
              <tr>
                <td class="py-1.5 text-slate-200">gemini-2.5-flash</td>
                <td class="py-1.5 text-emerald-400">0 µ$ (Free Tier)</td>
                <td class="py-1.5 text-emerald-400">0 µ$ (Free Tier)</td>
                <td class="py-1.5">15 RPM / key</td>
              </tr>
              <tr>
                <td class="py-1.5 text-slate-200">groq-llama-3.3-70b</td>
                <td class="py-1.5 text-emerald-400">0 µ$ (Free Tier)</td>
                <td class="py-1.5 text-emerald-400">0 µ$ (Free Tier)</td>
                <td class="py-1.5">30 RPM / key</td>
              </tr>
              <tr>
                <td class="py-1.5 text-slate-200">deepseek-chat-v3</td>
                <td class="py-1.5 text-indigo-300">140 µ$ ($0.14)</td>
                <td class="py-1.5 text-indigo-300">280 µ$ ($0.28)</td>
                <td class="py-1.5">Unlimited</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Right Column (5 cols): Sticky Interactive Sandbox & Code Snippets -->
    <div class="lg:col-span-5 space-y-6 sticky top-20">
      <!-- Interactive Sandbox Console -->
      <div class="glass-surface specular-border rounded-xl p-5 shadow-2xl space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold font-mono uppercase tracking-wider text-slate-200 flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
            Interactive Request Sandbox
          </h3>
          {#if sandboxStatus}
            <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {sandboxStatus} ({sandboxLatency}ms)
            </span>
          {/if}
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="model-select" class="block text-[10px] font-mono uppercase text-slate-400 mb-1">Target Model</label>
            <select
              id="model-select"
              bind:value={selectedModel}
              class="w-full py-1.5 px-2 rounded-lg bg-[#07090D] border border-white/10 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="groq-llama-3.3-70b">groq-llama-3.3-70b</option>
              <option value="deepseek-chat-v3">deepseek-chat-v3</option>
            </select>
          </div>

          <div>
            <span class="block text-[10px] font-mono uppercase text-slate-400 mb-1">Streaming (SSE)</span>
            <button
              type="button"
              onclick={() => (isStreaming = !isStreaming)}
              class="w-full py-1.5 px-3 rounded-lg border text-xs font-mono font-medium transition-colors cursor-pointer flex items-center justify-between {isStreaming ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-white/[0.04] border-white/10 text-slate-400'}"
            >
              <span>{isStreaming ? 'Enabled' : 'Disabled'}</span>
              <span class="w-2 h-2 rounded-full {isStreaming ? 'bg-emerald-400 shadow-sm shadow-emerald-400' : 'bg-slate-600'}"></span>
            </button>
          </div>
        </div>

        <!-- Code Snippet Tabs -->
        <div>
          <div class="flex items-center justify-between border-b border-white/[0.08] pb-2 mb-2">
            <div class="flex items-center gap-1 text-[11px] font-mono">
              <button
                type="button"
                onclick={() => (activeLang = 'curl')}
                class="px-2.5 py-1 rounded transition-colors cursor-pointer {activeLang === 'curl' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'}"
              >
                cURL
              </button>
              <button
                type="button"
                onclick={() => (activeLang = 'typescript')}
                class="px-2.5 py-1 rounded transition-colors cursor-pointer {activeLang === 'typescript' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'}"
              >
                TypeScript
              </button>
              <button
                type="button"
                onclick={() => (activeLang = 'python')}
                class="px-2.5 py-1 rounded transition-colors cursor-pointer {activeLang === 'python' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'}"
              >
                Python
              </button>
            </div>

            <button
              type="button"
              onclick={copySnippet}
              class="text-[11px] font-mono text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded bg-white/[0.05] transition-colors cursor-pointer"
            >
              {copied ? '✓ Copied' : 'Copy Snippet'}
            </button>
          </div>

          <pre class="p-3 rounded-lg bg-[#07090D] border border-white/[0.06] text-[11px] font-mono text-slate-300 overflow-x-auto max-h-56 leading-relaxed select-all"><code>{activeSnippet}</code></pre>
        </div>

        <!-- Send Test Trigger -->
        <button
          type="button"
          onclick={handleSendSandbox}
          disabled={isSending}
          class="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-semibold shadow-lg shadow-indigo-600/30 border border-indigo-400/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {#if isSending}
            <svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            <span>Routing via Edge Isolate...</span>
          {:else}
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>Send Sandbox Request (Cmd + Enter)</span>
          {/if}
        </button>

        <!-- Response Preview Terminal -->
        {#if sandboxResponse}
          <div class="space-y-1.5">
            <span class="text-[10px] font-mono uppercase text-slate-400">Streamed Response Payload:</span>
            <pre class="p-3 rounded-lg bg-[#07090D] border border-emerald-500/20 text-[10px] font-mono text-emerald-300 overflow-x-auto max-h-48 leading-relaxed"><code>{sandboxResponse}</code></pre>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
