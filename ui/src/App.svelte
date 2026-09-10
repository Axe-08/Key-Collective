<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './lib/api';
  import type { APIKey, RequestLog, PoolStats, CreateKeyPayload, ToastMessage } from './lib/types';

  import Header from './lib/Header.svelte';
  import MetricCards from './lib/MetricCards.svelte';
  import KeysTable from './lib/KeysTable.svelte';
  import TelemetryLogs from './lib/TelemetryLogs.svelte';
  import AddKeyModal from './lib/AddKeyModal.svelte';
  import Toast from './lib/Toast.svelte';

  // Svelte 5 reactive state
  let keys = $state<APIKey[]>([]);
  let logs = $state<RequestLog[]>([]);
  let stats = $state<PoolStats>({
    total_keys: 0,
    healthy_keys: 0,
    rate_limited_keys: 0,
    invalid_keys: 0,
    total_rpm_headroom: 0,
    total_rpm_limit: 0,
    current_rpm_used: 0,
    avg_upstream_latency_ms: 0,
    daily_quota_used: 0,
    daily_quota_limit: 50000,
    proxy_status: 'healthy',
  });

  let isAddModalOpen = $state(false);
  let autoRefresh = $state(true);
  let isRefreshing = $state(false);
  let toasts = $state<ToastMessage[]>([]);
  let proxyEndpoint = $state('https://key-col.axe08.tech/v1/chat/completions');

  function addToast(type: ToastMessage['type'], message: string) {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    toasts = [...toasts, { id, type, message }];
    setTimeout(() => {
      dismissToast(id);
    }, 4500);
  }

  function dismissToast(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
  }

  async function loadData() {
    try {
      isRefreshing = true;
      const [fetchedKeys, fetchedLogs] = await Promise.all([
        api.getKeys(),
        api.getLogs(),
      ]);

      keys = fetchedKeys;
      logs = fetchedLogs;
      stats = await api.getStats(fetchedKeys, fetchedLogs);
    } catch (err: any) {
      console.error('Failed to load dashboard data', err);
    } finally {
      isRefreshing = false;
    }
  }

  async function handleAddKey(payload: CreateKeyPayload) {
    try {
      const created = await api.createKey(payload);
      keys = [created, ...keys];
      stats = await api.getStats(keys, logs);
      addToast('success', `API Key "${created.label}" added to pool with ${created.rpm_limit} RPM / ${created.rpd_limit} RPD.`);
    } catch (err: any) {
      addToast('error', `Failed to add key: ${err?.message || 'Unknown error'}`);
      throw err;
    }
  }

  async function handleDeleteKey(id: string) {
    try {
      const keyToDelete = keys.find((k) => k.id === id);
      await api.deleteKey(id);
      keys = keys.filter((k) => k.id !== id);
      stats = await api.getStats(keys, logs);
      addToast('info', `Key "${keyToDelete?.label || id}" was deleted from the pool.`);
    } catch (err: any) {
      addToast('error', `Failed to delete key: ${err?.message || 'Unknown error'}`);
    }
  }

  async function handleTestKey(id: string) {
    try {
      const keyObj = keys.find((k) => k.id === id);
      const res = await api.testKey(id);
      if (res.success) {
        addToast('success', `Test Passed: ${keyObj?.label || id} responded in ${res.latency_ms}ms.`);
      } else {
        addToast('warning', `Test Alert: ${res.message}`);
      }
      await loadData();
    } catch (err: any) {
      addToast('error', `Key test failed: ${err?.message || 'Upstream error'}`);
    }
  }

  function handleToggleAutoRefresh() {
    autoRefresh = !autoRefresh;
    addToast('info', autoRefresh ? 'Auto-refresh enabled (3s polling)' : 'Auto-refresh paused');
  }

  onMount(() => {
    if (typeof window !== 'undefined') {
      proxyEndpoint = `${window.location.origin}/v1/chat/completions`;
    }
    loadData();

    // 3-second live refresh interval
    const interval = setInterval(() => {
      if (autoRefresh) {
        loadData();
      }
    }, 3000);

    return () => clearInterval(interval);
  });
</script>

<div class="min-h-screen bg-[#090b10] text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
  <!-- Top Navigation / Header -->
  <Header
    {stats}
    onOpenAddModal={() => (isAddModalOpen = true)}
    onRefresh={loadData}
    {isRefreshing}
  />

  <!-- Main Content Dashboard Container -->
  <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
    <!-- 4 High-Density Metric Cards -->
    <MetricCards {stats} {keys} />

    <!-- Tabular Keys Management View -->
    <KeysTable
      {keys}
      onDeleteKey={handleDeleteKey}
      onTestKey={handleTestKey}
    />

    <!-- Live Request Telemetry Log Stream -->
    <TelemetryLogs
      {logs}
      {autoRefresh}
      onToggleAutoRefresh={handleToggleAutoRefresh}
      onManualRefresh={loadData}
      {isRefreshing}
    />

    <!-- Developer Quick Integration Reference / Documentation snippet -->
    <div class="rounded-xl bg-slate-900/40 border border-white/[0.06] p-4 text-xs font-mono flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <span class="text-indigo-400 font-semibold uppercase tracking-wider text-[11px]">Proxy Endpoint:</span>
          <code class="px-2 py-0.5 rounded bg-slate-950 border border-white/10 text-emerald-400 font-mono">
            {proxyEndpoint}
          </code>
        </div>
        <p class="text-slate-400 text-[11px]">
          Drop-in OpenAI/Gemini/Groq routing replacement. Load balances across all healthy pool keys with automatic rate-limit cooldown.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-slate-500 text-[11px]">Upstream Strategy:</span>
        <span class="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-[11px]">
          Priority &gt; Headroom &gt; Latency
        </span>
      </div>
    </div>
  </main>

  <!-- Add Key Modal -->
  <AddKeyModal
    isOpen={isAddModalOpen}
    onClose={() => (isAddModalOpen = false)}
    onAddKey={handleAddKey}
  />

  <!-- Floating Toast Notifications -->
  <Toast {toasts} onDismiss={dismissToast} />
</div>
