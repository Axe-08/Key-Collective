<script lang="ts">
  import type { UserTier, TierLimits } from '../../../src/contracts/v3_types';
  import { TIER_LIMITS_MAP } from '../../../src/contracts/v3_types';
  import type { APIKey } from './types';
  import { api } from './api';

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
    onSelectTier,
    onCreateProject,
    onRotateKey,
    onRevokeKey,
    onDeleteKey,
    onToggleKeyStatus,
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

  $effect(() => {
    if (propProviderKeys && propProviderKeys.length > 0) {
      providerKeys = propProviderKeys;
      providerKeysLoading = false;
      return;
    }

    api.getKeys()
      .then((data) => {
        if (Array.isArray(data)) {
          providerKeys = data;
        } else if (data && Array.isArray((data as any).keys)) {
          providerKeys = (data as any).keys;
        } else {
          providerKeys = [];
        }
      })
      .catch((err) => {
        console.error('Failed to fetch keys', err);
        providerKeys = [];
      })
      .finally(() => {
        providerKeysLoading = false;
      });
  });

  function rotateProviderKey(id: string) {
    providerKeys = providerKeys.map((k) => {
      if (k.id === id) {
        return { ...k, key_prefix: 'kc_prov_' + Math.random().toString(36).substring(2, 9) };
      }
      return k;
    });
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
    switchPoolLoading = true;
    switchPoolError = null;
    try {
      const res = await fetch(`/api/keys/${switchPoolTarget.keyId}/pool-mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_type: switchPoolTarget.targetPool })
      });
      if (res.status === 423) {
        switchPoolError = "Anti-Midnight Freeze: Pool switching is frozen during the midnight UTC reset window (23:30–00:30 UTC).";
        return;
      }
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || "Failed to switch pool");
      }
      
      const updatedKeyData = await res.json();
      providerKeys = providerKeys.map((k) => {
        if (k.id === switchPoolTarget.keyId) {
          return { 
            ...k, 
            pool_type: updatedKeyData.pool_type,
            community_routing_status: updatedKeyData.community_routing_status,
            observation_until: updatedKeyData.observation_until
          };
        }
        return k;
      });
      switchPoolModalOpen = false;
      switchPoolTarget = null;
      if (onRefreshProviderKeys) {
        onRefreshProviderKeys();
      }
    } catch (e: any) {
      switchPoolError = e.message;
    } finally {
      switchPoolLoading = false;
    }
  }

  function deleteProviderKey(id: string) {
    providerKeys = providerKeys.filter((k) => k.id !== id);
  }

  // Selected Tier state: defaults to account tier or builder
  let selectedTier = $state<UserTier>('builder');

  $effect(() => {
    if (account?.tier) {
      selectedTier = account.tier;
    }
  });

  $effect(() => {
    if (projects && projects.length > 0) {
      localProjects = projects.map((p, idx) => ({
        ...p,
        assignedRpm: p.maxRpmSubCap ? Math.round(p.maxRpmSubCap * 0.7) : 10,
        latencyMs: 11 + (idx % 3) * 5,
        latency: `${11 + (idx % 3) * 5}ms avg`,
        icon: idx % 2 === 0 ? 'hub' : 'psychology',
        iconColor: idx % 2 === 0 ? 'text-primary' : 'text-tertiary',
      }));
    } else {
      localProjects = [];
    }
  });

  $effect(() => {
    if (keys && keys.length > 0) {
      localKeys = keys.map((k) => ({
        ...k,
        fullSecret: `${k.tokenPrefix}44781d09e`,
        displayTime: formatRelativeTime(k.lastUsedAt),
        displayCreated: `Created ${formatDate(k.createdAt)}`,
      }));
    } else {
      localKeys = [];
    }
  });

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

  let copiedKeyId = $state<string | null>(null);

  let showNewKeyModal = $state(false);
  let newKeyName = $state('');
  let newKeyProjectId = $state('');
  let openKeyDropdownId = $state<string | null>(null);

  $effect(() => {
    if (showNewKeyModal && !newKeyProjectId && localProjects.length > 0) {
      newKeyProjectId = localProjects[0].id;
    }
  });

  function handleCreateNewKey(): void {
    if (!newKeyName.trim() || !newKeyProjectId) return;
    
    const keySuffix = Math.random().toString(36).substring(2, 9);
    const newKey = {
      id: `key_${Date.now()}`,
      projectId: newKeyProjectId,
      tenantId: account.id,
      name: newKeyName.trim(),
      tokenPrefix: `kc_proj_live_${keySuffix}`,
      tokenHashSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      fullSecret: `kc_proj_live_${keySuffix}1198f3`,
      displayTime: 'Just now',
      displayCreated: `Created ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      isRevoked: false,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
    };
    localKeys = [newKey, ...localKeys];

    newKeyName = '';
    showNewKeyModal = false;
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

  function selectTier(tier: UserTier): void {
    selectedTier = tier;
    if (onSelectTier) {
      onSelectTier(tier);
    }
  }

  function getProjectKeyCount(projectId: string): number {
    return localKeys.filter((k) => k.projectId === projectId && !k.isRevoked).length;
  }

  function getProjectName(projectId: string): string {
    const p = localProjects.find((proj) => proj.id === projectId);
    return p ? p.name : 'Production Gateway';
  }

  async function copyKeySecret(secret: string, keyId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      copiedKeyId = keyId;
      setTimeout(() => {
        if (copiedKeyId === keyId) copiedKeyId = null;
      }, 2000);
    } catch {
      copiedKeyId = keyId;
      setTimeout(() => {
        if (copiedKeyId === keyId) copiedKeyId = null;
      }, 2000);
    }
  }

  function handleRotateKey(keyId: string): void {
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const newPrefix = `kc_proj_live_${randomSuffix}`;
    localKeys = localKeys.map((k) => {
      if (k.id === keyId && !k.isRevoked) {
        return {
          ...k,
          tokenPrefix: newPrefix,
          fullSecret: `${newPrefix}44781d09e`,
          displayTime: 'Just now',
        };
      }
      return k;
    });

    if (onRotateKey) {
      onRotateKey(keyId);
    }
  }

  function handleRevokeKey(keyId: string): void {
    localKeys = localKeys.map((k) => {
      if (k.id === keyId) {
        return {
          ...k,
          isRevoked: true,
        };
      }
      return k;
    });
    if (onRevokeKey) {
      onRevokeKey(keyId);
    }
  }

  function handleDeleteKey(keyId: string): void {
    localKeys = localKeys.filter((k) => k.id !== keyId);
    if (onDeleteKey) {
      onDeleteKey(keyId);
    }
  }

  function handleToggleKey(keyId: string): void {
    localKeys = localKeys.map((k) => {
      if (k.id === keyId) {
        return {
          ...k,
          isRevoked: !k.isRevoked,
        };
      }
      return k;
    });
    if (onToggleKeyStatus) {
      onToggleKeyStatus(keyId);
    }
  }

  function handleCreateNewProject(): void {
    if (!newProjectName.trim()) return;
    const slug = newProjectSlug.trim() || newProjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const newId = `proj_${Date.now()}`;
    const newProj: ExtendedProject = {
      id: newId,
      tenantId: account.id,
      name: newProjectName.trim(),
      slug: slug,
      description: newProjectDesc.trim() || 'Custom AI routing project namespace',
      maxRpmSubCap: newProjectRpm,
      assignedRpm: Math.round(newProjectRpm * 0.7),
      latencyMs: 14,
      latency: '14ms avg',
      icon: 'folder',
      iconColor: 'text-primary',
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    localProjects = [...localProjects, newProj];

    // Also issue initial key for this project
    const keySuffix = Math.random().toString(36).substring(2, 9);
    const newKey: ExtendedKey = {
      id: `key_${Date.now()}`,
      projectId: newId,
      tenantId: account.id,
      name: `${slug}-primary-key`,
      tokenPrefix: `kc_proj_live_${keySuffix}`,
      tokenHashSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      fullSecret: `kc_proj_live_${keySuffix}1198f3`,
      displayTime: 'Just now',
      displayCreated: `Created ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      isRevoked: false,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
    };
    localKeys = [newKey, ...localKeys];

    if (onCreateProject) {
      onCreateProject(newProj);
    }

    // Reset form
    newProjectName = '';
    newProjectSlug = '';
    newProjectDesc = '';
    newProjectRpm = 10;
    showNewProjectModal = false;
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

  function handleExportPdf(): void {
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
  <!-- Top Title & Quick Actions Row -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <div class="flex items-center gap-2 mb-1">
        <span class="font-label-sm text-label-sm text-primary uppercase font-mono">Governance Console</span>
        <span class="text-outline">•</span>
        <span class="font-label-sm text-label-sm text-outline font-mono">Cluster iad-edge-01</span>
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
              onclick={handleExportPdf}
              class="w-full text-left px-3 py-2 text-xs font-code-sm text-on-surface hover:bg-surface-container-high rounded flex items-center gap-2 cursor-pointer transition-colors"
            >
              <span class="material-symbols-outlined text-[14px] text-secondary">picture_as_pdf</span>
              Export PDF Audit Dossier
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

  <!-- 2. Quota Hierarchy & Governance Tiers -->
  {#if account.tier === 'admin'}
    <TierMatrixSection
      tierMatrix={TIER_MATRIX}
      {selectedTier}
      onSelectTier={selectTier}
    />
  {/if}

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
    onRotateKey={handleRotateKey}
    {getProjectKeyCount}
  />

  <!-- 3.5 My Contributed Provider Keys -->
  <ProviderKeysSection
    {providerKeys}
    {providerKeysLoading}
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
    {copiedKeyId}
    {openKeyDropdownId}
    onSearchChange={(val) => (keySearch = val)}
    onProjectFilterChange={(val) => (keyProjectFilter = val)}
    onCreateKeyClick={() => (showNewKeyModal = true)}
    onCopyKeySecret={copyKeySecret}
    onToggleKey={handleToggleKey}
    onRotateKey={handleRotateKey}
    onRevokeKey={handleRevokeKey}
    onDeleteKey={handleDeleteKey}
    onToggleDropdown={(id) => (openKeyDropdownId = id)}
    {getProjectName}
  />

  <!-- 5. Bottom Edge Telemetry Ticker -->
  <div class="flex flex-wrap items-center justify-between gap-4 p-3 rounded-xl bg-surface-container-lowest border border-outline-variant/20 font-code-sm text-code-sm text-on-surface-variant font-mono">
    <div class="flex items-center gap-4 flex-wrap">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-secondary shadow-[0_0_6px_rgba(78,222,163,0.6)]"></span>
        <span>System Status: <span class="text-on-surface font-semibold">NOMINAL</span></span>
      </div>
      <span class="text-outline">•</span>
      <div>Security: <span class="text-secondary font-medium">Verified (Web Crypto)</span></div>
      <span class="text-outline">•</span>
      <div>Cloudflare Edge: <span class="text-secondary font-medium">Protected • Latency Nominal</span></div>
    </div>
    <div class="flex items-center gap-2 text-outline">
      <span>{currentUtcString || 'UTC 2024-11-14 08:34:11'}</span>
    </div>
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
  bind:newKeyName
  bind:newKeyProjectId
  projects={localProjects}
  {showProjectSettingsModal}
  onCloseProjectSettingsModal={() => (showProjectSettingsModal = null)}
  onArchiveProjectToggle={(id) => {
    localProjects = localProjects.map((p) => p.id === id ? { ...p, isArchived: !p.isArchived } : p);
    showProjectSettingsModal = localProjects.find(p => p.id === id) ?? null;
  }}
  onSaveProjectName={(id, name) => {
    localProjects = localProjects.map(p => p.id === id ? { ...p, name } : p);
    showProjectSettingsModal = localProjects.find(p => p.id === id) ?? null;
  }}
  onSaveProjectRpm={(id, rpm) => {
    localProjects = localProjects.map(p => p.id === id ? { ...p, maxRpmSubCap: rpm, assignedRpm: Math.round(rpm * 0.7) } : p);
    showProjectSettingsModal = localProjects.find(p => p.id === id) ?? null;
  }}
  {localKeys}
  {switchPoolModalOpen}
  {switchPoolTarget}
  {switchPoolLoading}
  {switchPoolError}
  onCloseSwitchPoolModal={() => (switchPoolModalOpen = false)}
  onConfirmSwitchPool={confirmSwitchPool}
/>
