<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './lib/api';
  import type { APIKey, RequestLog, PoolStats, CreateKeyPayload, ToastMessage } from './lib/types';
  import type { UserAccount, Project, ProjectKey, UserTier } from '../../src/contracts/v3_types';

  import Header from './lib/Header.svelte';
  import MetricCards from './lib/MetricCards.svelte';
  import KeysTable from './lib/KeysTable.svelte';
  import TelemetryLogs from './lib/TelemetryLogs.svelte';
  import AddKeyModal from './lib/AddKeyModal.svelte';
  import Workbench from './lib/Workbench.svelte';
  import ApiDocs from './lib/ApiDocs.svelte';
  import OAuthModal from './lib/OAuthModal.svelte';
  import Toast from './lib/Toast.svelte';

  // Navigation state
  let activeTab = $state<'pool' | 'workbench' | 'docs'>('pool');

  // Svelte 5 reactive state for pool
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

  // User Account & Multi-Project Hierarchy (v3 State)
  let userAccount = $state<UserAccount>({
    id: 'usr_gh_9824102',
    githubId: 9824102,
    githubUsername: 'collective-dev',
    primaryEmail: 'dev@keycollective.io',
    tier: 'builder',
    avatarUrl: 'https://avatars.githubusercontent.com/u/9824102?v=4',
    isEmailVerified: true,
    githubCreatedAt: '2023-01-01T00:00:00.000Z',
    sybilScore: 92,
    registrationIp: '127.0.0.1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  });

  let projects = $state<Project[]>([
    {
      id: 'proj_gateway_01',
      tenantId: 'usr_gh_9824102',
      name: 'Production Gateway',
      slug: 'production-gateway',
      description: 'Primary AI routing gateway and key pool',
      maxRpmSubCap: 20,
      isArchived: false,
      createdAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'proj_rag_eval_02',
      tenantId: 'usr_gh_9824102',
      name: 'RAG & Eval Suite',
      slug: 'rag-eval-suite',
      description: 'Continuous retrieval-augmented generation benchmarking',
      maxRpmSubCap: 10,
      isArchived: false,
      createdAt: '2024-01-15T00:00:00.000Z',
      updatedAt: '2024-01-15T00:00:00.000Z',
    },
  ]);

  let projectKeys = $state<ProjectKey[]>([
    {
      id: 'key_cln_live_01',
      projectId: 'proj_gateway_01',
      tenantId: 'usr_gh_9824102',
      name: 'Production Gateway Key',
      tokenPrefix: 'kc_proj_live_8F',
      tokenHashSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      isRevoked: false,
      lastUsedAt: new Date().toISOString(),
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'key_cln_eval_02',
      projectId: 'proj_rag_eval_02',
      tenantId: 'usr_gh_9824102',
      name: 'CI/CD Eval Runner Key',
      tokenPrefix: 'kc_proj_eval_2M',
      tokenHashSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      isRevoked: false,
      lastUsedAt: new Date(Date.now() - 3600000).toISOString(),
      createdAt: '2024-01-15T00:00:00.000Z',
    },
  ]);

  let isAddModalOpen = $state(false);
  let isOAuthModalOpen = $state(false);
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

  function handleSelectTier(tier: UserTier) {
    userAccount = {
      ...userAccount,
      tier,
      updatedAt: new Date().toISOString(),
    };
    addToast('success', `Authorization Tier updated to: ${tier.toUpperCase()}`);
  }

  function handleSimulateLogin(username: string, tier: UserTier) {
    userAccount = {
      ...userAccount,
      githubUsername: username,
      tier,
      sybilScore: tier === 'probationary' ? 35 : tier === 'demo' ? 20 : 94,
      updatedAt: new Date().toISOString(),
    };
    addToast('success', `Authenticated as @${username} (${tier.toUpperCase()})`);
  }

  onMount(() => {
    if (typeof window !== 'undefined') {
      proxyEndpoint = `${window.location.origin}/v1/chat/completions`;
    }
    loadData();

    // 3-second live refresh interval
    const interval = setInterval(() => {
      if (autoRefresh && activeTab === 'pool') {
        loadData();
      }
    }, 3000);

    return () => clearInterval(interval);
  });
</script>

<div class="min-h-screen bg-[#090b10] text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
  <!-- Top Navigation / Header with Tabs & OAuth Profile Card -->
  <Header
    {stats}
    {activeTab}
    onSelectTab={(tab) => (activeTab = tab)}
    {userAccount}
    onOpenAddModal={() => (isAddModalOpen = true)}
    onOpenOAuthModal={() => (isOAuthModalOpen = true)}
    onRefresh={loadData}
    {isRefreshing}
  />

  <!-- Main Content Dashboard Container -->
  <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
    <!-- TAB 1: Pool & Shield View -->
    {#if activeTab === 'pool'}
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

      <!-- Developer Quick Integration Reference -->
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
          <button
            type="button"
            onclick={() => (activeTab = 'docs')}
            class="px-3 py-1 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[11px] transition-colors cursor-pointer"
          >
            View Full Docs &rarr;
          </button>
        </div>
      </div>
    {/if}

    <!-- TAB 2: Developer Workbench (v3 Multi-Project & 7-Tier Authorization) -->
    {#if activeTab === 'workbench'}
      <Workbench
        {userAccount}
        {projects}
        keys={projectKeys}
      />
    {/if}

    <!-- TAB 3: API Documentation & Code Snippets -->
    {#if activeTab === 'docs'}
      <ApiDocs {proxyEndpoint} />
    {/if}
  </main>

  <!-- Add Key Modal -->
  <AddKeyModal
    isOpen={isAddModalOpen}
    onClose={() => (isAddModalOpen = false)}
    onAddKey={handleAddKey}
  />

  <!-- OAuth & Tier Selection Modal -->
  <OAuthModal
    isOpen={isOAuthModalOpen}
    {userAccount}
    onClose={() => (isOAuthModalOpen = false)}
    onSelectTier={handleSelectTier}
    onSimulateLogin={handleSimulateLogin}
  />

  <!-- Floating Toast Notifications -->
  <Toast {toasts} onDismiss={dismissToast} />
</div>
