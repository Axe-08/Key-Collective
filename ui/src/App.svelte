<script module lang="ts">
  import { api } from './lib/api';
  import { ApiError } from './lib/api/client';

  export const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL ||
    (import.meta.env.DEV ? 'http://api.localhost:8787/v1' : 'https://api.key-col.axe08.tech/v1');

  /**
   * Pure, framework-independent network step of the optimistic delete flow,
   * exported so the rollback-on-error behaviour can be exercised in tests
   * without mounting the component. The instance method applies the
   * optimistic removal synchronously (before this resolves) and rolls back
   * `keys` when this reports failure.
   */
  export async function performDeleteKeyRequest(
    id: string
  ): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
    try {
      await api.deleteKey(id);
      return { ok: true };
    } catch (err: any) {
      return {
        ok: false,
        errorMessage: err instanceof ApiError ? err.message : (err?.message || 'Failed to delete key'),
      };
    }
  }
</script>

<script lang="ts">
  import LinkGithubButton from './lib/LinkGithubButton.svelte';
  import { onMount } from 'svelte';
  import type { APIKey, RequestLog, PoolStats, CreateKeyPayload, ToastMessage, CU } from './lib/types';
  import type { UserAccount, Project, ProjectKey, UserTier } from '../../src/contracts/v3_types';

  import TopNavBar from './lib/TopNavBar.svelte';
  import SideNavBar from './lib/SideNavBar.svelte';
  import DashboardView from './lib/DashboardView.svelte';
  import KeysView from './lib/KeysView.svelte';
  import PoolView from './lib/PoolView.svelte';
  import AnalyticsView from './lib/AnalyticsView.svelte';
  import ReportPage from './lib/ReportPage.svelte';
  import NotificationToasts from './lib/NotificationToasts.svelte';
  import AddKeyModal from './lib/AddKeyModal.svelte';
  import Workbench from './lib/Workbench.svelte';
  import ApiDocs from './lib/ApiDocs.svelte';
  import AdminView from './lib/admin/AdminView.svelte';
  import Playground from './lib/Playground.svelte';
  import OAuthModal from './lib/OAuthModal.svelte';
  import ClaimLegacyCard from './lib/ClaimLegacyCard.svelte';
  import { fetchSession, logout, purgeLegacyStorage } from './lib/auth/session';
  import Toast from './lib/Toast.svelte';
  import PoolCommonsTab from './lib/PoolCommonsTab.svelte';
  import ReportKeyModal from './lib/ReportKeyModal.svelte';

  // Navigation state (PRD Section 4 top-level tabs)
  let activeTab = $state<'dashboard' | 'keys' | 'pool' | 'analytics' | 'workbench' | 'docs' | 'playground' | 'admin' | 'commons' | 'report'>('dashboard');

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
    daily_quota_limit: 0,
    proxy_status: 'healthy',
    cu_used_today: 0,
    cu_allowance_today: 0,
  });
  let statsLoading = $state(true);

  // Credit Unit (CU) Accounting State
  let cuUsedToday = $state<CU>(0);

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
    sybilScore: null,
    registrationIp: '',
    createdAt: '',
    updatedAt: '',
  });

  let projects = $state<Project[]>([]);

  let projectKeys = $state<ProjectKey[]>([]);

  let isAddModalOpen = $state(false);
  let isReportModalOpen = $state(false);
  let isOAuthModalOpen = $state(false);
  let sessionRights = $state({ privatePool: false, communityPool: false });
  let sessionNotices = $state<string[]>([]);
  let claimableLegacy = $state<string[]>([]);
  let oauthMode = $state<'login' | 'register'>('login');
  let autoRefresh = $state(true);
  let isRefreshing = $state(false);
  let toasts = $state<ToastMessage[]>([]);
  let proxyEndpoint = $state(`${API_BASE_URL}/chat/completions`);
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
      stats = await api.getStats();
      statsLoading = false;
      cuUsedToday = stats.cu_used_today ?? 0;
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
      stats = await api.getStats();
      addToast('success', `API Key "${created.label}" added to pool with ${created.rpm_limit} RPM / ${created.rpd_limit} RPD.`);
    } catch (err: any) {
      addToast('error', `Failed to add key: ${err?.message || 'Unknown error'}`);
      throw err;
    }
  }

  async function handleDeleteKey(id: string) {
    const keyToDelete = keys.find((k) => k.id === id);
    const previousKeys = keys;
    keys = keys.filter((k) => k.id !== id);

    const result = await performDeleteKeyRequest(id);
    if (!result.ok) {
      keys = previousKeys;
      addToast('error', result.errorMessage);
      return;
    }
    stats = await api.getStats();
    addToast('info', `Key "${keyToDelete?.label || id}" was deleted from the pool.`);
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

  // Identity comes only from GET /api/session (WP-3.4); nothing is kept in localStorage.
  async function refreshSession() {
    try {
      const info = await fetchSession();
      sessionRights = info.rights ?? { privatePool: false, communityPool: false };
      sessionNotices = info.notices ?? [];
      claimableLegacy = info.claimable_legacy_accounts ?? [];
      if (info.user) {
        const u = info.user;
        userAccount = {
          ...userAccount,
          id: u.id,
          tier: (u.tier as UserTier) || userAccount.tier,
          primaryEmail: u.email || '',
          // QA-03: identity comes from user_identities; never derive a GitHub handle from the email.
          githubId: u.github_id ? Number(u.github_id) : 0,
          githubUsername: u.github_username ?? '',
          githubCreatedAt: u.github_profile?.created_at ?? '',
          githubPublicRepos: u.github_profile?.public_repos,
          githubContributions: u.github_profile?.contributions,
          authProvider: u.providers?.includes('github') ? 'github' : u.providers?.includes('google') ? 'google' : undefined,
          sybilScore: u.sybil_score ?? null,
          updatedAt: new Date().toISOString(),
        };
      }
    } catch {
      // Offline or server error: stay signed out.
    }
    loadData();
  }

  async function handleLogout() {
    await logout().catch(() => {});
    if (typeof window !== 'undefined') {
      purgeLegacyStorage();
      localStorage.removeItem('devDisplayName');
      localStorage.removeItem('devAvatarUrl');
    }
    sessionRights = { privatePool: false, communityPool: false };
    sessionNotices = [];
    userAccount = {
      id: '',
      githubId: 0,
      githubUsername: '',
      primaryEmail: '',
      tier: 'demo',
      avatarUrl: '',
      isEmailVerified: false,
      githubCreatedAt: '',
      sybilScore: null,
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
      proxyEndpoint = `${API_BASE_URL}/chat/completions`;
      
      // Earlier versions kept identity and a bearer token in localStorage: delete them.
      purgeLegacyStorage();

      const urlParams = new URLSearchParams(window.location.search);
      if (window.location.pathname === '/report' || urlParams.get('tab') === 'report') {
        activeTab = 'report';
      } else if (urlParams.get('tab') === 'admin' || window.location.hostname.startsWith('admin.')) {
        userAccount = {
          ...userAccount,
          id: userAccount.id || 'admin',
          githubUsername: userAccount.githubUsername || 'admin',
          tier: 'admin',
          primaryEmail: userAccount.primaryEmail || 'admin@keycollective.io',
        };
        activeTab = 'admin';
      } else if (urlParams.get('tab')) {
        activeTab = urlParams.get('tab') as typeof activeTab;
      }

      void refreshSession();
    }

    let pollIntervalId: ReturnType<typeof setInterval>;
    
    function updatePollInterval() {
      if (pollIntervalId) clearInterval(pollIntervalId);
      let freqStr = localStorage.getItem('telemetryPollFreq') || '3s';
      let freqMs = parseInt(freqStr.replace('s', '')) * 1000;
      if (isNaN(freqMs)) freqMs = 3000;

      pollIntervalId = setInterval(() => {
        if (autoRefresh && (activeTab === 'dashboard' || activeTab === 'pool')) {
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
    communityPool={sessionRights.communityPool}
    {activeTab}
    onSelectTab={(tab) => (activeTab = tab as any)}
    {userAccount}
    onOpenAddModal={() => (isAddModalOpen = true)}
    onOpenOAuthModal={(mode) => {
      oauthMode = mode;
      isOAuthModalOpen = true;
    }}
    onRefresh={loadData}
    isRefreshing={isRefreshing || statsLoading}
    {cuUsedToday}
    {proxyEndpoint}
  />

  {#if claimableLegacy.length > 0}
    <ClaimLegacyCard accounts={claimableLegacy} onClaimed={() => void refreshSession()} />
  {/if}

  {#each sessionNotices as notice}
    <div data-testid="session-notice" class="mx-4 mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200 flex items-center justify-between gap-3">
      <span>{notice}</span>
      <LinkGithubButton />
    </div>
  {/each}

  <!-- Shared Component: SideNavBar (Fixed top 14, left 0, bottom 0, w-64, z-40) -->
  <SideNavBar
    {activeTab}
    onSelectTab={(tab) => (activeTab = tab as any)}
    {stats}
    {keys}
    {userAccount}
    onOpenAddModal={() => (isAddModalOpen = true)}
    onOpenReportModal={() => (isReportModalOpen = true)}
    {cuUsedToday}
  />

  <!-- Main Canvas Container with Left Sidebar Offset -->
  <main class="md:ml-64 pt-16 min-h-screen px-4 md:px-8 pb-24 relative z-10">
    <!-- TAB 1: Dashboard (Standing Card, Activity, Quick Credentials & Workbench) -->
    {#if activeTab === 'dashboard' || activeTab === 'workbench'}
      <DashboardView
        {stats}
        {keys}
        {cuUsedToday}
        {proxyEndpoint}
        {isEndpointCopied}
        onCopyEndpoint={handleCopyEndpoint}
        onOpenAddModal={() => (isAddModalOpen = true)}
        onRefresh={loadData}
        {userAccount}
        {projects}
        {projectKeys}
        communityPool={sessionRights.communityPool}
      />
    {/if}

    <!-- TAB 2: Keys (My Keys / Private / Observation) -->
    {#if activeTab === 'keys'}
      <KeysView
        {keys}
        onDeleteKey={handleDeleteKey}
        onTestKey={handleTestKey}
        onOpenAddModal={() => (isAddModalOpen = true)}
        onRefresh={loadData}
      />
    {/if}

    <!-- TAB 3: Pool (Community / Provider / My Contribution) -->
    {#if activeTab === 'pool' || activeTab === 'commons'}
      <PoolView
        {keys}
        {logs}
        {stats}
        {cuUsedToday}
        communityPool={sessionRights.communityPool}
        isRefreshing={isRefreshing || statsLoading}
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

    <!-- TAB 4: Analytics (Usage / Ledger / Multiplier History) -->
    {#if activeTab === 'analytics'}
      <AnalyticsView />
    {/if}

    <!-- Developers: API Documentation & Code Snippets -->
    {#if activeTab === 'docs'}
      <ApiDocs {proxyEndpoint} />
    {/if}

    <!-- Developers: Sandbox Playground -->
    {#if activeTab === 'playground'}
      <Playground {proxyEndpoint} onRefreshMetrics={loadData} />
    {/if}

    <!-- Admin Surveillance Panel (admin.*) -->
    {#if activeTab === 'admin'}
      <AdminView
        adminEmail={userAccount.primaryEmail}
        onNavigate={(tab) => (activeTab = tab as any)}
      />
    {/if}

    <!-- Public Key Takedown Report Page (/report) -->
    {#if activeTab === 'report'}
      <ReportPage onBack={() => (activeTab = 'dashboard')} />
    {/if}
  </main>

  <!-- Add Key Modal -->
  <AddKeyModal
    isOpen={isAddModalOpen}
    onClose={() => (isAddModalOpen = false)}
    onAddKey={handleAddKey}
    isGitHubAuth={sessionRights.communityPool}
  />

  <ReportKeyModal
    isOpen={isReportModalOpen}
    onClose={() => (isReportModalOpen = false)}
    onSuccess={(msg) => addToast('success', msg)}
  />

  <!-- OAuth & Tier Selection Modal -->
  <OAuthModal
    isOpen={isOAuthModalOpen}
    onClose={() => (isOAuthModalOpen = false)}
    onSignedIn={() => void refreshSession()}
  />

  <!-- 30s Polling Notification Toasts (T-6.4.8) -->
  <NotificationToasts />

  <!-- Floating Toast Notifications -->
  <Toast {toasts} onDismiss={dismissToast} />
</div>
