<script lang="ts">
  import type { APIKey, RequestLog, PoolStats, CreateKeyPayload, Microdollars } from './types';
  import MetricCards from './MetricCards.svelte';
  import KeysTable from './KeysTable.svelte';
  import TelemetryLogs from './TelemetryLogs.svelte';
  import TelemetryCharts from './TelemetryCharts.svelte';

  interface Props {
    keys: APIKey[];
    logs: RequestLog[];
    stats: PoolStats;
    todaySpendMicrodollars: Microdollars;
    isRefreshing: boolean;
    autoRefresh: boolean;
    proxyEndpoint: string;
    isEndpointCopied: boolean;
    onRefresh: () => void;
    onToggleAutoRefresh: () => void;
    onDeleteKey: (id: string) => Promise<void>;
    onTestKey: (id: string) => Promise<void>;
    onOpenAddModal: () => void;
    onCopyEndpoint: () => void;
    onNavigateDocs: () => void;
  }

  let {
    keys,
    logs,
    stats,
    todaySpendMicrodollars,
    isRefreshing,
    autoRefresh,
    proxyEndpoint,
    isEndpointCopied,
    onRefresh,
    onToggleAutoRefresh,
    onDeleteKey,
    onTestKey,
    onOpenAddModal,
    onCopyEndpoint,
    onNavigateDocs,
  }: Props = $props();
</script>

<!-- Top Context & Header Banner -->
<div class="py-6 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/20 mb-6">
  <div>
    <div class="flex items-center gap-2 mb-1">
      <span class="text-label-sm font-label-sm uppercase tracking-wider text-primary font-mono">Pool: Gemini &amp; Groq Burst Shield</span>
      <span class="px-1.5 py-0.5 rounded text-label-sm font-label-sm bg-secondary/10 border border-secondary/30 text-secondary font-mono">Active Virtualizer</span>
    </div>
    <h1 class="text-headline-lg font-headline-lg text-on-surface font-semibold tracking-tight flex items-center gap-3">
      Virtual Key Inventory &amp; Routing Shield
    </h1>
    <p class="text-body-md font-body-md text-on-surface-variant mt-1">
      Autonomous rate-limit shielding via round-robin key rotation and sub-15ms edge rerouting.
    </p>
  </div>

  <!-- Top Right Status Quick-Controls -->
  <div class="flex items-center gap-3">
    <div class="px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/30 flex items-center gap-3">
      <div class="flex flex-col text-right">
        <span class="text-label-sm font-label-sm text-outline">Shield Status</span>
        <span class="text-label-md font-label-md text-secondary font-medium font-mono">Automatic Intercept ON</span>
      </div>
      <button
        type="button"
        onclick={onRefresh}
        class="p-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface transition-transform active:rotate-180 duration-300 cursor-pointer"
        title="Synchronize Pool Edge Nodes"
      >
        <span class="material-symbols-outlined text-[18px] {isRefreshing ? 'animate-spin' : ''}" data-icon="refresh">refresh</span>
      </button>
    </div>
  </div>
</div>

<!-- 1. KPI Metric Cards (Grid of 4 Glassmorphism Cards with Microdollar Spend Rings) -->
<MetricCards {stats} {keys} {todaySpendMicrodollars} />

<!-- 2. Main Content Grid: Key Inventory (Left 8 cols) + Real-time Telemetry (Right 4 cols) -->
<div class="grid grid-cols-1 xl:grid-cols-12 gap-6 mb-6">
  <!-- Key Pool Management Section (Col span 8) -->
  <div class="xl:col-span-8 space-y-4">
    <KeysTable
      {keys}
      {onDeleteKey}
      {onTestKey}
      {onOpenAddModal}
    />
  </div>

  <!-- Live Telemetry Stream (Edge Request Stream Console) (Col span 4) -->
  <div id="telemetry-logs" class="xl:col-span-4 flex flex-col gap-4">
    <TelemetryCharts
      endpoint="/api/telemetry/stream"
      title="Cluster Latency & Throughput"
      unit="ms"
      height={140}
    />
    <TelemetryLogs
      {logs}
      {autoRefresh}
      {onToggleAutoRefresh}
      onManualRefresh={onRefresh}
      {isRefreshing}
    />
  </div>
</div>

<!-- 3. Quick Drop-in Proxy Reference Banner -->
<section class="specular-border bg-surface-container-low/90 backdrop-blur-xl rounded-xl border border-outline-variant/30 p-4 md:p-5 relative">
  <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
    <!-- Left: Drop-in description -->
    <div class="space-y-1 max-w-xl">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-primary text-[18px]" data-icon="integration_instructions">integration_instructions</span>
        <span class="text-label-md font-label-md font-medium text-on-surface">Drop-in OpenAI &amp; Anthropic SDK Compatible Endpoint</span>
      </div>
      <p class="text-body-sm font-body-sm text-on-surface-variant">
        Zero code modification required. Simply change your client base URL. Key Collective dynamically rotates keys and translates schema payloads.
      </p>
    </div>

    <!-- Right: Code endpoint box & copy button -->
    <div class="flex items-center gap-2 flex-1 lg:max-w-xl">
      <div class="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant/30">
        <div class="flex items-center gap-2 overflow-hidden font-mono">
          <span class="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-code-sm text-code-sm font-semibold">POST</span>
          <span class="font-code-sm text-code-sm text-on-surface truncate" id="endpointUrl">{proxyEndpoint}</span>
        </div>
        <button
          type="button"
          onclick={onCopyEndpoint}
          class="ml-2 flex items-center gap-1 px-2.5 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-primary text-label-sm font-label-sm font-medium border border-outline-variant/30 transition-all active:scale-95 whitespace-nowrap cursor-pointer {isEndpointCopied ? 'bg-secondary/15 text-secondary' : ''}"
          id="copyEndpointBtn"
        >
          <span class="material-symbols-outlined text-[14px] {isEndpointCopied ? 'text-secondary' : ''}" data-icon={isEndpointCopied ? 'check' : 'content_copy'}>
            {isEndpointCopied ? 'check' : 'content_copy'}
          </span>
          <span id="copyBtnText">{isEndpointCopied ? 'Copied!' : 'Copy Endpoint'}</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Quick Syntax Tabs preview -->
  <div class="mt-3 pt-3 border-t border-outline-variant/20 flex flex-wrap items-center justify-between gap-2 text-label-sm font-label-sm font-mono">
    <div class="flex items-center gap-3 text-outline">
      <span class="text-on-surface">Snippet:</span>
      <button type="button" onclick={onNavigateDocs} class="text-primary border-b border-primary pb-0.5 cursor-pointer">Python (OpenAI client)</button>
      <button type="button" onclick={onNavigateDocs} class="hover:text-on-surface transition-colors cursor-pointer">TypeScript / Node</button>
      <button type="button" onclick={onNavigateDocs} class="hover:text-on-surface transition-colors cursor-pointer">cURL</button>
    </div>
    <div class="flex items-center gap-1.5 text-outline">
      <span class="material-symbols-outlined text-[14px]" data-icon="lock">lock</span>
      <span>Pass virtual pool token in <code class="text-primary font-code-sm">Bearer Authorization</code> header</span>
    </div>
  </div>
</section>
