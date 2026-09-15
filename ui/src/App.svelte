<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './lib/api';
  import type { APIKey, RequestLog, PoolStats, CreateKeyPayload, ToastMessage, Microdollars } from './lib/types';
  import type { UserAccount, Project, ProjectKey, UserTier } from '../../src/contracts/v3_types';

  import TopNavBar from './lib/TopNavBar.svelte';
  import SideNavBar from './lib/SideNavBar.svelte';
  import PoolView from './lib/PoolView.svelte';
  import AddKeyModal from './lib/AddKeyModal.svelte';
  import Workbench from './lib/Workbench.svelte';
  import ApiDocs from './lib/ApiDocs.svelte';
  import AdminView from './lib/admin/AdminView.svelte';
  import Playground from './lib/Playground.svelte';
  import OAuthModal from './lib/OAuthModal.svelte';
  import Toast from './lib/Toast.svelte';
  import PoolCommonsTab from './lib/PoolCommonsTab.svelte';
  import ReportKeyModal from './lib/ReportKeyModal.svelte';

  // Navigation state (Stitch multi-screen routing)
  let activeTab = $state<'pool' | 'workbench' | 'docs' | 'playground' | 'admin' | 'commons'>('pool');

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
  let todaySpendMicrodollars = $state<Microdollars>(0);

  // User Account & Multi-Project Hierarchy (v3 State)
  let userAccount = $state<UserAccount>({
    id: '',
    githubId: 0,
    githubUsername: '',
    primaryEmail: '',
    tier: 'demo',
    avatarUrl: '',
    isEmailVerified: false,
    githubCreatedAt: '',
    sybilScore: 0,
    registrationIp: '',
    createdAt: '',
    updatedAt: '',
  });

  let projects = $state<Project[]>([]);

  let projectKeys = $state<ProjectKey[]>([]);

  let isAddModalOpen = $state(false);
  let isReportModalOpen = $state(false);
  let isOAuthModalOpen = $state(false);
  let oauthMode = $state<'login' | 'register'>('login');
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
      todaySpendMicrodollars = (stats as any).total_spend_today_microdollars ?? (stats as any).todaySpendMicrodollars ?? (logs.reduce((acc, l) => acc + ((l as any).cost_microdollars || 0), 0)) ?? 0;
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

  function handleSimulateLogin(username: string, tier: UserTier, email?: string, avatarUrl?: string) {
    const updatedUser: UserAccount = {
      ...userAccount,
      id: userAccount.id || `usr_${Date.now()}`,
      githubUsername: username,
      primaryEmail: email || userAccount.primaryEmail || `${username.toLowerCase().replace(/\s+/g, '')}@users.noreply.kc`,
      avatarUrl: avatarUrl || userAccount.avatarUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username)}`,
      tier,
      sybilScore: tier === 'probationary' ? 35 : tier === 'demo' ? 20 : 94,
      updatedAt: new Date().toISOString(),
    };
    userAccount = updatedUser;
    if (typeof window !== 'undefined') {
      localStorage.setItem('kc_user', JSON.stringify(updatedUser));
      if (!localStorage.getItem('kc_auth_token')) {
        const token = 'kc_proj_live_9f83a00c82de19a';
        localStorage.setItem('kc_auth_token', token);
        document.cookie = `kc_auth_token=${token}; path=/; Max-Age=2592000; SameSite=Lax; Secure`;
      }
    }
    addToast('success', `Authenticated as @${username} (${tier.toUpperCase()})`);
  }

  function handleLogout() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('kc_auth_token');
      localStorage.removeItem('kc_user');
      document.cookie = 'kc_auth_token=; path=/; Max-Age=0; SameSite=Lax; Secure';
    }
    userAccount = {
      id: '',
      githubId: 0,
      githubUsername: '',
      primaryEmail: '',
      tier: 'demo',
      avatarUrl: '',
      isEmailVerified: false,
      githubCreatedAt: '',
      sybilScore: 0,
      registrationIp: '',
      createdAt: '',
      updatedAt: '',
    };
    keys = [];
    logs = [];
    addToast('info', 'Session invalidated. You have been logged out.');
    loadData();
  }

  onMount(() => {
    if (typeof document !== 'undefined') {
      document.addEventListener('logout', handleLogout);
    }
  });

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
      
      // Hydrate user session from localStorage if present
      const savedUserStr = localStorage.getItem('kc_user');
      if (savedUserStr) {
        try {
          const parsed = JSON.parse(savedUserStr);
          if (parsed && typeof parsed === 'object' && parsed.tier) {
            userAccount = parsed;
            if (!localStorage.getItem('kc_auth_token')) {
              localStorage.setItem('kc_auth_token', 'kc_proj_live_9f83a00c82de19a');
              document.cookie = 'kc_auth_token=kc_proj_live_9f83a00c82de19a; path=/; Max-Age=2592000; SameSite=Lax; Secure';
            }
          }
        } catch {
          localStorage.removeItem('kc_user');
        }
      }

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

    let pollIntervalId: ReturnType<typeof setInterval>;
    
    function updatePollInterval() {
      if (pollIntervalId) clearInterval(pollIntervalId);
      let freqStr = localStorage.getItem('telemetryPollFreq') || '3s';
      let freqMs = parseInt(freqStr.replace('s', '')) * 1000;
      if (isNaN(freqMs)) freqMs = 3000;

      pollIntervalId = setInterval(() => {
        if (autoRefresh && activeTab === 'pool') {
          loadData();
        }
      }, freqMs);
    }

    updatePollInterval();

    const handleStorage = () => updatePollInterval();
    window.addEventListener('settings-updated', handleStorage);
    window.addEventListener('storage', handleStorage);

    return () => {
      clearInterval(pollIntervalId);
      window.removeEventListener('settings-updated', handleStorage);
      window.removeEventListener('storage', handleStorage);
    };
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
    onOpenOAuthModal={(mode) => {
      oauthMode = mode;
      isOAuthModalOpen = true;
    }}
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
    onOpenReportModal={() => (isReportModalOpen = true)}
    {todaySpendMicrodollars}
  />

  <!-- Main Canvas Container with Left Sidebar Offset (Exact matching Stitch screen1_dashboard.html) -->
  <main class="md:ml-64 pt-16 min-h-screen px-4 md:px-8 pb-24 relative z-10">
    <!-- TAB 1: Virtual Key Inventory & Routing Shield Dashboard -->
    {#if activeTab === 'pool'}
      <PoolView
        {keys}
        {logs}
        {stats}
        {todaySpendMicrodollars}
        {isRefreshing}
        {autoRefresh}
        {proxyEndpoint}
        {isEndpointCopied}
        onRefresh={loadData}
        onToggleAutoRefresh={handleToggleAutoRefresh}
        onDeleteKey={handleDeleteKey}
        onTestKey={handleTestKey}
        onOpenAddModal={() => (isAddModalOpen = true)}
        onCopyEndpoint={handleCopyEndpoint}
        onNavigateDocs={() => (activeTab = 'docs')}
      />
    {/if}

    <!-- TAB 2: Developer Workbench (v3 Multi-Project & 7-Tier Authorization) -->
    {#if activeTab === 'workbench'}
      <Workbench
        {userAccount}
        {projects}
        keys={projectKeys}
        providerKeys={keys}
        onRefreshProviderKeys={loadData}
      />
    {/if}

    <!-- TAB 3: API Documentation & Code Snippets -->
    {#if activeTab === 'docs'}
      <ApiDocs {proxyEndpoint} />
    {/if}

    <!-- TAB 4: Sandbox Playground -->
    {#if activeTab === 'playground'}
      <Playground {proxyEndpoint} onRefreshMetrics={loadData} />
    {/if}


    <!-- TAB 4: Admin Surveillance Panel (admin.key-col.axe08.tech) -->
    {#if activeTab === 'admin'}
      <AdminView
        adminEmail={userAccount.primaryEmail}
        onNavigate={(tab) => (activeTab = tab as any)}
      />
    {/if}

    <!-- TAB 5: Pool Commons (v4 Reciprocal Commons — Community Debt Ledger & Eye-for-an-Eye) -->
    {#if activeTab === 'commons'}
      <PoolCommonsTab 
        tenantId={userAccount?.id || 'default'}
        authToken={localStorage.getItem('kc_auth_token') || ''}
      />
    {/if}
  </main>

  <!-- Add Key Modal -->
  <AddKeyModal
    isOpen={isAddModalOpen}
    onClose={() => (isAddModalOpen = false)}
    onAddKey={handleAddKey}
    isGitHubAuth={Boolean(userAccount?.githubId && userAccount.githubId > 0)}
  />

  <ReportKeyModal
    isOpen={isReportModalOpen}
    onClose={() => (isReportModalOpen = false)}
    onSuccess={(msg) => addToast({ type: 'success', message: msg, duration: 4000 })}
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
