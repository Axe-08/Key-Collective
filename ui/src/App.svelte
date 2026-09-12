<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './lib/api';
  import type { APIKey, RequestLog, PoolStats, CreateKeyPayload, ToastMessage, Microdollars } from './lib/types';
  import type { UserAccount, Project, ProjectKey, UserTier } from '../../src/contracts/v3_types';

  import TopNavBar from './lib/TopNavBar.svelte';
  import SideNavBar from './lib/SideNavBar.svelte';
  import MetricCards from './lib/MetricCards.svelte';
  import KeysTable from './lib/KeysTable.svelte';
  import TelemetryLogs from './lib/TelemetryLogs.svelte';
  import AddKeyModal from './lib/AddKeyModal.svelte';
  import Workbench from './lib/Workbench.svelte';
  import ApiDocs from './lib/ApiDocs.svelte';
  import AdminView from './lib/admin/AdminView.svelte';
  import OAuthModal from './lib/OAuthModal.svelte';
  import Toast from './lib/Toast.svelte';

  // Navigation state (Stitch multi-screen routing)
  let activeTab = $state<'pool' | 'workbench' | 'docs' | 'admin'>('pool');

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

  // Microdollar Accounting State (1 USD = 1,000,000 µ$)
  let todaySpendMicrodollars = $state<Microdollars>(42000);

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
  let isEndpointCopied = $state(false);

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

  function handleCopyEndpoint() {
    navigator.clipboard.writeText(proxyEndpoint);
    isEndpointCopied = true;
    addToast('success', 'Proxy endpoint URL copied to clipboard');
    setTimeout(() => {
      isEndpointCopied = false;
    }, 2000);
  }

  onMount(() => {
    if (typeof window !== 'undefined') {
      proxyEndpoint = `${window.location.origin}/v1/chat/completions`;
      const urlParams = new URLSearchParams(window.location.search);
      const queryToken = urlParams.get('token') || urlParams.get('admin_token');
      if (queryToken && queryToken.trim().length > 0) {
        localStorage.setItem('kc_auth_token', queryToken.trim());
      }
      if (urlParams.get('tab') === 'admin' || window.location.hostname.startsWith('admin.')) {
        userAccount = {
          ...userAccount,
          tier: 'admin',
          primaryEmail: 'admin@keycollective.io',
        };
        activeTab = 'admin';
      }
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

<div class="min-h-screen bg-surface-container-lowest text-on-surface antialiased relative selection:bg-primary-container selection:text-on-primary-container font-body-md text-body-md overflow-x-hidden">
  <!-- Atmospheric Background Glow Elements matching Stitch Design -->
  <div class="fixed inset-0 glow-radial-indigo pointer-events-none z-0"></div>

  <!-- Shared Component: TopNavBar (Fixed top 0, left 0, right 0, h-14, z-50) -->
  <TopNavBar
    {stats}
    {activeTab}
    onSelectTab={(tab) => (activeTab = tab as any)}
    {userAccount}
    onOpenAddModal={() => (isAddModalOpen = true)}
    onOpenOAuthModal={() => (isOAuthModalOpen = true)}
    onRefresh={loadData}
    {isRefreshing}
    {todaySpendMicrodollars}
  />

  <!-- Shared Component: SideNavBar (Fixed top 14, left 0, bottom 0, w-64, z-40) -->
  <SideNavBar
    {activeTab}
    onSelectTab={(tab) => (activeTab = tab as any)}
    {stats}
    {keys}
    {userAccount}
    onOpenAddModal={() => (isAddModalOpen = true)}
    {todaySpendMicrodollars}
  />

  <!-- Main Canvas Container with Left Sidebar Offset (Exact matching Stitch screen1_dashboard.html) -->
  <main class="md:ml-64 pt-16 min-h-screen px-4 md:px-8 pb-24 relative z-10">
    <!-- TAB 1: Virtual Key Inventory & Routing Shield Dashboard -->
    {#if activeTab === 'pool'}
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
              onclick={loadData}
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
            onDeleteKey={handleDeleteKey}
            onTestKey={handleTestKey}
            onOpenAddModal={() => (isAddModalOpen = true)}
          />
        </div>

        <!-- Live Telemetry Stream (Edge Request Stream Console) (Col span 4) -->
        <div class="xl:col-span-4 flex flex-col">
          <TelemetryLogs
            {logs}
            {autoRefresh}
            onToggleAutoRefresh={handleToggleAutoRefresh}
            onManualRefresh={loadData}
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
                onclick={handleCopyEndpoint}
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
            <button type="button" onclick={() => (activeTab = 'docs')} class="text-primary border-b border-primary pb-0.5 cursor-pointer">Python (OpenAI client)</button>
            <button type="button" onclick={() => (activeTab = 'docs')} class="hover:text-on-surface transition-colors cursor-pointer">TypeScript / Node</button>
            <button type="button" onclick={() => (activeTab = 'docs')} class="hover:text-on-surface transition-colors cursor-pointer">cURL</button>
          </div>
          <div class="flex items-center gap-1.5 text-outline">
            <span class="material-symbols-outlined text-[14px]" data-icon="lock">lock</span>
            <span>Pass virtual pool token in <code class="text-primary font-code-sm">Bearer Authorization</code> header</span>
          </div>
        </div>
      </section>
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

    <!-- TAB 4: Admin Surveillance Panel (admin.key-col.axe08.tech) -->
    {#if activeTab === 'admin'}
      <AdminView
        adminEmail={userAccount.primaryEmail}
        onNavigate={(tab) => (activeTab = tab as any)}
      />
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
