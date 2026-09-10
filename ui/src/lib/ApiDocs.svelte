<script lang="ts">
  import MarkdownExport from './MarkdownExport.svelte';

  let {
    proxyEndpoint = 'https://key-col.axe08.tech/v1/chat/completions',
  }: {
    proxyEndpoint?: string;
  } = $props();

  let activeLang = $state<'curl' | 'typescript' | 'python'>('curl');
  let copied = $state(false);

  const curlSnippet = $derived(`curl -X POST "${proxyEndpoint}" \\
  -H "Authorization: Bearer kc_proj_your_project_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "Hello world!" }
    ],
    "temperature": 0.7,
    "stream": false
  }'`);

  const tsSnippet = $derived(`import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${proxyEndpoint.replace(/\/chat\/completions$/, '')}",
  apiKey: "kc_proj_your_project_key",
});

const response = await client.chat.completions.create({
  model: "gemini-2.5-flash",
  messages: [{ role: "user", content: "Hello from Key Collective!" }],
});

console.log(response.choices[0].message.content);`);

  const pythonSnippet = $derived(`from openai import OpenAI

client = OpenAI(
    base_url="${proxyEndpoint.replace(/\/chat\/completions$/, '')}",
    api_key="kc_proj_your_project_key",
)

response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Hello from Key Collective!"}],
)

print(response.choices[0].message.content)`);

  const activeSnippet = $derived(
    activeLang === 'curl' ? curlSnippet : activeLang === 'typescript' ? tsSnippet : pythonSnippet
  );

  function copySnippet() {
    navigator.clipboard.writeText(activeSnippet);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function handlePrintPdf() {
    window.print();
  }

  const markdownApiDocs = `# Key Collective API Reference (v3.0)

## Overview
Key Collective is an edge-native, zero-latency LLM router and rate-limit multiplexer built on Cloudflare Workers and Durable Objects.

- **Base URL:** \`https://key-col.axe08.tech\`
- **Authentication:** Bearer Token (\`Authorization: Bearer <PROJECT_KEY>\`)
- **Protocol:** OpenAI API Compatible (\`/v1/chat/completions\`, \`/v1/models\`)

---

## 1. Chat Completions
\`POST /v1/chat/completions\`

### Headers
| Header | Type | Description |
| :--- | :--- | :--- |
| \`Authorization\` | \`string\` | \`Bearer kc_proj_...\` project-scoped API key |
| \`Content-Type\` | \`string\` | \`application/json\` |
| \`x-tenant-id\` | \`string\` | *(Optional)* Tenant isolation verification header |

### Request Body
\`\`\`json
{
  "model": "gemini-2.5-flash",
  "messages": [
    { "role": "user", "content": "Explain quantum computing in one sentence." }
  ],
  "temperature": 0.7,
  "stream": false
}
\`\`\`

---

## 2. Models Catalog
\`GET /v1/models\`
Lists all available models across providers (Gemini, Groq, Anthropic, OpenRouter) with capabilities, context window sizes, and pricing.

---

## 3. Liveness & Health Probe
\`GET /health\`
Returns edge worker health status, runtime version, and timestamp. Zero authentication required.
`;
</script>

<div class="space-y-6 text-slate-100 font-sans">
  <!-- Header & Exporters -->
  <div class="rounded-xl bg-slate-900/70 border border-white/[0.08] shadow-xl backdrop-blur-sm p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
    <div>
      <div class="flex items-center gap-2">
        <h1 class="text-xl font-bold text-white tracking-tight">API Documentation & Integration</h1>
        <span class="px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-semibold">OpenAI Compatible</span>
      </div>
      <p class="text-xs text-slate-400 font-mono mt-1">
        Seamless drop-in endpoint supporting streaming, cascading failovers, and automatic rate-limit cooldown.
      </p>
    </div>

    <!-- Export Buttons -->
    <div class="flex items-center gap-3">
      <!-- Markdown Exporter -->
      <MarkdownExport
        data={markdownApiDocs}
        filename="key-collective-api-reference.md"
        class="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-medium border border-white/10 transition-all cursor-pointer"
      >
        <svg class="w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>Export Markdown</span>
      </MarkdownExport>

      <!-- Print / PDF Exporter -->
      <button
        type="button"
        onclick={handlePrintPdf}
        class="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-medium shadow-md shadow-indigo-600/20 border border-indigo-400/30 transition-all active:scale-95 cursor-pointer"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
        <span>Print / Save PDF</span>
      </button>
    </div>
  </div>

  <!-- Interactive Code Explorer -->
  <div class="rounded-xl bg-slate-900/60 border border-white/[0.08] overflow-hidden shadow-xl">
    <div class="px-6 py-3 border-b border-white/[0.08] bg-slate-950/60 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <button
          type="button"
          onclick={() => (activeLang = 'curl')}
          class="px-3 py-1.5 rounded-md text-xs font-mono font-semibold transition-all {activeLang === 'curl' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:text-slate-200'}"
        >
          cURL
        </button>
        <button
          type="button"
          onclick={() => (activeLang = 'typescript')}
          class="px-3 py-1.5 rounded-md text-xs font-mono font-semibold transition-all {activeLang === 'typescript' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:text-slate-200'}"
        >
          TypeScript (OpenAI SDK)
        </button>
        <button
          type="button"
          onclick={() => (activeLang = 'python')}
          class="px-3 py-1.5 rounded-md text-xs font-mono font-semibold transition-all {activeLang === 'python' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:text-slate-200'}"
        >
          Python
        </button>
      </div>

      <button
        type="button"
        onclick={copySnippet}
        class="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-white/5 hover:bg-white/10 text-xs font-mono text-slate-300 border border-white/10 transition-colors"
      >
        {#if copied}
          <svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
          </svg>
          <span class="text-emerald-400">Copied!</span>
        {:else}
          <svg class="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>Copy</span>
        {/if}
      </button>
    </div>

    <div class="p-6 bg-[#050608] overflow-x-auto">
      <pre class="font-mono text-xs text-slate-200 leading-relaxed"><code>{activeSnippet}</code></pre>
    </div>
  </div>

  <!-- Endpoints Specification Table -->
  <div class="rounded-xl bg-slate-900/60 border border-white/[0.08] p-6 space-y-4">
    <h2 class="text-sm font-mono font-bold uppercase tracking-wider text-slate-300">Core Gateway Endpoints</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-left text-xs font-mono">
        <thead>
          <tr class="border-b border-white/[0.08] text-slate-400 uppercase text-[10px]">
            <th class="py-2.5 px-3">Method</th>
            <th class="py-2.5 px-3">Endpoint Path</th>
            <th class="py-2.5 px-3">Auth Required</th>
            <th class="py-2.5 px-3">Description</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-white/[0.05] text-slate-300">
          <tr>
            <td class="py-3 px-3"><span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">POST</span></td>
            <td class="py-3 px-3 text-white font-semibold">/v1/chat/completions</td>
            <td class="py-3 px-3 text-amber-400">Bearer Token</td>
            <td class="py-3 px-3 text-slate-400">OpenAI chat completions proxy with streaming and key rotation.</td>
          </tr>
          <tr>
            <td class="py-3 px-3"><span class="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold">GET</span></td>
            <td class="py-3 px-3 text-white font-semibold">/v1/models</td>
            <td class="py-3 px-3 text-amber-400">Bearer Token</td>
            <td class="py-3 px-3 text-slate-400">Models catalog with pricing, rate-limits, and provider status.</td>
          </tr>
          <tr>
            <td class="py-3 px-3"><span class="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold">GET</span></td>
            <td class="py-3 px-3 text-white font-semibold">/health</td>
            <td class="py-3 px-3 text-emerald-400">None (Public)</td>
            <td class="py-3 px-3 text-slate-400">Liveness and health probe for edge runtime.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
