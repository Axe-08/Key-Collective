<script lang="ts">
  import { type Microdollars, formatMicrodollars } from './types';

  let {
    proxyEndpoint = 'https://key-col.axe08.tech/v1/chat/completions',
  }: {
    proxyEndpoint?: string;
  } = $props();

  // Base URL derived from endpoint
  const baseUrl = $derived(proxyEndpoint.replace(/\/chat\/completions$/, ''));

  // Target provider filter state
  type ProviderFilter = 'OpenAI Compatible' | 'Anthropic' | 'Gemini' | 'Groq' | 'DeepSeek';
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
  let selectedModel = $state('gemini-2.5-flash');
  let isStreaming = $state(true);
  let activeTab = $state<'curl' | 'ts' | 'py'>('curl');

  // Request execution & response state
  let isSending = $state(false);
  let simulatedLatency = $state('18ms');
  let simulatedStatus = $state('200 OK');
  let responseChunks = $state<Array<{ text: string; class: string }>>([
    {
      text: 'data: {"id":"chatcmpl-94k2","object":"chat.completion.chunk","created":17109210,"model":"gemini-2.5-flash","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}',
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

  function handleSendRequest() {
    if (isSending) return;
    isSending = true;
    simulatedLatency = '...';
    responseChunks = [
      {
        text: `Establishing edge websocket tunnel to ${selectedModel}...`,
        class: 'text-outline text-[11px] animate-pulse',
      },
    ];

    setTimeout(() => {
      const latencyMs = Math.floor(Math.random() * 15) + 14;
      simulatedLatency = `${latencyMs}ms`;
      simulatedStatus = '200 OK';

      if (isStreaming) {
        responseChunks = [
          {
            text: `data: {"id":"chatcmpl-live","model":"${selectedModel}","router_node":"iad-01"}`,
            class: 'text-outline text-[10px]',
          },
          { text: 'data: {"choices":[{"delta":{"content":"Live"}}]}', class: 'text-secondary' },
          { text: 'data: {"choices":[{"delta":{"content":" synthesis"}}]}', class: 'text-secondary' },
          { text: 'data: {"choices":[{"delta":{"content":" complete."}}]}', class: 'text-secondary' },
          {
            text: `Summary: Live synthesis complete via ${selectedModel} in ${latencyMs}ms.`,
            class: 'text-on-surface-variant text-[11px] pt-1 font-sans',
          },
          {
            text: 'data: [DONE]   •   deducted: 18 µ$',
            class: 'text-outline text-[10px] pt-1 border-t border-outline-variant/20',
          },
        ];
      } else {
        responseChunks = [
          {
            text: JSON.stringify(
              {
                id: 'chatcmpl-live-sync',
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: selectedModel,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: `Handshake verified. Response synthesized via ${selectedModel} edge router.`,
                    },
                    finish_reason: 'stop',
                  },
                ],
                usage: {
                  prompt_tokens: 12,
                  completion_tokens: 14,
                  total_tokens: 26,
                  cost_microdollars: 18,
                },
              },
              null,
              2
            ),
            class: 'text-secondary text-[11px] whitespace-pre',
          },
          {
            text: 'status: complete   •   deducted: 18 µ$',
            class: 'text-outline text-[10px] pt-1 border-t border-outline-variant/20',
          },
        ];
      }
      isSending = false;
    }, 420);
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

  const apiDocsMarkdown = $derived(`# Key Collective v3 — Developer API Reference

**Base URL:** \`${baseUrl}\`  
**Authentication:** Bearer Token (\`Authorization: Bearer kc_live_...\`)  
**Pricing Ledger:** Fixed-Point Microdollars (\`1 USD = 1,000,000 µ$\`)  
**Gateway Latency:** P99 18.4ms

---

## 1. Quickstart & Headers

Send all requests through edge proxies deployed at 28 tier-1 exchanges.

### Request Headers
- \`Authorization: Bearer <key>\` (Required) — Master or scoped ephemeral key.
- \`Content-Type: application/json\` (Required)
- \`x-pool-fallback: lenient | strict | none\` (Optional) — Automatic failover policy.

---

## 2. API Endpoints

### POST \`/v1/chat/completions\`
Creates a completion request routed dynamically across virtualized pools. Automatically alternates real upstream keys, handling rate-limit backoff under 20ms.

#### Parameters
| Field | Type | Default | Description |
|---|---|---|---|
| \`model\` | string | required | Model alias (e.g. \`gemini-2.5-flash\`, \`groq-llama-3.3-70b\`) or wildcard \`auto-fastest\` |
| \`messages\` | array[obj] | required | Array of \`{ role, content }\` chat objects |
| \`stream\` | boolean | \`false\` | Streams partial deltas via Server-Sent Events (SSE) |
| \`fallback_cascade\` | array[str] | \`["auto"]\` | Fallback model sequence if primary key or provider fails |
| \`temperature\` | float | \`0.7\` | Sampling temperature (0.0 to 2.0) |

### GET \`/v1/models\`
Lists all unified active models configured across connected provider pools (Gemini, Groq, Cerebras, DeepSeek, OpenAI) with current load metrics and cost parameters.

### GET \`/v1/projects\`
Inspects workspace hierarchy, team quotas, remaining microdollar balances (µ$), and rate-limit tier thresholds.

### POST \`/v1/projects/:id/keys\`
Generates a new project-scoped virtual key with custom TTL, model white-lists, and token expenditure limits.

### GET \`/v1/health\` & \`/v1/telemetry\`
Retrieves live health status across all upstream nodes, active circuit breaker trips, and 60-second moving average edge latency.

---

## 3. Fixed-Point Microdollar Pricing Reference (µ$)

*Zero floating-point rounding errors. 1.00 USD = exactly 1,000,000 µ$.*  
*Base: 1 µ$ = $0.000001 USD.*

| Model | Input / 1K Tokens | Output / 1K Tokens | Effective USD / 1M | Routing Engine |
|---|---|---|---|---|
| Gemini 2.5 Flash | 75 µ$ | 300 µ$ | $0.075 / $0.30 | Google Edge Direct |
| Groq LLaMA 3.3 (70B) | 590 µ$ | 790 µ$ | $0.59 / $0.79 | LPU Ultrafast |
| DeepSeek V3 | 140 µ$ | 280 µ$ | $0.14 / $0.28 | Multi-Head Latent |

---

## 4. Code Examples

### cURL
\`\`\`bash
${curlSnippet}
\`\`\`

### TypeScript (OpenAI SDK)
\`\`\`typescript
${tsSnippet}
\`\`\`

### Python (OpenAI SDK)
\`\`\`python
${pySnippet}
\`\`\`
`);

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
            <span class="material-symbols-outlined" data-icon="file_download">file_download</span>
            <span>Export API Docs</span>
            <span class="material-symbols-outlined text-outline" data-icon="expand_more">expand_more</span>
          </button>

          <!-- Dropdown Menu -->
          {#if exportMenuOpen}
            <div class="absolute right-0 mt-2 w-56 rounded-xl bg-surface-container-high/95 backdrop-blur-2xl border border-white/10 shadow-2xl z-50 py-1">
              <button
                type="button"
                class="w-full px-4 py-2 text-left text-label-md font-label-md text-on-surface hover:bg-surface-variant flex items-center gap-2 transition-colors cursor-pointer"
                onclick={downloadMarkdown}
              >
                <span class="material-symbols-outlined text-primary" data-icon="description">description</span>
                <span>Download Markdown (.md)</span>
              </button>
              <button
                type="button"
                class="w-full px-4 py-2 text-left text-label-md font-label-md text-on-surface hover:bg-surface-variant flex items-center gap-2 transition-colors cursor-pointer"
                onclick={handlePrintPdf}
              >
                <span class="material-symbols-outlined text-tertiary" data-icon="picture_as_pdf">picture_as_pdf</span>
                <span>Export PDF</span>
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Filter Pills Bar -->
    <div class="mt-4 pt-3 border-t border-outline-variant/20 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2 overflow-x-auto custom-scroll pb-1">
        <span class="text-label-sm font-label-sm uppercase tracking-wider text-outline mr-1">Target Provider:</span>
        {#each providers as provider}
          <button
            type="button"
            onclick={() => (activeProvider = provider)}
            class="px-2.5 py-1 rounded-full text-label-sm font-label-sm transition-colors cursor-pointer flex items-center gap-1.5 {activeProvider === provider
              ? 'bg-primary/20 border border-primary/50 text-primary font-semibold'
              : 'bg-surface-container-highest/60 border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'}"
          >
            {#if activeProvider === provider}
              <span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
            {/if}
            <span>{provider}</span>
          </button>
        {/each}
      </div>
      <div class="flex items-center gap-2 text-label-sm font-label-sm text-outline">
        <span class="material-symbols-outlined text-xs" data-icon="speed">speed</span>
        <span>Edge Gateway P99: <strong class="text-secondary font-code-sm">18.4ms</strong></span>
      </div>
    </div>
  </div>

  <!-- Split Layout: 7 Columns Left / 5 Columns Right -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
    <!-- ================= LEFT COLUMN (7 Cols): Docs & Spec ================= -->
    <div class="lg:col-span-7 space-y-6">
      <!-- 2. Getting Started & Quickstart Guide -->
      <section class="rounded-xl bg-surface-container-low/70 backdrop-blur-xl border border-white/[0.07] p-5 specular-top" id="quickstart">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-primary" data-icon="bolt">bolt</span>
            <h2 class="text-headline-sm font-headline-sm text-on-surface font-semibold">Getting Started &amp; Quickstart</h2>
          </div>
          <span class="text-label-sm font-label-sm text-outline">Authentication Protocol</span>
        </div>
        <p class="text-body-md font-body-md text-on-surface-variant mb-4">
          All requests are routed through edge proxies deployed at 28 tier-1 exchanges. Route your standard OpenAI, Anthropic, or native SDK calls directly to the Key Collective base URL.
        </p>

        <!-- Base URL Box -->
        <div class="mb-4">
          <span class="block text-label-sm font-label-sm uppercase tracking-wider text-outline mb-1.5">Universal Gateway Base URL</span>
          <div class="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/30 font-code-md text-code-md text-on-surface">
            <span class="text-primary font-medium">{baseUrl}</span>
            <button
              type="button"
              class="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-variant transition-all cursor-pointer flex items-center gap-1"
              onclick={() => copyText(baseUrl, 'url')}
              title="Copy URL"
            >
              {#if copiedBaseUrl}
                <span class="material-symbols-outlined text-secondary text-sm" data-icon="check">check</span>
                <span class="text-[10px] text-secondary font-code-sm">Copied!</span>
              {:else}
                <span class="material-symbols-outlined text-sm" data-icon="content_copy">content_copy</span>
              {/if}
            </button>
          </div>
        </div>

        <!-- Headers Specification -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="p-3 rounded-lg bg-surface-container-lowest/80 border border-outline-variant/20">
            <div class="flex items-center justify-between text-label-sm font-label-sm text-outline mb-1">
              <span>Standard Authorization Header</span>
              <span class="text-secondary">Required</span>
            </div>
            <code class="block font-code-sm text-code-sm text-on-surface bg-surface-container-low/80 p-1.5 rounded border border-outline-variant/20">
              Authorization: Bearer kc_live_...
            </code>
            <p class="text-[11px] font-body-sm text-outline mt-1.5">Pass your virtualized project pool master or scoped ephemeral key.</p>
          </div>

          <div class="p-3 rounded-lg bg-surface-container-lowest/80 border border-outline-variant/20">
            <div class="flex items-center justify-between text-label-sm font-label-sm text-outline mb-1">
              <span>Routing Fallback Policy</span>
              <span class="text-primary">Custom Header</span>
            </div>
            <code class="block font-code-sm text-code-sm text-on-surface bg-surface-container-low/80 p-1.5 rounded border border-outline-variant/20">
              x-pool-fallback: lenient
            </code>
            <p class="text-[11px] font-body-sm text-outline mt-1.5">Automatic failover to next provider tier if upstream returns 429 or 503.</p>
          </div>
        </div>
      </section>

      <!-- 3. Complete Endpoint Documentation -->
      <section class="space-y-4" id="endpoints">
        <div class="flex items-center justify-between">
          <h2 class="text-headline-sm font-headline-sm text-on-surface font-semibold flex items-center gap-2">
            <span class="material-symbols-outlined text-secondary" data-icon="dns">dns</span>
            <span>Virtual Edge Endpoints</span>
          </h2>
          <span class="text-label-sm font-label-sm text-outline">REST &amp; Streaming SSE</span>
        </div>

        <!-- Endpoint 1: POST /v1/chat/completions (Expanded Detail) -->
        <div class="rounded-xl bg-surface-container-low/70 backdrop-blur-xl border border-white/[0.08] overflow-hidden specular-top" id="chat-completions">
          <div class="p-4 border-b border-outline-variant/20 flex flex-wrap items-center justify-between gap-2 bg-surface-container-low/90">
            <div class="flex items-center gap-2.5">
              <span class="px-2 py-0.5 rounded text-code-sm font-code-sm font-semibold bg-primary-container text-on-primary-container">POST</span>
              <code class="font-code-md text-code-md text-on-surface font-semibold">/v1/chat/completions</code>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-label-sm bg-secondary-container/20 text-secondary border border-secondary/30">SSE Supported</span>
            </div>
            <span class="text-label-sm font-label-sm text-outline">OpenAI Compliant</span>
          </div>

          <div class="p-4 space-y-4">
            <p class="text-body-md font-body-md text-on-surface-variant">
              Creates a completion request routed dynamically across virtualized pools. Automatically decrypts and alternates real upstream API keys, handling rate-limit backoff under 20ms.
            </p>

            <!-- Parameter Table -->
            <div>
              <div class="text-label-sm font-label-sm uppercase tracking-wider text-outline mb-2">Request Body Parameters</div>
              <div class="overflow-x-auto">
                <table class="w-full text-left text-body-sm font-body-sm border-collapse">
                  <thead>
                    <tr class="border-b border-outline-variant/30 text-label-sm font-label-sm text-outline">
                      <th class="py-2 pr-3">Field</th>
                      <th class="py-2 px-3">Type</th>
                      <th class="py-2 px-3">Default</th>
                      <th class="py-2 pl-3">Description</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-outline-variant/15 font-code-sm text-code-sm">
                    <tr>
                      <td class="py-2.5 pr-3 font-semibold text-primary">
                        model <span class="text-[10px] text-error font-body-sm">*req</span>
                      </td>
                      <td class="py-2.5 px-3 text-outline">string</td>
                      <td class="py-2.5 px-3 text-outline">—</td>
                      <td class="py-2.5 pl-3 font-body-sm text-on-surface-variant">
                        Aggregated alias (e.g. <code class="text-secondary">gemini-2.5-flash</code>, <code class="text-secondary">groq-llama-3.3-70b</code>) or wildcard <code class="text-primary">auto-fastest</code>.
                      </td>
                    </tr>
                    <tr>
                      <td class="py-2.5 pr-3 font-semibold text-primary">
                        messages <span class="text-[10px] text-error font-body-sm">*req</span>
                      </td>
                      <td class="py-2.5 px-3 text-outline">array[obj]</td>
                      <td class="py-2.5 px-3 text-outline">—</td>
                      <td class="py-2.5 pl-3 font-body-sm text-on-surface-variant">
                        Array of role-content message objects conforming to standard Chat format.
                      </td>
                    </tr>
                    <tr>
                      <td class="py-2.5 pr-3 text-on-surface">stream</td>
                      <td class="py-2.5 px-3 text-outline">boolean</td>
                      <td class="py-2.5 px-3 text-secondary">false</td>
                      <td class="py-2.5 pl-3 font-body-sm text-on-surface-variant">
                        If true, streams partial message deltas formatted as standard Server-Sent Events (SSE).
                      </td>
                    </tr>
                    <tr>
                      <td class="py-2.5 pr-3 text-on-surface">fallback_cascade</td>
                      <td class="py-2.5 px-3 text-outline">array[str]</td>
                      <td class="py-2.5 px-3 text-outline">["auto"]</td>
                      <td class="py-2.5 pl-3 font-body-sm text-on-surface-variant">
                        Priority list of fallback models executed when first model encounters downstream outage or 429 quota exhaustion.
                      </td>
                    </tr>
                    <tr>
                      <td class="py-2.5 pr-3 text-on-surface">temperature</td>
                      <td class="py-2.5 px-3 text-outline">float</td>
                      <td class="py-2.5 px-3 text-outline">0.7</td>
                      <td class="py-2.5 pl-3 font-body-sm text-on-surface-variant">
                        Sampling temperature between 0.0 and 2.0.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- Endpoint 2: GET /v1/models -->
        <div class="rounded-xl bg-surface-container-low/70 backdrop-blur-xl border border-white/[0.08] p-4 specular-top" id="models">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2.5">
              <span class="px-2 py-0.5 rounded text-code-sm font-code-sm font-semibold bg-secondary-container/80 text-on-secondary-fixed">GET</span>
              <code class="font-code-md text-code-md text-on-surface font-semibold">/v1/models</code>
            </div>
            <span class="text-label-sm font-label-sm text-outline">Model Discovery</span>
          </div>
          <p class="text-body-sm font-body-sm text-on-surface-variant">
            Lists all unified active models configured across connected provider pools (Gemini, Groq, Cerebras, DeepSeek, OpenAI) with current load metrics and cost parameters.
          </p>
        </div>

        <!-- Endpoint 3: GET /v1/projects -->
        <div class="rounded-xl bg-surface-container-low/70 backdrop-blur-xl border border-white/[0.08] p-4 specular-top">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2.5">
              <span class="px-2 py-0.5 rounded text-code-sm font-code-sm font-semibold bg-secondary-container/80 text-on-secondary-fixed">GET</span>
              <code class="font-code-md text-code-md text-on-surface font-semibold">/v1/projects</code>
            </div>
            <span class="text-label-sm font-label-sm text-outline">Multi-Tenant Quotas</span>
          </div>
          <p class="text-body-sm font-body-sm text-on-surface-variant">
            Inspects workspace hierarchy, team quotas, remaining microdollar balances (µ$), and rate-limit tier thresholds.
          </p>
        </div>

        <!-- Endpoint 4: POST /v1/projects/:id/keys -->
        <div class="rounded-xl bg-surface-container-low/70 backdrop-blur-xl border border-white/[0.08] p-4 specular-top">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2.5">
              <span class="px-2 py-0.5 rounded text-code-sm font-code-sm font-semibold bg-primary-container text-on-primary-container">POST</span>
              <code class="font-code-md text-code-md text-on-surface font-semibold">/v1/projects/:id/keys</code>
            </div>
            <span class="text-label-sm font-label-sm text-outline">Key Rotation</span>
          </div>
          <p class="text-body-sm font-body-sm text-on-surface-variant">
            Generates a new project-scoped virtual key with custom TTL, model white-lists, and max token expenditure ceilings.
          </p>
        </div>

        <!-- Endpoint 5: Health & Telemetry -->
        <div class="rounded-xl bg-surface-container-low/70 backdrop-blur-xl border border-white/[0.08] p-4 specular-top" id="circuit-breaker">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2.5">
              <span class="px-2 py-0.5 rounded text-code-sm font-code-sm font-semibold bg-secondary-container/80 text-on-secondary-fixed">GET</span>
              <code class="font-code-md text-code-md text-on-surface font-semibold">/v1/health &amp; /v1/telemetry</code>
            </div>
            <span class="text-label-sm font-label-sm text-secondary">Real-Time Circuit</span>
          </div>
          <p class="text-body-sm font-body-sm text-on-surface-variant">
            Retrieves live health status across all upstream nodes, active circuit breaker trips, and 60-second moving average edge latency per geographical region.
          </p>
        </div>
      </section>

      <!-- 5. Fixed-Point Microdollar Pricing Reference ($1 = 1,000,000 µ$) -->
      <section class="rounded-xl bg-surface-container-low/70 backdrop-blur-xl border border-white/[0.08] p-5 specular-top" id="pricing-matrix">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h3 class="text-headline-sm font-headline-sm text-on-surface font-semibold flex items-center gap-2">
              <span class="material-symbols-outlined text-tertiary" data-icon="toll">toll</span>
              <span>Fixed-Point Microdollar Pricing (µ$)</span>
            </h3>
            <p class="text-body-sm font-body-sm text-outline">Zero floating-point rounding errors. 1.00 USD = exactly 1,000,000 µ$.</p>
          </div>
          <div class="px-3 py-1 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-code-sm font-code-sm text-tertiary">
            Base: 1 µ$ = $0.000001 USD
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-body-sm font-body-sm border-collapse">
            <thead>
              <tr class="border-b border-outline-variant/30 text-label-sm font-label-sm text-outline">
                <th class="py-2.5 pr-3">Model</th>
                <th class="py-2.5 px-3">Input / 1K Tokens</th>
                <th class="py-2.5 px-3">Output / 1K Tokens</th>
                <th class="py-2.5 px-3">Effective USD / 1M</th>
                <th class="py-2.5 pl-3">Routing Engine</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-outline-variant/15 font-code-sm text-code-sm">
              <tr class="hover:bg-white/[0.02] transition-colors">
                <td class="py-3 pr-3 font-semibold text-on-surface flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full bg-secondary"></span>
                  <span>Gemini 2.5 Flash</span>
                </td>
                <td class="py-3 px-3 text-secondary">75 µ$</td>
                <td class="py-3 px-3 text-secondary">300 µ$</td>
                <td class="py-3 px-3 text-on-surface">$0.075 / $0.30</td>
                <td class="py-3 pl-3 text-outline">Google Edge Direct</td>
              </tr>
              <tr class="hover:bg-white/[0.02] transition-colors">
                <td class="py-3 pr-3 font-semibold text-on-surface flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full bg-primary"></span>
                  <span>Groq LLaMA 3.3 (70B)</span>
                </td>
                <td class="py-3 px-3 text-primary">590 µ$</td>
                <td class="py-3 px-3 text-primary">790 µ$</td>
                <td class="py-3 px-3 text-on-surface">$0.59 / $0.79</td>
                <td class="py-3 pl-3 text-outline">LPU Ultrafast</td>
              </tr>
              <tr class="hover:bg-white/[0.02] transition-colors">
                <td class="py-3 pr-3 font-semibold text-on-surface flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full bg-tertiary"></span>
                  <span>DeepSeek V3</span>
                </td>
                <td class="py-3 px-3 text-tertiary">140 µ$</td>
                <td class="py-3 px-3 text-tertiary">280 µ$</td>
                <td class="py-3 px-3 text-on-surface">$0.14 / $0.28</td>
                <td class="py-3 pl-3 text-outline">Multi-Head Latent</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Conversion Helper Note -->
        <div class="mt-4 p-3 rounded-lg bg-surface-container-lowest/60 border border-outline-variant/20 flex items-start gap-2.5">
          <span class="material-symbols-outlined text-outline text-sm mt-0.5" data-icon="info">info</span>
          <p class="text-body-sm font-body-sm text-outline">
            Tokens consumed per request are calculated synchronously at proxy termination and deducted in microdollars. Headers <code class="text-primary font-code-sm">x-balance-remaining-micros</code> and <code class="text-primary font-code-sm">x-request-cost-micros</code> accompany every 200 OK stream terminator.
          </p>
        </div>
      </section>
    </div>

    <!-- ================= RIGHT COLUMN (5 Cols): Sticky Playground & Code Console ================= -->
    <div class="lg:col-span-5 space-y-6 lg:sticky lg:top-20">
      <!-- 1. Interactive API Sandbox / Test Console -->
      <div class="rounded-xl bg-surface-container-low/85 backdrop-blur-2xl border border-white/[0.12] p-5 shadow-2xl specular-top">
        <div class="flex items-center justify-between pb-3 border-b border-outline-variant/25">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-secondary shadow-[0_0_8px_#4edea3]"></span>
            <h3 class="text-headline-sm font-headline-sm text-on-surface font-semibold">Interactive Sandbox</h3>
          </div>
          <span class="text-label-sm font-label-sm font-code-sm text-secondary bg-secondary-container/20 px-2 py-0.5 rounded border border-secondary/30">
            PROD GATEWAY
          </span>
        </div>

        <div class="mt-4 space-y-4">
          <!-- Endpoint Selector -->
          <div>
            <label for="targetEndpointInput" class="block text-label-sm font-label-sm uppercase tracking-wider text-outline mb-1">Target Endpoint</label>
            <div class="flex rounded-lg border border-outline-variant/40 overflow-hidden bg-surface-container-lowest">
              <span class="px-2.5 py-1.5 bg-primary-container text-on-primary-container font-code-sm text-code-sm font-semibold flex items-center">
                POST
              </span>
              <input id="targetEndpointInput" class="w-full bg-transparent px-3 py-1.5 font-code-sm text-code-sm text-on-surface border-none focus:ring-0 focus:outline-none" readonly type="text" value="/v1/chat/completions" />
            </div>
          </div>

          <!-- Auth Token Input with demo prefill -->
          <div>
            <div class="flex justify-between items-center mb-1">
              <label for="bearerTokenInput" class="block text-label-sm font-label-sm uppercase tracking-wider text-outline">Bearer Token</label>
              <span class="text-[10px] text-secondary font-code-sm">SANDBOX PREFILL</span>
            </div>
            <div class="relative">
              <span class="material-symbols-outlined absolute left-2.5 top-2 text-outline text-sm" data-icon="key">key</span>
              <input
                id="bearerTokenInput"
                bind:value={bearerToken}
                class="w-full pl-8 pr-12 py-1.5 text-code-sm font-code-sm rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface focus:border-primary focus:outline-none font-mono"
                type="text"
              />
              <button
                type="button"
                class="absolute right-2 top-2 text-outline hover:text-on-surface cursor-pointer flex items-center"
                onclick={() => copyText(bearerToken, 'token')}
                title="Copy token"
              >
                {#if copiedToken}
                  <span class="material-symbols-outlined text-secondary text-sm" data-icon="check">check</span>
                {:else}
                  <span class="material-symbols-outlined text-sm" data-icon="content_copy">content_copy</span>
                {/if}
              </button>
            </div>
          </div>

          <!-- Model Selector & Streaming Toggle Row -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="modelSelect" class="block text-label-sm font-label-sm uppercase tracking-wider text-outline mb-1">Virtualized Model</label>
              <select
                id="modelSelect"
                bind:value={selectedModel}
                class="w-full py-1.5 px-2.5 text-code-sm font-code-sm rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface focus:border-primary focus:outline-none cursor-pointer"
              >
                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                <option value="groq-llama-3.3-70b">groq-llama-3.3-70b</option>
                <option value="cerebras-llama-3.3">cerebras-llama-3.3</option>
                <option value="deepseek-v3">deepseek-v3</option>
              </select>
            </div>

            <!-- Stream Toggle Switch -->
            <div>
              <span class="block text-label-sm font-label-sm uppercase tracking-wider text-outline mb-1">Streaming (SSE)</span>
              <button
                type="button"
                onclick={() => (isStreaming = !isStreaming)}
                class="w-full flex items-center justify-between h-[34px] px-3 rounded-lg bg-surface-container-lowest border border-outline-variant/40 cursor-pointer hover:border-outline-variant/60 transition-colors"
              >
                <span class="text-label-sm font-label-sm flex items-center gap-1.5 {isStreaming ? 'text-secondary' : 'text-outline'}">
                  <span class="w-2 h-2 rounded-full {isStreaming ? 'bg-secondary animate-pulse' : 'bg-outline'}"></span>
                  <span>{isStreaming ? 'SSE ACTIVE' : 'SSE DISABLED'}</span>
                </span>
                <span class="w-4 h-4 rounded border flex items-center justify-center {isStreaming ? 'bg-secondary border-secondary text-surface-container-lowest' : 'bg-surface-container border-outline-variant/50'}">
                  {#if isStreaming}
                    <span class="material-symbols-outlined text-xs font-bold" data-icon="check">check</span>
                  {/if}
                </span>
              </button>
            </div>
          </div>

          <!-- JSON Request Body Editor -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-label-sm font-label-sm uppercase tracking-wider text-outline">JSON Payload</span>
              <span class="text-[10px] font-code-sm text-outline">application/json</span>
            </div>
            <div class="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-3 font-code-sm text-code-sm overflow-x-auto relative">
              <pre class="text-on-surface leading-5"><code><span class="text-outline">1</span> &#123;
<span class="text-outline">2</span>   <span class="text-primary">"model"</span>: <span class="text-secondary">"{selectedModel}"</span>,
<span class="text-outline">3</span>   <span class="text-primary">"messages"</span>: [
<span class="text-outline">4</span>     &#123; <span class="text-primary">"role"</span>: <span class="text-tertiary">"system"</span>, <span class="text-primary">"content"</span>: <span class="text-secondary">"You are an edge AI router."</span> &#125;,
<span class="text-outline">5</span>     &#123; <span class="text-primary">"role"</span>: <span class="text-tertiary">"user"</span>, <span class="text-primary">"content"</span>: <span class="text-secondary">"Verify proxy handshake status."</span> &#125;
<span class="text-outline">6</span>   ],
<span class="text-outline">7</span>   <span class="text-primary">"stream"</span>: <span class="text-tertiary">{isStreaming}</span>,
<span class="text-outline">8</span>   <span class="text-primary">"temperature"</span>: <span class="text-tertiary">0.3</span>
<span class="text-outline">9</span> &#125;</code></pre>
            </div>
          </div>
        </div>

        <!-- Code Snippet Tabs (cURL, TS, Python) -->
        <div class="mt-4 pt-3 border-t border-outline-variant/20">
          <div class="flex items-center justify-between mb-2">
            <div class="flex gap-2">
              <button
                type="button"
                class="px-2.5 py-1 rounded text-label-sm font-label-sm transition-colors cursor-pointer {activeTab === 'curl'
                  ? 'bg-surface-container-high text-primary font-medium border border-primary/30'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'}"
                onclick={() => (activeTab = 'curl')}
              >
                cURL
              </button>
              <button
                type="button"
                class="px-2.5 py-1 rounded text-label-sm font-label-sm transition-colors cursor-pointer {activeTab === 'ts'
                  ? 'bg-surface-container-high text-primary font-medium border border-primary/30'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'}"
                onclick={() => (activeTab = 'ts')}
              >
                TypeScript (SDK)
              </button>
              <button
                type="button"
                class="px-2.5 py-1 rounded text-label-sm font-label-sm transition-colors cursor-pointer {activeTab === 'py'
                  ? 'bg-surface-container-high text-primary font-medium border border-primary/30'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'}"
                onclick={() => (activeTab = 'py')}
              >
                Python (OpenAI)
              </button>
            </div>

            <button
              type="button"
              class="p-1 rounded text-outline hover:text-on-surface transition-colors cursor-pointer flex items-center gap-1"
              onclick={() => copyText(activeSnippet, 'snippet')}
              title="Copy snippet"
            >
              {#if copiedSnippet}
                <span class="material-symbols-outlined text-secondary text-sm" data-icon="check">check</span>
                <span class="text-[10px] text-secondary font-code-sm">Copied!</span>
              {:else}
                <span class="material-symbols-outlined text-sm" data-icon="content_copy">content_copy</span>
              {/if}
            </button>
          </div>

          <!-- Snippet Views -->
          <div class="rounded-lg bg-surface-container-lowest border border-outline-variant/30 p-2.5 text-code-sm font-code-sm text-on-surface overflow-x-auto">
            <pre class="leading-relaxed select-all"><code>{activeSnippet}</code></pre>
          </div>
        </div>

        <!-- Action: Send Request Button & Live Response Pane -->
        <div class="mt-4 pt-4 border-t border-outline-variant/25 space-y-3">
          <button
            type="button"
            class="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-md font-label-md font-semibold hover:bg-primary-fixed-dim transition-all shadow-[0_0_20px_rgba(192,193,255,0.25)] flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer disabled:opacity-60"
            disabled={isSending}
            onclick={handleSendRequest}
          >
            {#if isSending}
              <span class="material-symbols-outlined animate-spin text-lg" data-icon="sync">sync</span>
              <span>Routing via Edge Isolate...</span>
            {:else}
              <span class="material-symbols-outlined" data-icon="play_arrow">play_arrow</span>
              <span>Send Request (Cmd + Enter)</span>
            {/if}
          </button>

          <!-- Response Box with SSE Stream Tokens -->
          <div class="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-3">
            <div class="flex items-center justify-between pb-2 border-b border-outline-variant/20 mb-2">
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded text-[10px] font-label-sm bg-secondary-container/20 text-secondary border border-secondary/40 font-semibold">
                  {simulatedStatus}
                </span>
                <span class="text-label-sm font-label-sm text-outline">
                  {isStreaming ? 'Chunked SSE' : 'JSON Response'}
                </span>
              </div>
              <div class="flex items-center gap-2 text-label-sm font-label-sm font-code-sm">
                <span class="text-outline">Latency:</span>
                <span class="text-secondary font-semibold">{simulatedLatency}</span>
              </div>
            </div>

            <div class="space-y-1 font-code-sm text-code-sm custom-scroll max-h-48 overflow-y-auto">
              {#each responseChunks as chunk}
                <div class={chunk.class}>{chunk.text}</div>
              {/each}
            </div>
          </div>
        </div>

        <!-- Bottom Export Action Buttons -->
        <div class="mt-4 pt-3 border-t border-outline-variant/20 flex items-center justify-between gap-2">
          <button
            type="button"
            class="flex-1 py-1.5 px-2 rounded-lg bg-surface-container-high hover:bg-surface-variant border border-outline-variant/30 text-label-sm font-label-sm text-on-surface flex items-center justify-center gap-1.5 transition-colors active:scale-[0.98] cursor-pointer"
            onclick={downloadMarkdown}
          >
            <span class="material-symbols-outlined text-sm" data-icon="download">download</span>
            <span>Download API Reference (.md)</span>
          </button>
          <button
            type="button"
            class="py-1.5 px-3 rounded-lg bg-surface-container-high hover:bg-surface-variant border border-outline-variant/30 text-label-sm font-label-sm text-on-surface flex items-center gap-1 transition-colors active:scale-[0.98] cursor-pointer"
            onclick={handlePrintPdf}
            title="Print to PDF"
          >
            <span class="material-symbols-outlined text-sm" data-icon="print">print</span>
            <span>PDF</span>
          </button>
        </div>
      </div>

      <!-- Quick Telemetry Micro Card -->
      <div class="rounded-xl bg-surface-container-low/70 backdrop-blur-xl border border-white/[0.08] p-4 flex items-center justify-between specular-top">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-secondary-container/20 border border-secondary/40 flex items-center justify-center text-secondary">
            <span class="material-symbols-outlined" data-icon="network_check">network_check</span>
          </div>
          <div>
            <div class="text-label-md font-label-md text-on-surface font-semibold">Active Pool Quota</div>
            <div class="text-[11px] font-body-sm text-outline">Virtual Key Pool #3 (Tier-Edge)</div>
          </div>
        </div>
        <div class="text-right">
          <div class="text-code-md font-code-md text-secondary font-semibold">849,210 µ$</div>
          <div class="text-[10px] font-label-sm text-outline">Balance remaining</div>
        </div>
      </div>
    </div>
  </div>
</div>
