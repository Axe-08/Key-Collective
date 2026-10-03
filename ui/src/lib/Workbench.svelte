<script lang="ts">
  import type { UserTier, TierLimits, Project, ProjectKey } from '../../../src/contracts/v3_types';
  import { TIER_LIMITS_MAP } from '../../../src/contracts/v3_types';
  import type { APIKey } from './types';
  import { api } from './api';
  import { ApiError } from './api/client';
  import { toKey, toProject } from './workbench/mappers';

  import type {
    ExtendedProject,
    ExtendedKey,
    WorkbenchProps,
  } from './workbench/types';
  import {
    DEFAULT_USER_ACCOUNT,
    TIER_MATRIX,
  } from './workbench/types';
  import {
    formatRelativeTime,
    formatDate,
    generateMarkdownExport,
  } from './workbench/formatters';

  import IdentityCard from './workbench/IdentityCard.svelte';
  import TierMatrixSection from './workbench/TierMatrixSection.svelte';
  import ProjectsSection from './workbench/ProjectsSection.svelte';
  import ProviderKeysSection from './workbench/ProviderKeysSection.svelte';
  import KeysSection from './workbench/KeysSection.svelte';
  import Modals from './workbench/Modals.svelte';

  let {
    userAccount,
    projects = [],
    keys = [],
    providerKeys: propProviderKeys,
    onCreateProject,
    onRotateKey,
    onRevokeKey,
    onRefreshProviderKeys,
  }: WorkbenchProps = $props();

  const account = $derived(userAccount ?? DEFAULT_USER_ACCOUNT);

  // Local state for interactive updates
  let localProjects = $state<ExtendedProject[]>([]);
  let localKeys = $state<ExtendedKey[]>([]);

  let providerKeys = $state<APIKey[]>([]);
  let providerKeysLoading = $state(true);

  // Switch Pool Modal State
  let switchPoolModalOpen = $state(false);
  let switchPoolTarget = $state<{ keyId: string; targetPool: 'COMMUNITY' | 'PRIVATE' } | null>(null);
  let switchPoolLoading = $state(false);
  let switchPoolError = $state<string | null>(null);

  // Helper for auth headers

  // A parent that passes providerKeys (even an empty list) owns the /api/keys polling;
  // the Workbench fetches only when mounted on its own (QA-06).
  $effect(() => {
    if (propProviderKeys !== undefined) {
      providerKeys = propProviderKeys;
      providerKeysLoading = false;
      return;
    }

    api.getKeys()
      .then((data) => {
        providerKeys = Array.isArray(data) ? data : [];
      })
      .catch((err) => {
        console.error('Failed to fetch keys', err);
        providerKeys = [];
      })
      .finally(() => {
        providerKeysLoading = false;
      });
  });

  async function rotateProviderKey(id: string) {
    const key = providerKeys.find((k) => k.id === id);
    const label = key ? `${key.provider} (${key.label})` : id;
    const newKey = prompt(`Enter new secret API key to rotate ${label}:`);
    if (!newKey || !newKey.trim()) return;

    try {
      const data = await api.rotateProviderKey(id, newKey.trim());
      providerKeys = providerKeys.map((k) =>
        k.id === id ? { ...k, key_prefix: data.key_prefix, key_suffix: data.key_suffix } : k
      );
      alert(`API Key ${label} rotated successfully!`);
      onRefreshProviderKeys?.();
    } catch (e: unknown) {
      alert(`Failed to rotate key: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function openSwitchPoolModal(key: any) {
    const targetPool = key.pool_type === 'COMMUNITY' ? 'PRIVATE' : 'COMMUNITY';
    if (targetPool === 'COMMUNITY' && (!account?.githubId || account.githubId <= 0)) {
       alert("GitHub Authentication Required to contribute keys to the Community Pool.");
       return;
    }
    switchPoolTarget = { keyId: key.id, targetPool };
    switchPoolError = null;
    switchPoolModalOpen = true;
  }

  async function confirmSwitchPool() {
    if (!switchPoolTarget) return;
    const target = switchPoolTarget;
    switchPoolLoading = true;
    switchPoolError = null;
    try {
      const updated = await api.setKeyPoolMode(target.keyId, target.targetPool);
      providerKeys = providerKeys.map((k) =>
        k.id === target.keyId
          ? {
              ...k,
              pool_type: updated.pool_type,
              community_routing_status: (updated.community_routing_status ?? undefined) as APIKey['community_routing_status'],
              observation_until: updated.observation_until === null ? null : new Date(updated.observation_until).toISOString(),
            }
          : k
      );
      switchPoolModalOpen = false;
      switchPoolTarget = null;
      onRefreshProviderKeys?.();
    } catch (e: unknown) {
      switchPoolError =
        e instanceof ApiError && e.status === 423
          ? 'Anti-Midnight Freeze: Pool switching is frozen during the midnight UTC reset window (23:30–00:30 UTC).'
          : e instanceof Error
            ? e.message
            : 'Failed to switch pool';
    } finally {
      switchPoolLoading = false;
    }
  }

  function deleteProviderKey(id: string) {
    providerKeys = providerKeys.filter((k) => k.id !== id);
  }

  // The active tier is the server's users.tier; the tier cards only display it (QA-04).
  const selectedTier = $derived<UserTier>(account.tier || 'builder');

  // Projects and API keys come from the server only (WP-3.9); a failed load shows an
  // empty list rather than invented rows.
  async function loadProjects(): Promise<void> {
    try {
      localProjects = (await api.getProjects()).map(toProject);
    } catch (err) {
      console.error('Failed to load projects', err);
      localProjects = [];
    }
  }

  async function loadTokens(): Promise<void> {
    try {
      localKeys = (await api.getTokens()).map((t) => toKey(t, account.id));
    } catch (err) {
      console.error('Failed to load API keys', err);
      localKeys = [];
    }
  }

  $effect(() => {
    void loadProjects();
    void loadTokens();
  });

  // One-time secret display and project settings errors
  let revealedSecret = $state<string | null>(null);
  let projectSettingsError = $state<string | null>(null);

  // Active tier limits lookup
  const currentLimits = $derived<TierLimits>(
    TIER_LIMITS_MAP[selectedTier] || TIER_LIMITS_MAP.builder
  );

  // Search & Filter state
  let projectFilter = $state<'all' | 'live' | 'archived'>('all');
  let keySearch = $state('');
  let keyProjectFilter = $state('all');

  // Modals & Popovers
  let exportDropdownOpen = $state(false);
  let showVerificationProofModal = $state(false);
  let showNewProjectModal = $state(false);
  let showProjectSettingsModal = $state<ExtendedProject | null>(null);

  let showNewKeyModal = $state(false);
  let newKeyProjectId = $state('');
  let openKeyDropdownId = $state<string | null>(null);

  $effect(() => {
    if (showNewKeyModal && !newKeyProjectId && localProjects.length > 0) {
      newKeyProjectId = localProjects[0].id;
    }
  });

  async function handleCreateNewKey(): Promise<void> {
    if (!newKeyProjectId) return;
    try {
      const issued = await api.createToken({ project_id: newKeyProjectId });
      localKeys = [toKey(issued, account.id), ...localKeys];
      revealedSecret = issued.token;
      showNewKeyModal = false;
    } catch (err: unknown) {
      alert(`Failed to create key: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // New Project Form State
  let newProjectName = $state('');
  let newProjectSlug = $state('');
  let newProjectDesc = $state('');
  let newProjectRpm = $state(10);

  // Filtered lists
  const filteredProjects = $derived(
    localProjects.filter((p) => {
      if (projectFilter === 'live' && p.isArchived) return false;
      if (projectFilter === 'archived' && !p.isArchived) return false;
      return true;
    })
  );

  const liveProjectsCount = $derived(localProjects.filter((p) => !p.isArchived).length);
  const archivedProjectsCount = $derived(localProjects.filter((p) => p.isArchived).length);

  const filteredKeys = $derived(
    localKeys.filter((k) => {
      if (keyProjectFilter !== 'all' && k.projectId !== keyProjectFilter) {
        const matchProj = localProjects.find((p) => p.id === k.projectId);
        if (!matchProj || matchProj.name !== keyProjectFilter) {
          return false;
        }
      }
      if (keySearch.trim() !== '') {
        const q = keySearch.toLowerCase();
        const proj = localProjects.find((p) => p.id === k.projectId);
        return (
          k.name.toLowerCase().includes(q) ||
          k.tokenPrefix.toLowerCase().includes(q) ||
          k.id.toLowerCase().includes(q) ||
          (proj && proj.name.toLowerCase().includes(q))
        );
      }
      return true;
    })
  );

  function getProjectKeyCount(projectId: string): number {
    return localKeys.filter((k) => k.projectId === projectId && !k.isRevoked).length;
  }

  function getProjectName(projectId: string): string {
    const p = localProjects.find((proj) => proj.id === projectId);
    return p ? p.name : '—';
  }

  async function handleRotateKey(keyId: string): Promise<void> {
    try {
      const issued = await api.rotateToken(keyId);
      localKeys = localKeys.map((k) => (k.id === keyId ? { ...toKey(issued, account.id), displayTime: 'Just now' } : k));
      revealedSecret = issued.token;
      onRotateKey?.(keyId);
    } catch (err: unknown) {
      alert(`Failed to rotate key: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleRotateProjectKey(projectId: string): Promise<void> {
    const projectKey = localKeys.find((k) => k.projectId === projectId && !k.isRevoked);
    if (projectKey) {
      await handleRotateKey(projectKey.id);
      return;
    }
    try {
      const issued = await api.createToken({ project_id: projectId });
      localKeys = [toKey(issued, account.id), ...localKeys];
      revealedSecret = issued.token;
    } catch (err: unknown) {
      alert(`Failed to create a key for this project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleDeleteProject(projectId: string): Promise<void> {
    const proj = localProjects.find((p) => p.id === projectId);
    if (!confirm(`Delete project "${proj?.name || projectId}"? Its API keys stay valid but are no longer scoped to it.`)) {
      return;
    }
    try {
      await api.deleteProject(projectId);
      localProjects = localProjects.filter((p) => p.id !== projectId);
      localKeys = localKeys.map((k) => (k.projectId === projectId ? { ...k, projectId: '' } : k));
      if (showProjectSettingsModal?.id === projectId) showProjectSettingsModal = null;
    } catch (err: unknown) {
      alert(`Failed to delete project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Revoking deletes the API key on the server; the row goes once the server confirms. */
  async function handleRevokeKey(keyId: string): Promise<void> {
    try {
      await api.revokeToken(keyId);
      localKeys = localKeys.filter((k) => k.id !== keyId);
      onRevokeKey?.(keyId);
    } catch (err: unknown) {
      alert(`Failed to revoke key: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Pessimistic project edit: local state changes only after the server stored it. */
  async function saveProject(
    id: string,
    payload: { name?: string; is_archived?: boolean; rpm_sub_cap?: number | null }
  ): Promise<void> {
    projectSettingsError = null;
    try {
      const saved = await api.updateProject(id, payload);
      localProjects = localProjects.map((p, idx) => (p.id === id ? { ...toProject({ ...saved, tenant_id: p.tenantId }, idx), createdAt: p.createdAt } : p));
      showProjectSettingsModal = localProjects.find((p) => p.id === id) ?? null;
    } catch (err: unknown) {
      projectSettingsError = err instanceof Error ? err.message : 'Could not save the project';
    }
  }

  async function handleCreateNewProject(): Promise<void> {
    if (!newProjectName.trim()) return;
    try {
      let created = await api.createProject({
        name: newProjectName.trim(),
        description: newProjectDesc.trim() || undefined,
      });
      if (newProjectRpm > 0) {
        created = await api.updateProject(created.id, { rpm_sub_cap: newProjectRpm });
      }
      const project = toProject(created, localProjects.length);
      localProjects = [...localProjects, project];
      onCreateProject?.(project);
      newProjectName = '';
      newProjectSlug = '';
      newProjectDesc = '';
      newProjectRpm = 10;
      showNewProjectModal = false;
    } catch (err: unknown) {
      alert(`Failed to create project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleExportMarkdown(): void {
    const md = generateMarkdownExport(account, selectedTier, currentLimits, localProjects, localKeys);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workbench-${account.githubUsername || 'export'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    exportDropdownOpen = false;
  }

  /** Opens the browser print dialog for this page; it does not generate a document. */
  function handlePrintView(): void {
    exportDropdownOpen = false;
    window.print();
  }

  // Live UTC Clock for bottom edge ticker
  let currentUtcString = $state('');
  $effect(() => {
    function updateClock() {
      const now = new Date();
      currentUtcString = `UTC ${now.toISOString().replace('T', ' ').substring(0, 19)}`;
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  });
</script>

<main class="flex-1 p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto overflow-y-auto w-full">
  <!-- Demo / Unauthenticated Gate Overlay -->
  {#if (account.tier === 'demo' || !account.id) && account.tier !== 'admin'}
    <div class="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[#090B10]/90 backdrop-blur-xl">
      <div class="flex flex-col items-center gap-6 max-w-md text-center p-8 rounded-2xl border border-outline-variant/30 bg-surface-container-low shadow-2xl">
        <span class="material-symbols-outlined text-[56px] text-primary">lock</span>
        <div>
          <h2 class="font-headline-md text-headline-md font-semibold text-on-surface mb-2">Developer Workbench</h2>
          <p class="font-body-md text-body-md text-outline">
            Sign in with <strong class="text-on-surface">GitHub</strong> or <strong class="text-on-surface">Google</strong> to access the Developer Workbench and manage your API keys, projects, and provider pools.
          </p>
        </div>
        <div class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary font-label-sm text-label-sm">
          <span class="material-symbols-outlined text-[16px]">info</span>
          Demo mode has limited Playground access only (1 RPM · 5 RPD)
        </div>
      </div>
    </div>
  {/if}

  <!-- Google-only: community pool notice -->
  {#if account.authProvider === 'google' && account.tier !== 'demo' && account.id}
    <div class="flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary/8 border border-secondary/20 text-secondary font-body-sm text-body-sm">
      <span class="material-symbols-outlined text-[18px]">info</span>
      <span>You're signed in with Google. Community pool contributions require a <strong>GitHub</strong> account — private pools are fully available.</span>
    </div>
  {/if}

  <!-- Top Title & Quick Actions Row -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <div class="flex items-center gap-2 mb-1">
        <span class="font-label-sm text-label-sm text-primary uppercase font-mono">Governance Console</span>
      </div>
      <h1 class="font-headline-lg text-headline-lg font-semibold text-on-surface tracking-tight">
        Developer Workbench &amp; Governance
      </h1>
    </div>

    <!-- Quick Actions -->
    <div class="flex items-center gap-2">
      <!-- Export Dropdown -->
      <div class="relative inline-block text-left">
        <button
          type="button"
          onclick={() => (exportDropdownOpen = !exportDropdownOpen)}
          class="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-body-sm text-body-sm hover:bg-surface-container-high transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined text-[16px]">download</span>
          <span>Export Workspace</span>
          <span class="material-symbols-outlined text-[14px]">expand_more</span>
        </button>

        {#if exportDropdownOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="fixed inset-0 z-10"
            onclick={() => (exportDropdownOpen = false)}
          ></div>
          <div class="absolute right-0 mt-1 w-56 rounded-lg bg-surface-container-highest border border-outline-variant/30 shadow-xl z-20 p-1">
            <button
              type="button"
              onclick={handleExportMarkdown}
              class="w-full text-left px-3 py-2 text-xs font-code-sm text-on-surface hover:bg-surface-container-high rounded flex items-center gap-2 cursor-pointer transition-colors"
            >
              <span class="material-symbols-outlined text-[14px] text-primary">description</span>
              Export Markdown Configuration
            </button>
            <button
              type="button"
              onclick={handlePrintView}
              class="w-full text-left px-3 py-2 text-xs font-code-sm text-on-surface hover:bg-surface-container-high rounded flex items-center gap-2 cursor-pointer transition-colors"
            >
              <span class="material-symbols-outlined text-[14px] text-secondary">print</span>
              Print view
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- 1. Identity & Anti-Sybil Trust Gauge Card -->
  <IdentityCard
    {account}
    onCreateKeyClick={() => (showNewKeyModal = true)}
  />

  <!-- 2. Quota Hierarchy & Governance Tiers Matrix -->
  <TierMatrixSection
    tierMatrix={TIER_MATRIX}
    {selectedTier}
  />

  <!-- 3. Multi-Project Management Section -->
  <ProjectsSection
    projects={filteredProjects}
    {projectFilter}
    {liveProjectsCount}
    {archivedProjectsCount}
    onFilterChange={(f) => (projectFilter = f)}
    onCreateProjectClick={() => (showNewProjectModal = true)}
    onCreateKeyClick={() => (showNewKeyModal = true)}
    onOpenSettings={(p) => (showProjectSettingsModal = p)}
    onRotateKey={handleRotateProjectKey}
    onDeleteProject={handleDeleteProject}
    {getProjectKeyCount}
  />

  <!-- 3.5 My Contributed Provider Keys -->
  <ProviderKeysSection
    {providerKeys}
    {providerKeysLoading}
    authProvider={account.authProvider}
    onRotate={rotateProviderKey}
    onOpenSwitchPool={openSwitchPoolModal}
    onDelete={deleteProviderKey}
  />

  <!-- 4. Project-Scoped API Keys Table -->
  <KeysSection
    keys={filteredKeys}
    projects={localProjects}
    bind:keySearch
    bind:keyProjectFilter
    {openKeyDropdownId}
    onSearchChange={(val) => (keySearch = val)}
    onProjectFilterChange={(val) => (keyProjectFilter = val)}
    onCreateKeyClick={() => (showNewKeyModal = true)}
    onRotateKey={handleRotateKey}
    onRevokeKey={handleRevokeKey}
    onToggleDropdown={(id) => (openKeyDropdownId = id)}
    {getProjectName}
  />

  <!-- 5. Bottom clock (no invented status claims, QA-05) -->
  <div class="flex items-center justify-end p-3 rounded-xl bg-surface-container-lowest border border-outline-variant/20 font-code-sm text-code-sm text-outline font-mono">
    <span>{currentUtcString}</span>
  </div>
</main>

<!-- Modals Component Container -->
<Modals
  {showVerificationProofModal}
  onCloseVerificationProofModal={() => (showVerificationProofModal = false)}
  {showNewProjectModal}
  onCloseNewProjectModal={() => (showNewProjectModal = false)}
  onCreateProjectSubmit={handleCreateNewProject}
  bind:newProjectName
  bind:newProjectSlug
  bind:newProjectDesc
  bind:newProjectRpm
  {showNewKeyModal}
  onCloseNewKeyModal={() => (showNewKeyModal = false)}
  onCreateKeySubmit={handleCreateNewKey}
  bind:newKeyProjectId
  projects={localProjects}
  {showProjectSettingsModal}
  onCloseProjectSettingsModal={() => { showProjectSettingsModal = null; projectSettingsError = null; }}
  onArchiveProjectToggle={(id) => {
    const target = localProjects.find((p) => p.id === id);
    void saveProject(id, { is_archived: !target?.isArchived });
  }}
  onSaveProjectName={(id, name) => void saveProject(id, { name })}
  onSaveProjectRpm={(id, rpm) => void saveProject(id, { rpm_sub_cap: rpm })}
  {projectSettingsError}
  {revealedSecret}
  onCloseSecret={() => (revealedSecret = null)}
  onDeleteProject={handleDeleteProject}
  {localKeys}
  {switchPoolModalOpen}
  {switchPoolTarget}
  {switchPoolLoading}
  {switchPoolError}
  onCloseSwitchPoolModal={() => (switchPoolModalOpen = false)}
  onConfirmSwitchPool={confirmSwitchPool}
/>
