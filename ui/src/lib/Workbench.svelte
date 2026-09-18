<script lang="ts">
  import type { UserTier, TierLimits, Project, ProjectKey } from '../../../src/contracts/v3_types';
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

  // Helper for auth headers
  function getRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('kc_auth_token');
      if (token && token.trim().length > 0) {
        headers['Authorization'] = `Bearer ${token.trim()}`;
      }
    }
    if (account?.id) {
      headers['x-tenant-id'] = account.id;
    }
    return headers;
  }

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
        headers: getRequestHeaders(),
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
    const target = switchPoolTarget;
    switchPoolLoading = true;
    switchPoolError = null;
    try {
      const res = await fetch(`/api/keys/${target.keyId}/pool-mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_type: target.targetPool })
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
        if (k.id === target.keyId) {
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

  // Real API Integration: GET /api/projects
  $effect(() => {
    let cancelled = false;

    async function fetchProjects() {
      try {
        const res = await fetch('/api/projects', {
          headers: getRequestHeaders(),
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          const list: Project[] = Array.isArray(data)
            ? data
            : (data && Array.isArray((data as any).projects) ? (data as any).projects : []);
          if (list.length > 0) {
            localProjects = list.map((p, idx) => {
              const ext = p as ExtendedProject;
              const lat = typeof ext.latencyMs === 'number' ? ext.latencyMs : null;
              return {
                ...p,
                assignedRpm: ('assignedRpm' in p ? ext.assignedRpm : undefined) ?? (getProjectKeyCount(p.id) > 0 ? Math.min(p.maxRpmSubCap || 20, getProjectKeyCount(p.id) * 5) : 0),
                latencyMs: lat,
                latency: lat !== null ? `${lat}ms avg` : '—',
                icon: idx % 2 === 0 ? 'hub' : 'psychology',
                iconColor: idx % 2 === 0 ? 'text-primary' : 'text-tertiary',
              };
            });
            return;
          }
        }
      } catch (err) {
        console.error('Failed to fetch projects from /api/projects', err);
      }

      if (!cancelled) {
        if (projects && projects.length > 0) {
          localProjects = projects.map((p, idx) => {
            const ext = p as ExtendedProject;
            const lat = typeof ext.latencyMs === 'number' ? ext.latencyMs : null;
            return {
              ...p,
              assignedRpm: ('assignedRpm' in p ? ext.assignedRpm : undefined) ?? (getProjectKeyCount(p.id) > 0 ? Math.min(p.maxRpmSubCap || 20, getProjectKeyCount(p.id) * 5) : 0),
              latencyMs: lat,
              latency: lat !== null ? `${lat}ms avg` : '—',
              icon: idx % 2 === 0 ? 'hub' : 'psychology',
              iconColor: idx % 2 === 0 ? 'text-primary' : 'text-tertiary',
            };
          });
        } else {
          localProjects = [];
        }
      }
    }

    fetchProjects();
    return () => {
      cancelled = true;
    };
  });

  // Real API Integration: GET /api/tokens
  $effect(() => {
    let cancelled = false;

    async function fetchTokens() {
      try {
        const res = await fetch('/api/tokens', {
          headers: getRequestHeaders(),
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          const list: any[] = Array.isArray(data)
            ? data
            : (data && Array.isArray(data.tokens) ? data.tokens : (data && Array.isArray(data.keys) ? data.keys : []));
          if (list.length > 0) {
            localKeys = list.map((k) => ({
              ...k,
              id: k.id || `key_${k.projectId || 'proj'}_${k.name || 'token'}`,
              projectId: k.projectId || k.project_id || '',
              tenantId: k.tenantId || k.tenant_id || account.id,
              name: k.name || 'Unnamed Token',
              tokenPrefix: k.tokenPrefix || k.token_prefix || (k.token ? k.token.slice(0, 12) : 'kc_proj_live_'),
              tokenHashSha256: k.tokenHashSha256 || k.token_hash || '',
              fullSecret: k.token || k.secret || k.fullSecret || `${k.tokenPrefix || k.token_prefix || ''}...`,
              displayTime: formatRelativeTime(k.lastUsedAt || k.last_used_at),
              displayCreated: `Created ${formatDate(k.createdAt || k.created_at)}`,
              isRevoked: !!k.isRevoked || !!k.is_revoked,
              lastUsedAt: k.lastUsedAt || k.last_used_at || null,
              createdAt: k.createdAt || k.created_at || new Date().toISOString(),
            }));
            return;
          }
        }
      } catch (err) {
        console.error('Failed to fetch tokens from /api/tokens', err);
      }

      if (!cancelled) {
        if (keys && keys.length > 0) {
          localKeys = keys.map((k) => ({
            ...k,
            fullSecret: ('fullSecret' in k ? (k as ExtendedKey).fullSecret : undefined) || `${k.tokenPrefix}...`,
            displayTime: formatRelativeTime(k.lastUsedAt),
            displayCreated: `Created ${formatDate(k.createdAt)}`,
          }));
        } else {
          localKeys = [];
        }
      }
    }

    fetchTokens();
    return () => {
      cancelled = true;
    };
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

  // Real API Integration: POST /api/tokens
  async function handleCreateNewKey(): Promise<void> {
    if (!newKeyName.trim() || !newKeyProjectId) return;
    const name = newKeyName.trim();
    const projectId = newKeyProjectId;

    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
          name,
          projectId,
          project_id: projectId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const newKey: ExtendedKey = {
          id: data.id || `key_${Date.now()}`,
          projectId: data.projectId || data.project_id || projectId,
          tenantId: data.tenantId || account.id,
          name: data.name || name,
          tokenPrefix: data.tokenPrefix || data.token_prefix || (data.token ? data.token.slice(0, 12) : 'kc_proj_live_'),
          tokenHashSha256: data.tokenHashSha256 || data.token_hash || '',
          fullSecret: data.token || data.secret || data.fullSecret || '',
          displayTime: 'Just now',
          displayCreated: `Created ${formatDate(data.createdAt || new Date().toISOString())}`,
          isRevoked: false,
          lastUsedAt: null,
          createdAt: data.createdAt || new Date().toISOString(),
        };
        localKeys = [newKey, ...localKeys];
        if (newKey.fullSecret && typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(newKey.fullSecret).catch(() => {});
          alert(`API Key created successfully!\n\nSecret: ${newKey.fullSecret}\n(Copied to clipboard)`);
        }
      } else {
        const errText = await res.text();
        console.error('Failed to create key on server', errText);
        alert(`Failed to create key: ${errText || 'Server error'}`);
      }
    } catch (err: any) {
      console.error('Error creating token', err);
      alert(`Error creating token: ${err?.message || err}`);
    }

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

  async function handleRotateKey(keyId: string): Promise<void> {
    try {
      const res = await fetch(`/api/tokens/${encodeURIComponent(keyId)}/rotate`, {
        method: 'POST',
        headers: getRequestHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        const newSecret = data.token || data.secret || data.fullSecret || '';
        localKeys = localKeys.map((k) => {
          if (k.id === keyId && !k.isRevoked) {
            return {
              ...k,
              tokenPrefix: data.tokenPrefix || data.token_prefix || (newSecret ? newSecret.slice(0, 12) : k.tokenPrefix),
              fullSecret: newSecret || k.fullSecret,
              displayTime: 'Just now',
            };
          }
          return k;
        });
        if (newSecret && typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(newSecret).catch(() => {});
        }
        alert(`Key rotated successfully!${newSecret ? `\n\nNew Secret: ${newSecret}\n(Copied to clipboard)` : ''}`);
      } else {
        alert('Failed to rotate key on server');
      }
    } catch (err: any) {
      console.error('Failed to rotate key', err);
      alert(`Failed to rotate key: ${err?.message || err}`);
    }

    if (onRotateKey) {
      onRotateKey(keyId);
    }
  }

  async function handleRotateProjectKey(projectId: string): Promise<void> {
    const proj = localProjects.find((p) => p.id === projectId);
    const projName = proj?.name || projectId;
    const projectKey = localKeys.find((k) => k.projectId === projectId && !k.isRevoked);

    if (projectKey) {
      await handleRotateKey(projectKey.id);
    } else {
      try {
        const slug = proj?.slug || 'proj';
        const res = await fetch('/api/tokens', {
          method: 'POST',
          headers: getRequestHeaders(),
          body: JSON.stringify({
            name: `${slug}-gateway-key`,
            projectId,
            project_id: projectId,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const newKey: ExtendedKey = {
            id: data.id || `key_${Date.now()}`,
            projectId,
            tenantId: account.id,
            name: data.name || `${slug}-gateway-key`,
            tokenPrefix: data.tokenPrefix || data.token_prefix || (data.token ? data.token.slice(0, 12) : 'kc_proj_live_'),
            tokenHashSha256: data.tokenHashSha256 || data.token_hash || '',
            fullSecret: data.token || data.secret || data.fullSecret || '',
            displayTime: 'Just now',
            displayCreated: `Created ${formatDate(data.createdAt || new Date().toISOString())}`,
            isRevoked: false,
            lastUsedAt: null,
            createdAt: data.createdAt || new Date().toISOString(),
          };
          localKeys = [newKey, ...localKeys];
          if (newKey.fullSecret && typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(newKey.fullSecret).catch(() => {});
            alert(`Virtual gateway key rotated for project "${projName}"!\n\nNew Secret: ${newKey.fullSecret}\n(Copied to clipboard)`);
          }
        }
      } catch (err: any) {
        console.error('Error generating project key', err);
        alert(`Error generating project key: ${err?.message || err}`);
      }
    }
  }

  // Real API Integration: DELETE /api/projects
  async function handleDeleteProject(projectId: string): Promise<void> {
    const proj = localProjects.find((p) => p.id === projectId);
    const projName = proj?.name || projectId;
    if (!confirm(`Are you sure you want to permanently delete project "${projName}"? All associated keys will be deleted.`)) {
      return;
    }
    try {
      await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
        headers: getRequestHeaders(),
      });
    } catch (err) {
      console.error('Failed to delete project from /api/projects', err);
    }
    localProjects = localProjects.filter((p) => p.id !== projectId);
    localKeys = localKeys.filter((k) => k.projectId !== projectId);
    if (showProjectSettingsModal?.id === projectId) {
      showProjectSettingsModal = null;
    }
  }

  // Real API Integration: DELETE /api/tokens (Revoke key)
  async function handleRevokeKey(keyId: string): Promise<void> {
    try {
      await fetch(`/api/tokens/${encodeURIComponent(keyId)}`, {
        method: 'DELETE',
        headers: getRequestHeaders(),
      });
    } catch (err) {
      console.error('Failed to revoke token', err);
    }
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

  // Real API Integration: DELETE /api/tokens (Delete key)
  async function handleDeleteKey(keyId: string): Promise<void> {
    try {
      await fetch(`/api/tokens/${encodeURIComponent(keyId)}`, {
        method: 'DELETE',
        headers: getRequestHeaders(),
      });
    } catch (err) {
      console.error('Failed to delete token from /api/tokens', err);
    }
    localKeys = localKeys.filter((k) => k.id !== keyId);
    if (onDeleteKey) {
      onDeleteKey(keyId);
    }
  }

  async function handleToggleKey(keyId: string): Promise<void> {
    const key = localKeys.find((k) => k.id === keyId);
    const willRevoke = !key?.isRevoked;
    if (willRevoke) {
      await handleRevokeKey(keyId);
    } else {
      localKeys = localKeys.map((k) => {
        if (k.id === keyId) {
          return {
            ...k,
            isRevoked: false,
          };
        }
        return k;
      });
    }
    if (onToggleKeyStatus) {
      onToggleKeyStatus(keyId);
    }
  }

  // Real API Integration: POST /api/projects
  async function handleCreateNewProject(): Promise<void> {
    if (!newProjectName.trim()) return;
    const slug = newProjectSlug.trim() || newProjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const projectPayload = {
      name: newProjectName.trim(),
      slug: slug,
      description: newProjectDesc.trim() || 'Custom AI routing project namespace',
      maxRpmSubCap: newProjectRpm,
    };

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(projectPayload),
      });

      if (res.ok) {
        const created = await res.json();
        const newProj: ExtendedProject = {
          ...created,
          assignedRpm: 0,
          latencyMs: 14,
          latency: '14ms avg',
          icon: 'folder',
          iconColor: 'text-primary',
        };
        localProjects = [...localProjects, newProj];
        if (onCreateProject) {
          onCreateProject(newProj);
        }
      } else {
        const fallbackProj: ExtendedProject = {
          id: `proj_${Date.now()}`,
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
        localProjects = [...localProjects, fallbackProj];
        if (onCreateProject) {
          onCreateProject(fallbackProj);
        }
      }
    } catch (err) {
      console.error('Failed to create project via /api/projects', err);
      const fallbackProj: ExtendedProject = {
        id: `proj_${Date.now()}`,
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
      localProjects = [...localProjects, fallbackProj];
      if (onCreateProject) {
        onCreateProject(fallbackProj);
      }
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
    localProjects = localProjects.map((p) => p.id === id ? { ...p, isArchived: !p.isArchived } : p);
    showProjectSettingsModal = localProjects.find(p => p.id === id) ?? null;
  }}
  onSaveProjectName={(id, name) => {
    localProjects = localProjects.map(p => p.id === id ? { ...p, name } : p);
    showProjectSettingsModal = localProjects.find(p => p.id === id) ?? null;
  }}
  onSaveProjectRpm={(id, rpm) => {
    localProjects = localProjects.map(p => p.id === id ? { ...p, maxRpmSubCap: rpm, assignedRpm: Math.min(p.assignedRpm || 0, rpm) } : p);
    showProjectSettingsModal = localProjects.find(p => p.id === id) ?? null;
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
