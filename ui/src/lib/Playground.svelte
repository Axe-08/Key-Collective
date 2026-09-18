<script lang="ts">
  import { onMount } from 'svelte';
  import {
    PlaygroundHeader,
    PlaygroundSnippets,
    PlaygroundRequestForm,
    PlaygroundResponseStream,
  } from './playground';

  let {
    proxyEndpoint = 'https://key-col.axe08.tech/v1/chat/completions',
    onRefreshMetrics,
  }: {
    proxyEndpoint?: string;
    onRefreshMetrics?: () => void;
  } = $props();

  const baseUrl = $derived(proxyEndpoint.replace(/\/chat\/completions$/, ''));

  let bearerToken = $state('');
  let tokenSecondsRemaining = $state(900);
  let isSessionToken = $state(false);
  let selectedModel = $state('gemini-3.8-flash');
  let isStreaming = $state(true);
  let activeTab = $state<'curl' | 'ts' | 'py'>('curl');

  async function fetchDemoToken() {
    try {
      const res = await fetch('/v1/demo/token', { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as { token?: string; expiresInSeconds?: number };
        if (data?.token) {
          bearerToken = data.token;
          tokenSecondsRemaining = data.expiresInSeconds ?? 900;
          return;
        }
      }
    } catch {}
    bearerToken = '';
    liveStatus = 'Demo token unavailable — check network or sign in';
  }

  function handleRotateToken() {
    if (!isSessionToken) {
      fetchDemoToken();
    }
  }

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
    let rotationInterval: ReturnType<typeof setInterval> | null = null;
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('kc_auth_token');
      if (stored && stored.trim().length > 0 && !stored.startsWith('kc_play_') && !stored.startsWith('kc_demo_')) {
        bearerToken = stored.trim();
        isSessionToken = true;
      } else {
        fetchDemoToken();
      }

      rotationInterval = setInterval(() => {
        if (!isSessionToken) {
          tokenSecondsRemaining -= 1;
          if (tokenSecondsRemaining <= 0) {
            fetchDemoToken();
          }
        }
      }, 1000);

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

    return () => {
      if (rotationInterval) clearInterval(rotationInterval);
    };
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
  <PlaygroundHeader {baseUrl} />

  <!-- Playground Grid -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
    <!-- Left Configuration Panel (5 Cols) -->
    <div class="lg:col-span-5 space-y-5">
      <PlaygroundRequestForm
        bind:bearerToken
        {isSessionToken}
        secondsRemaining={tokenSecondsRemaining}
        bind:selectedModel
        {availableModels}
        bind:isStreaming
        bind:payloadJson
        {isSending}
        onSendRequest={handleSendRequest}
        onRotateToken={handleRotateToken}
      />

      <!-- Code Snippets Tab Box -->
      <PlaygroundSnippets
        bind:activeTab
        {activeSnippet}
        copiedSnippet={copiedSnippet}
        onCopySnippet={copySnippet}
      />
    </div>

    <!-- Right Response & Stream Output Panel (7 Cols) -->
    <div class="lg:col-span-7 space-y-4">
      <PlaygroundResponseStream
        {liveStatus}
        {liveLatency}
        {liveCostMicros}
        {selectedModel}
        {fallbackModelUsed}
        {responseChunks}
      />
    </div>
  </div>
</div>
