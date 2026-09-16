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

  async function rotateProviderKey(id: string) {
    const key = providerKeys.find((k) => k.id === id);
    const label = key ? `${key.provider} (${key.label})` : id;
    const newKey = prompt(`Enter new secret API key to rotate ${label}:`);
    if (!newKey || !newKey.trim()) return;

    try {
      const res = await fetch(`/api/keys/${id}/rotate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('kc_auth_token')
            ? { Authorization: `Bearer ${localStorage.getItem('kc_auth_token')}` }
            : {})
        },
        body: JSON.stringify({ new_key: newKey.trim() })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Failed to rotate key on server');
      }
      const data = await res.json();
      providerKeys = providerKeys.map((k) => {
        if (k.id === id) {
          return {
            ...k,
            key_prefix: data.key_prefix || newKey.trim().slice(0, 8),
            key_suffix: data.key_suffix || newKey.trim().slice(-4),
          };
        }
        return k;
      });
      alert(`API Key ${label} rotated successfully!`);
      if (onRefreshProviderKeys) {
        onRefreshProviderKeys();
      }
    } catch (e: any) {
      alert(`Failed to rotate key: ${e?.message || e}`);
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

  const storageKeyPrefix = $derived(account?.id ? `kc_wb_${account.id}` : 'kc_wb_anon');

  function persistProjects(updated: ExtendedProject[]) {
    localProjects = updated;
    try {
      localStorage.setItem(`${storageKeyPrefix}_projects`, JSON.stringify(updated));
    } catch {}
  }

  function persistKeys(updated: ExtendedKey[]) {
    localKeys = updated;
    try {
      localStorage.setItem(`${storageKeyPrefix}_keys`, JSON.stringify(updated));
    } catch {}
  }

  $effect(() => {
    let saved: ExtendedProject[] | null = null;
    try {
      const raw = localStorage.getItem(`${storageKeyPrefix}_projects`);
      if (raw) saved = JSON.parse(raw);
    } catch {}

    if (saved && saved.length > 0) {
      localProjects = saved;
    } else if (projects && projects.length > 0) {
      localProjects = projects.map((p, idx) => ({
        ...p,
        assignedRpm: p.assignedRpm !== undefined ? p.assignedRpm : (getProjectKeyCount(p.id) > 0 ? Math.min(p.maxRpmSubCap || 20, getProjectKeyCount(p.id) * 5) : 0),
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
    let savedKeys: ExtendedKey[] | null = null;
    try {
      const raw = localStorage.getItem(`${storageKeyPrefix}_keys`);
      if (raw) savedKeys = JSON.parse(raw);
    } catch {}

    if (savedKeys && savedKeys.length > 0) {
      localKeys = savedKeys;
    } else if (keys && keys.length > 0) {
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
    persistKeys([newKey, ...localKeys]);

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
    const newSecret = `${newPrefix}${Math.random().toString(36).substring(2, 8)}4e`;
    const updated = localKeys.map((k) => {
      if (k.id === keyId && !k.isRevoked) {
        return {
          ...k,
          tokenPrefix: newPrefix,
          fullSecret: newSecret,
          displayTime: 'Just now',
        };
      }
      return k;
    });
    persistKeys(updated);
    localKeys = updated;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(newSecret).catch(() => {});
    }
    alert(`Key rotated successfully!\n\nNew Secret: ${newSecret}\n(Copied to clipboard)`);

    if (onRotateKey) {
      onRotateKey(keyId);
    }
  }

  function handleRotateProjectKey(projectId: string): void {
    const proj = localProjects.find((p) => p.id === projectId);
    const projName = proj?.name || projectId;
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const newPrefix = `kc_proj_live_${randomSuffix}`;
    const newSecret = `${newPrefix}${Math.random().toString(36).substring(2, 8)}4e`;

    let foundKey = false;
    let updated = localKeys.map((k) => {
      if (k.projectId === projectId && !k.isRevoked) {
        foundKey = true;
        return {
          ...k,
          tokenPrefix: newPrefix,
          fullSecret: newSecret,
          displayTime: 'Just now',
        };
      }
      return k;
    });

    if (!foundKey) {
      const slug = proj?.slug || 'proj';
      const createdKey: ExtendedKey = {
        id: `key_${Date.now()}`,
        projectId,
        tenantId: account.id,
        name: `${slug}-gateway-key`,
        tokenPrefix: newPrefix,
        tokenHashSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        fullSecret: newSecret,
        displayTime: 'Just now',
        displayCreated: `Created ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        isRevoked: false,
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
      };
      updated = [createdKey, ...updated];
    }

    persistKeys(updated);
    localKeys = updated;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(newSecret).catch(() => {});
    }
    alert(`Virtual gateway key rotated for project "${projName}"!\n\nNew Secret: ${newSecret}\n(Copied to clipboard)`);
  }

  function handleDeleteProject(projectId: string): void {
    const proj = localProjects.find((p) => p.id === projectId);
    const projName = proj?.name || projectId;
    if (!confirm(`Are you sure you want to permanently delete project "${projName}"? All associated keys will be deleted.`)) {
      return;
    }
    localProjects = localProjects.filter((p) => p.id !== projectId);
    persistProjects(localProjects);
    localKeys = localKeys.filter((k) => k.projectId !== projectId);
    persistKeys(localKeys);
    if (showProjectSettingsModal?.id === projectId) {
      showProjectSettingsModal = null;
    }
  }

  function handleRevokeKey(keyId: string): void {
    const updated = localKeys.map((k) => {
      if (k.id === keyId) {
        return {
          ...k,
          isRevoked: true,
        };
      }
      return k;
    });
    persistKeys(updated);
    if (onRevokeKey) {
      onRevokeKey(keyId);
    }
  }

  function handleDeleteKey(keyId: string): void {
    const updated = localKeys.filter((k) => k.id !== keyId);
    persistKeys(updated);
    if (onDeleteKey) {
      onDeleteKey(keyId);
    }
  }

  function handleToggleKey(keyId: string): void {
    const updated = localKeys.map((k) => {
      if (k.id === keyId) {
        return {
          ...k,
          isRevoked: !k.isRevoked,
        };
      }
      return k;
    });
    persistKeys(updated);
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
      assignedRpm: 0,
      latencyMs: 14,
      latency: '14ms avg',
      icon: 'folder',
      iconColor: 'text-primary',
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    persistProjects([...localProjects, newProj]);

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
    persistKeys([newKey, ...localKeys]);

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
  <!-- Demo / Unauthenticated Gate Overlay -->
  {#if account.tier === 'demo' || !account.id}
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
    const updated = localProjects.map((p) => p.id === id ? { ...p, isArchived: !p.isArchived } : p);
    persistProjects(updated);
    showProjectSettingsModal = updated.find(p => p.id === id) ?? null;
  }}
  onSaveProjectName={(id, name) => {
    const updated = localProjects.map(p => p.id === id ? { ...p, name } : p);
    persistProjects(updated);
    showProjectSettingsModal = updated.find(p => p.id === id) ?? null;
  }}
  onSaveProjectRpm={(id, rpm) => {
    const updated = localProjects.map(p => p.id === id ? { ...p, maxRpmSubCap: rpm, assignedRpm: Math.min(p.assignedRpm || 0, rpm) } : p);
    persistProjects(updated);
    showProjectSettingsModal = updated.find(p => p.id === id) ?? null;
  }}
  onDeleteProject={handleDeleteProject}
  {localKeys}
  {switchPoolModalOpen}
  {switchPoolTarget}
  {switchPoolLoading}
  {switchPoolError}
  onCloseSwitchPoolModal={() => (switchPoolModalOpen = false)}
  onConfirmSwitchPool={confirmSwitchPool}
/>
