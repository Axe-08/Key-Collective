<script module lang="ts">
  export const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL ||
    (import.meta.env.DEV ? 'http://api.localhost:8787/v1' : 'https://api.key-col.axe08.tech/v1');
</script>

<script lang="ts">
  import { sessionAuthTransport } from './api/client';
  import { onMount } from 'svelte';
  import {
    PlaygroundHeader,
    PlaygroundSnippets,
    PlaygroundRequestForm,
    PlaygroundResponseStream,
  } from './playground';

  let {
    proxyEndpoint = `${API_BASE_URL}/chat/completions`,
    onRefreshMetrics,
  }: {
    proxyEndpoint?: string;
    onRefreshMetrics?: () => void;
  } = $props();

  const baseUrl = $derived(proxyEndpoint.replace(/\/chat\/completions$/, ''));

  let bearerToken = $state('');
  let tokenSecondsRemaining = $state(900);
  const isSessionToken = true;
  let selectedModel = $state('');
  let isStreaming = $state(true);
  let activeTab = $state<'curl' | 'ts' | 'py'>('curl');

  // Playground key (WP-3.10): minted for the signed-in user, 10 RPM, 15 minutes.
  async function fetchPlaygroundToken() {
    try {
      const res = await fetch('/api/playground/token', {
        method: 'POST',
        credentials: 'same-origin',
        headers: sessionAuthTransport.getHeaders('POST'),
      });
      if (res.ok) {
        const data = (await res.json()) as { token?: string; expires_at?: string };
        if (data?.token) {
          bearerToken = data.token;
          tokenSecondsRemaining = data.expires_at
            ? Math.max(0, Math.floor((new Date(data.expires_at).getTime() - Date.now()) / 1000))
            : 900;
          return;
        }
      }
      liveStatus = res.status === 401 ? 'Sign in to use the playground' : 'Playground key unavailable';
    } catch {
      liveStatus = 'Playground key unavailable — check your network';
    }
    bearerToken = '';
  }

  function handleRotateToken() {
    void fetchPlaygroundToken();
  }

  // Filled from /v1/models only (WP-3.10).
  let availableModels = $state<{ id: string; provider: string }[]>([]);

  onMount(() => {
    let rotationInterval: ReturnType<typeof setInterval> | null = null;
    if (typeof window !== 'undefined') {
      void fetchPlaygroundToken();

      rotationInterval = setInterval(() => {
        if (!bearerToken) return;
        tokenSecondsRemaining -= 1;
        if (tokenSecondsRemaining <= 0) {
          void fetchPlaygroundToken();
        }
      }, 1000);

      fetch(`${baseUrl}/models`)
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
        .catch((err) => console.error('Failed to load /v1/models for the model picker', err));
    }

    return () => {
      if (rotationInterval) clearInterval(rotationInterval);
    };
  });

  // The model is filled from the picker (which lists /v1/models only).
  let payloadJson = $state(`{\n  "model": "",\n  "messages": [\n    { "role": "system", "content": "You are an edge AI router." },\n    { "role": "user", "content": "Verify proxy handshake status." }\n  ],\n  "stream": true,\n  "temperature": 0.3\n}`);

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
  let liveCostCu = $state<number>(0);
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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken.trim()}`,
        'x-pool-fallback': 'lenient',
      };

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
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

      const cuHeader = res.headers.get('x-kc-cu');
      liveCostCu = cuHeader ? parseInt(cuHeader, 10) || 0 : 0;

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
        let pendingUsageEvent = false;
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkStr = decoder.decode(value, { stream: true });
          const lines = chunkStr.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            // The final kc.usage event carries the request's CU cost.
            if (line.startsWith('event: kc.usage')) {
              pendingUsageEvent = true;
              continue;
            }
            if (pendingUsageEvent && line.startsWith('data:')) {
              pendingUsageEvent = false;
              try {
                const usage = JSON.parse(line.slice(5).trim()) as { cu?: number };
                if (typeof usage.cu === 'number') liveCostCu = usage.cu;
              } catch {
                liveStatus = 'Malformed kc.usage event';
              }
              continue;
            }
            responseChunks = [...responseChunks, { text: line, class: 'text-secondary font-mono text-xs' }];
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
        {liveCostCu}
        {selectedModel}
        {fallbackModelUsed}
        {responseChunks}
      />
    </div>
  </div>
</div>
