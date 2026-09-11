<script lang="ts">
  import type { UserAccount, Project, ProjectKey, UserTier, TierLimits } from '../../../src/contracts/v3_types';
  import { TIER_LIMITS_MAP } from '../../../src/contracts/v3_types';

  interface Props {
    userAccount?: UserAccount;
    projects?: Project[];
    keys?: ProjectKey[];
    onSelectTier?: (tier: UserTier) => void;
    onCreateProject?: (project: Partial<Project>) => void;
    onRotateKey?: (projectId: string) => void;
    onRevokeKey?: (keyId: string) => void;
    onDeleteKey?: (keyId: string) => void;
    onToggleKeyStatus?: (keyId: string) => void;
  }

  let {
    userAccount,
    projects = [],
    keys = [],
    onSelectTier,
    onCreateProject,
    onRotateKey,
    onRevokeKey,
    onDeleteKey,
    onToggleKeyStatus,
  }: Props = $props();

  // Baseline mock account matching Stitch design if none provided
  const defaultUserAccount: UserAccount = {
    id: 'usr_gh_9824102',
    githubId: 9824102,
    githubUsername: 'collective-dev',
    primaryEmail: 'dev@collective.internal',
    tier: 'builder',
    avatarUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAWPkknyQU1Y7pEltc3GiG-QIbpylrlkULU7xBzv0t_9WJCtrJ0aTzsqN8cD8nn0sm8qK3yfAhmyYR77TmAbEQJ9jBfWzemeMAyh2p4YYn8I5jCNx9J8AUVKY0vTfEt77wnnH0Nbiu3ryTXZeVv9rajFVtnudeqawlJOk4GBRUpxoAduaQkflJafp5DpAUZMSmr6bh8b89Pgghbv5vD0KvPkNdZ0dMdZcWGDblUmqkhQ4itszZMhrST2gShjhSDr6NJS-6xFGB8yj4',
    isEmailVerified: true,
    githubCreatedAt: '2023-09-01T00:00:00.000Z',
    sybilScore: 92,
    registrationIp: '149.28.12.94',
    createdAt: '2023-09-01T00:00:00.000Z',
    updatedAt: '2024-11-14T08:34:11.000Z',
  };

  const account = $derived(userAccount ?? defaultUserAccount);

  // Extended types for UI enrichment
  interface ExtendedProject extends Project {
    assignedRpm?: number;
    latencyMs?: number;
    latency?: string;
    icon?: string;
    iconColor?: string;
  }

  interface ExtendedKey extends ProjectKey {
    fullSecret?: string;
    displayTime?: string;
    displayCreated?: string;
  }

  // Default initial projects matching Stitch Reference Screen 2
  const defaultProjects: ExtendedProject[] = [
    {
      id: 'proj_prod_gw',
      tenantId: 'usr_gh_9824102',
      name: 'Production Gateway',
      slug: 'production-gateway',
      description: 'Primary AI routing gateway and virtual key pool with automated failover.',
      maxRpmSubCap: 20,
      assignedRpm: 14,
      latencyMs: 11,
      latency: '11ms avg',
      icon: 'hub',
      iconColor: 'text-primary',
      isArchived: false,
      createdAt: '2024-10-14T10:00:00.000Z',
      updatedAt: '2024-10-14T10:00:00.000Z',
    },
    {
      id: 'proj_rag_eval',
      tenantId: 'usr_gh_9824102',
      name: 'RAG & Eval Suite',
      slug: 'rag-eval-suite',
      description: 'High-throughput evaluation pipelines and retrieval embeddings.',
      maxRpmSubCap: 10,
      assignedRpm: 2,
      latencyMs: 16,
      latency: '16ms avg',
      icon: 'psychology',
      iconColor: 'text-tertiary',
      isArchived: false,
      createdAt: '2024-11-02T10:00:00.000Z',
      updatedAt: '2024-11-02T10:00:00.000Z',
    },
  ];

  // Default initial keys matching Stitch Reference Screen 2
  const defaultKeys: ExtendedKey[] = [
    {
      id: 'key_prod_v3_pri',
      projectId: 'proj_prod_gw',
      tenantId: 'usr_gh_9824102',
      name: 'prod-gateway-v3-primary',
      tokenPrefix: 'kc_proj_live_8F9a21b',
      tokenHashSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      fullSecret: 'kc_proj_live_8F9a21b44781d09e',
      displayTime: '2 minutes ago',
      displayCreated: 'Created Oct 14, 2024',
      isRevoked: false,
      lastUsedAt: '2024-11-14T08:32:00.000Z',
      createdAt: '2024-10-14T10:00:00.000Z',
    },
    {
      id: 'key_rag_pipe',
      projectId: 'proj_rag_eval',
      tenantId: 'usr_gh_9824102',
      name: 'rag-eval-pipeline-key',
      tokenPrefix: 'kc_proj_live_3D4e77c',
      tokenHashSha256: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
      fullSecret: 'kc_proj_live_3D4e77c5901ba63',
      displayTime: '41 minutes ago',
      displayCreated: 'Created Nov 02, 2024',
      isRevoked: false,
      lastUsedAt: '2024-11-14T07:53:00.000Z',
      createdAt: '2024-11-02T10:00:00.000Z',
    },
    {
      id: 'key_stag_leg',
      projectId: 'proj_prod_gw',
      tenantId: 'usr_gh_9824102',
      name: 'staging-legacy-test',
      tokenPrefix: 'kc_proj_test_01Bc88a',
      tokenHashSha256: '4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a',
      fullSecret: 'kc_proj_test_01Bc88a7791df32',
      displayTime: '14 days ago',
      displayCreated: 'Created Aug 19, 2024',
      isRevoked: true,
      lastUsedAt: '2024-10-31T12:00:00.000Z',
      createdAt: '2024-08-19T10:00:00.000Z',
    },
  ];

  // Local state for interactive updates
  let localProjects = $state<ExtendedProject[]>([]);
  let localKeys = $state<ExtendedKey[]>([]);

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
      localProjects = [...defaultProjects];
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
      localKeys = [...defaultKeys];
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

  // Helper date formatters
  function formatRelativeTime(dateStr: string | null | undefined): string {
    if (!dateStr) return 'Never';
    if (dateStr.includes('ago') || dateStr.includes('minute') || dateStr.includes('day')) {
      return dateStr;
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diffSec < 60) return `${Math.max(1, diffSec)} seconds ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} minutes ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} hours ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} days ago`;
  }

  function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return 'Unknown';
    if (dateStr.startsWith('Created ')) return dateStr.replace('Created ', '');
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Quota & Tier matrix definition matching Screen 2
  interface TierMatrixItem {
    id: UserTier;
    name: string;
    icon: string;
    badge: string;
    badgeClass: string;
    quotaText: string;
    description: string;
    footerText: string;
    dailyUsagePercent: number;
    minWidth: string;
  }

  const tierMatrix: TierMatrixItem[] = [
    {
      id: 'admin',
      name: '👑 Admin',
      icon: 'admin_panel_settings',
      badge: 'System',
      badgeClass: 'bg-surface-container text-outline',
      quotaText: 'Unlimited RPM / RPD',
      description: 'Full Platform Control & Root Secrets',
      footerText: 'System Operator',
      dailyUsagePercent: 12,
      minWidth: 'min-w-[210px]',
    },
    {
      id: 'ultra',
      name: '⚡ Ultra',
      icon: 'bolt',
      badge: 'Tier 5',
      badgeClass: 'bg-surface-container text-tertiary',
      quotaText: 'Unlimited RPM / RPD',
      description: 'High-Volume Enterprise Proxy Routing',
      footerText: 'Tier 5 Sybil Required',
      dailyUsagePercent: 35,
      minWidth: 'min-w-[210px]',
    },
    {
      id: 'max',
      name: '🚀 Max',
      icon: 'rocket_launch',
      badge: 'Upgrade',
      badgeClass: 'bg-primary/10 text-primary',
      quotaText: '60 RPM • 10,000 RPD',
      description: 'Up to 10 Projects • Priority Edge',
      footerText: 'Upgrade Available',
      dailyUsagePercent: 45,
      minWidth: 'min-w-[210px]',
    },
    {
      id: 'builder',
      name: '🛠️ Builder',
      icon: 'construction',
      badge: 'Current',
      badgeClass: 'bg-primary text-on-primary',
      quotaText: '20 RPM • 2,000 RPD',
      description: 'Up to 3 Projects • Standard Fallback',
      footerText: 'Active Tier',
      dailyUsagePercent: 68,
      minWidth: 'min-w-[230px]',
    },
    {
      // Starter tier representation in horizontal matrix
      id: 'builder' as UserTier,
      name: '🌱 Starter',
      icon: 'eco',
      badge: 'Unlocked',
      badgeClass: 'bg-surface-container text-secondary',
      quotaText: '10 RPM • 500 RPD',
      description: '2 Projects • Community Nodes',
      footerText: 'Unlocked',
      dailyUsagePercent: 55,
      minWidth: 'min-w-[210px]',
    },
    {
      id: 'probationary',
      name: '⏳ Probationary',
      icon: 'hourglass_empty',
      badge: 'Sandbox',
      badgeClass: 'bg-surface-container text-outline',
      quotaText: '2 RPM • 50 RPD',
      description: 'Sandboxed • Heavy Throttling',
      footerText: 'Baseline',
      dailyUsagePercent: 84,
      minWidth: 'min-w-[210px]',
    },
    {
      id: 'demo',
      name: '🎭 Demo',
      icon: 'theater_comedy',
      badge: 'Public',
      badgeClass: 'bg-surface-container text-outline',
      quotaText: '20 RPM Shared • 3/IP',
      description: 'Ephemeral Sessions • Zero Persistence',
      footerText: 'Public Sandbox',
      dailyUsagePercent: 90,
      minWidth: 'min-w-[210px]',
    },
  ];

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

  function handleRotateKey(projectId: string): void {
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const newPrefix = `kc_proj_live_${randomSuffix}`;
    localKeys = localKeys.map((k) => {
      if (k.projectId === projectId && !k.isRevoked) {
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
      onRotateKey(projectId);
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
    const md = `# Key Collective — Developer Workbench Configuration & Audit Dossier

**Exported at:** ${new Date().toISOString()}
**Cluster:** iad-edge-01 (Active Proxy Node: iad-edge-01.keycollective.net)

---

## 👤 User Identity & Anti-Sybil Assessment
- **Account ID:** \`${account.id}\`
- **GitHub Username:** \`@${account.githubUsername}\`
- **Primary Email:** ${account.primaryEmail} (Verified: ${account.isEmailVerified ? 'Yes' : 'No'})
- **Registration IP:** \`${account.registrationIp}\` (Singapore • Dedicated ASN)
- **Sybil Trust Score:** **${account.sybilScore}/100** (Low Risk • High Reputation)
- **Active Governance Tier:** **${selectedTier.toUpperCase()}**

### 5-Layer Trust Verification
1. **Turnstile Biometrics:** Passed (0.01ms)
2. **Account Age:** > 14 months (432d)
3. **Public Repositories:** 18 Repos • 420+ commits
4. **Clean Subnet / ASN:** Dedicated ASN • Non-VPN
5. **Quota Standing:** 0 Flagged Spikes

---

## ⚡ Quota & Tier Allocations (${selectedTier.toUpperCase()})
- **RPM Limit:** ${currentLimits.rpmLimit === Infinity ? 'Unlimited' : currentLimits.rpmLimit.toLocaleString()}
- **RPD Limit:** ${currentLimits.rpdLimit === Infinity ? 'Unlimited' : currentLimits.rpdLimit.toLocaleString()}
- **Max Projects:** ${currentLimits.maxProjects === Infinity ? 'Unlimited' : currentLimits.maxProjects}
- **Sub-Caps Permitted:** ${currentLimits.allowCustomSubCaps ? 'Yes' : 'No'}
- **Priority Weight:** P${currentLimits.priorityWeight}

---

## 📁 Registered Projects (${localProjects.length})
${localProjects
  .map(
    (p, i) => `### ${i + 1}. ${p.name} (\`${p.slug}\`)
- **Project ID:** \`${p.id}\`
- **Description:** ${p.description || 'None'}
- **Assigned RPM Sub-Cap:** ${p.maxRpmSubCap ? `${p.maxRpmSubCap} RPM` : 'Inherited'}
- **Status:** ${p.isArchived ? 'Archived' : 'Live (Healthy)'}
- **Active Keys:** ${getProjectKeyCount(p.id)}
- **Created:** ${p.createdAt}`
  )
  .join('\n\n')}

---

## 🔑 Project-Scoped API Keys (${localKeys.length})
| Key Name | Associated Project | Token Prefix | Status | Last Used | Created |
| :--- | :--- | :--- | :--- | :--- | :--- |
${localKeys
  .map(
    (k) =>
      `| \`${k.name}\` | ${getProjectName(k.projectId)} | \`${k.tokenPrefix}...\` | ${k.isRevoked ? 'Revoked' : 'Active'} | ${k.displayTime || 'Never'} | ${k.displayCreated || k.createdAt} |`
  )
  .join('\n')}
`;

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

      <!-- Inspect Verification Proof Button -->
      <button
        type="button"
        onclick={() => (showVerificationProofModal = true)}
        class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary font-body-sm text-body-sm hover:bg-primary/20 transition-colors cursor-pointer"
      >
        <span class="material-symbols-outlined text-[16px]">verified</span>
        <span>Inspect Verification Proof</span>
      </button>
    </div>
  </div>

  <!-- 1. User Account & Identity Card with Anti-Sybil Trust Gauge -->
  <section class="specular-card rounded-xl bg-surface-container-low/70 backdrop-blur-md border border-outline-variant/20 p-5 md:p-6 shadow-sm">
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
      <!-- Identity Info Column (4 cols) -->
      <div class="lg:col-span-4 space-y-4">
        <div class="flex items-start gap-4">
          <div class="relative shrink-0">
            {#if account.avatarUrl}
              <img
                class="w-14 h-14 rounded-xl border border-secondary/40 p-1 bg-surface-container-lowest object-cover"
                src={account.avatarUrl}
                alt={account.githubUsername}
              />
            {:else}
              <div class="w-14 h-14 rounded-xl border border-secondary/40 bg-surface-container-lowest flex items-center justify-center text-primary font-mono text-xl font-bold">
                {account.githubUsername.slice(0, 2).toUpperCase()}
              </div>
            {/if}
            <span class="absolute -bottom-1 -right-1 w-4 h-4 bg-secondary rounded-full border-2 border-surface-container-low flex items-center justify-center text-[9px] text-on-secondary font-bold">
              ✓
            </span>
          </div>

          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="font-headline-sm text-headline-sm text-on-surface font-semibold">
                @{account.githubUsername}
              </h2>
              <span class="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high border border-outline-variant/20 font-label-sm text-label-sm text-on-surface-variant font-mono">
                <span class="material-symbols-outlined text-[12px] text-primary">code</span>
                GitHub
              </span>
            </div>
            <div class="font-code-sm text-code-sm text-outline mt-0.5 font-mono">
              Account ID: <span class="text-on-surface">{account.id}</span>
            </div>
            <div class="flex items-center gap-1.5 mt-2 text-secondary font-code-sm text-code-sm font-mono">
              <span class="material-symbols-outlined text-[14px]">check_circle</span>
              <span class="text-on-surface">{account.primaryEmail}</span>
            </div>
            <div class="font-code-sm text-code-sm text-on-surface-variant mt-1 font-mono">
              Registration IP: <span class="text-on-surface">{account.registrationIp}</span>
              <span class="text-outline">(Singapore)</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Trust Gauge Column (3 cols) -->
      <div class="lg:col-span-3 flex flex-col items-center justify-center p-3 rounded-lg bg-surface-container-lowest/60 border border-outline-variant/20">
        <div class="relative w-28 h-28 flex items-center justify-center">
          <svg class="w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" fill="transparent" r="40" stroke="#1e1f25" stroke-width="8"></circle>
            <!-- 251.2 total circumference, 20.1 offset is 92% -->
            <circle
              class="drop-shadow-[0_0_6px_rgba(78,222,163,0.4)]"
              cx="50"
              cy="50"
              fill="transparent"
              r="40"
              stroke="#4edea3"
              stroke-dasharray="251.2"
              stroke-dashoffset={251.2 * (1 - account.sybilScore / 100)}
              stroke-linecap="round"
              stroke-width="8"
            ></circle>
          </svg>
          <div class="absolute flex flex-col items-center justify-center">
            <span class="font-code-lg text-code-lg font-bold text-on-surface font-mono">
              {account.sybilScore}<span class="text-outline font-normal text-xs">/100</span>
            </span>
            <span class="font-label-sm text-label-sm text-secondary uppercase font-semibold font-mono">Trust</span>
          </div>
        </div>
        <div class="mt-2 text-center">
          <span class="font-label-sm text-label-sm px-2 py-0.5 rounded bg-secondary/10 border border-secondary/30 text-secondary font-mono">
            {account.sybilScore >= 80 ? 'Low Risk • High Reputation' : 'Verified Sandbox'}
          </span>
        </div>
      </div>

      <!-- 5-Layer Trust Checks Breakdown (5 cols) -->
      <div class="lg:col-span-5 space-y-2 border-t lg:border-t-0 lg:border-l border-outline-variant/20 pt-4 lg:pt-0 lg:pl-6 font-mono">
        <div class="font-label-sm text-label-sm uppercase tracking-wider text-outline mb-2">
          5-Layer Trust Checks Verification
        </div>
        <div class="flex items-center justify-between font-code-sm text-code-sm py-1 border-b border-outline-variant/10">
          <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
            <span class="material-symbols-outlined text-secondary text-[15px]">verified</span>
            Turnstile Biometrics &amp; Challenge
          </span>
          <span class="text-secondary font-medium">Passed (0.01ms)</span>
        </div>
        <div class="flex items-center justify-between font-code-sm text-code-sm py-1 border-b border-outline-variant/10">
          <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
            <span class="material-symbols-outlined text-secondary text-[15px]">schedule</span>
            GitHub Account Age
          </span>
          <span class="text-on-surface font-medium">&gt; 14 months (432d)</span>
        </div>
        <div class="flex items-center justify-between font-code-sm text-code-sm py-1 border-b border-outline-variant/10">
          <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
            <span class="material-symbols-outlined text-secondary text-[15px]">emoji_symbols</span>
            Public Repositories
          </span>
          <span class="text-on-surface font-medium">18 Repos • 420+ commits</span>
        </div>
        <div class="flex items-center justify-between font-code-sm text-code-sm py-1 border-b border-outline-variant/10">
          <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
            <span class="material-symbols-outlined text-secondary text-[15px]">router</span>
            Clean Subnet / ASN
          </span>
          <span class="text-secondary font-medium">Dedicated ASN • Non-VPN</span>
        </div>
        <div class="flex items-center justify-between font-code-sm text-code-sm py-1">
          <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
            <span class="material-symbols-outlined text-secondary text-[15px]">speed</span>
            Virtual Pool Quota Standing
          </span>
          <span class="text-secondary font-medium">0 Flagged Spikes</span>
        </div>
      </div>
    </div>
  </section>

  <!-- 2. 7-Tier Authorization & Quota Hierarchy (Horizontal Matrix View) -->
  <section class="space-y-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <h2 class="font-headline-md text-headline-md font-semibold text-on-surface">
          Quota Hierarchy &amp; Governance Tiers
        </h2>
        <div class="group relative cursor-pointer">
          <span class="material-symbols-outlined text-outline text-[16px]">info</span>
          <div class="hidden group-hover:block absolute left-0 bottom-full mb-1 w-56 p-2 rounded bg-surface-container-highest text-on-surface font-body-sm text-body-sm border border-outline-variant/30 shadow-xl z-20">
            Click any tier (Probationary, Builder, Max) to inspect or test policy simulation. Current: {selectedTier.toUpperCase()}.
          </div>
        </div>
      </div>
      <span class="font-label-sm text-label-sm text-outline font-mono">Horizontal Matrix View</span>
    </div>

    <!-- Scrollable Tier Cards Row with Probationary, Builder, Max selectors -->
    <div class="flex gap-3 overflow-x-auto pb-2 custom-scrollbar -mx-1 px-1">
      {#each tierMatrix as tier}
        {@const isActive = selectedTier === tier.id && (tier.name.includes('Builder') || tier.id !== 'builder' || !tier.name.includes('Starter'))}
        <button
          type="button"
          onclick={() => selectTier(tier.id)}
          class="{tier.minWidth} flex-1 text-left rounded-xl p-3.5 flex flex-col justify-between specular-card transition-all cursor-pointer {isActive ? 'bg-surface-container-high border-2 border-primary shadow-[0_0_20px_rgba(192,193,255,0.18)] relative' : 'bg-surface-container-low/50 border border-outline-variant/20 opacity-80 hover:opacity-100 hover:border-outline-variant/40'}"
        >
          {#if isActive}
            <span class="absolute -top-2.5 right-3 font-label-sm text-label-sm px-2 py-0.5 rounded-full bg-primary text-on-primary font-bold shadow-md font-mono">
              CURRENT ACTIVE TIER
            </span>
          {/if}

          <div>
            <div class="flex items-center justify-between {isActive ? 'mt-1' : ''}">
              <span class="font-code-md text-code-md font-semibold font-mono {isActive ? 'text-primary font-bold' : 'text-on-surface'}">
                {tier.name}
              </span>
              {#if !isActive}
                <span class="font-label-sm text-label-sm px-1.5 py-0.5 rounded {tier.badgeClass} font-mono">
                  {tier.badge}
                </span>
              {/if}
            </div>

            <div class="mt-2 text-on-surface font-code-sm text-code-sm font-medium font-mono">
              {tier.quotaText}
            </div>
            <p class="font-body-sm text-body-sm text-on-surface-variant mt-1 leading-snug">
              {tier.description}
            </p>

            {#if isActive}
              <!-- Daily Quota Gauge on active tier -->
              <div class="mt-3 space-y-1">
                <div class="flex justify-between font-label-sm text-label-sm font-mono">
                  <span class="text-outline">Daily Quota Usage</span>
                  <span class="text-primary font-semibold">{tier.dailyUsagePercent}%</span>
                </div>
                <div class="h-1.5 w-full bg-surface-container-lowest rounded-full overflow-hidden">
                  <div class="h-full bg-primary rounded-full" style="width: {tier.dailyUsagePercent}%"></div>
                </div>
              </div>
            {/if}
          </div>

          <div class="mt-3 pt-2 {isActive ? 'border-t border-primary/20 flex items-center gap-1 text-primary font-medium' : 'border-t border-outline-variant/10 text-outline'} font-label-sm text-label-sm font-mono">
            {#if isActive}
              <span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
              Active Tier
            {:else}
              {tier.footerText}
            {/if}
          </div>
        </button>
      {/each}
    </div>
  </section>

  <!-- 3. Multi-Project Management Section -->
  <section class="space-y-4">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <h2 class="font-headline-md text-headline-md font-semibold text-on-surface">
          Multi-Project Management
        </h2>
        <!-- Filter Tabs: All, Live, Archived -->
        <div class="flex items-center gap-1 bg-surface-container p-1 rounded-lg border border-outline-variant/20 font-mono">
          <button
            type="button"
            onclick={() => (projectFilter = 'all')}
            class="px-2.5 py-1 rounded font-label-sm text-label-sm transition-colors cursor-pointer {projectFilter === 'all' ? 'bg-surface-container-high text-primary font-medium' : 'text-on-surface-variant hover:bg-surface-container-high'}"
          >
            All Projects ({localProjects.length})
          </button>
          <button
            type="button"
            onclick={() => (projectFilter = 'live')}
            class="px-2.5 py-1 rounded font-label-sm text-label-sm transition-colors cursor-pointer {projectFilter === 'live' ? 'bg-surface-container-high text-primary font-medium' : 'text-on-surface-variant hover:bg-surface-container-high'}"
          >
            Live ({liveProjectsCount})
          </button>
          <button
            type="button"
            onclick={() => (projectFilter = 'archived')}
            class="px-2.5 py-1 rounded font-label-sm text-label-sm transition-colors cursor-pointer {projectFilter === 'archived' ? 'bg-surface-container-high text-primary font-medium' : 'text-outline hover:bg-surface-container-high'}"
          >
            Archived ({archivedProjectsCount})
          </button>
        </div>
      </div>

      <!-- Create New Project Button -->
      <button
        type="button"
        onclick={() => (showNewProjectModal = true)}
        class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-container text-on-primary-container font-label-md text-label-md font-semibold hover:opacity-90 transition-opacity shadow-[0_0_12px_rgba(128,131,255,0.2)] cursor-pointer font-mono"
      >
        <span class="material-symbols-outlined text-[16px]">add</span>
        <span>+ Create New Project</span>
      </button>
    </div>

    <!-- Project Cards Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {#each filteredProjects as project (project.id)}
        {@const maxCap = project.maxRpmSubCap || 20}
        {@const assignedRpm = project.assignedRpm || 14}
        {@const rpmPercent = Math.min(100, Math.round((assignedRpm / maxCap) * 100))}
        {@const keyCount = getProjectKeyCount(project.id)}
        <div class="specular-card rounded-xl bg-surface-container-low/80 backdrop-blur border border-outline-variant/20 p-5 space-y-4 shadow-sm">
          <div class="flex items-start justify-between">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  {project.name}
                </h3>
                {#if project.isArchived}
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant/20 text-outline font-label-sm text-label-sm font-mono">
                    Archived
                  </span>
                {:else if project.latencyMs && project.latencyMs > 15}
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/30 text-primary font-label-sm text-label-sm font-mono">
                    <span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
                    Live (Standby)
                  </span>
                {:else}
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/10 border border-secondary/30 text-secondary font-label-sm text-label-sm font-mono">
                    <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                    Live (Healthy)
                  </span>
                {/if}
              </div>
              <div class="font-code-sm text-code-sm text-outline mt-0.5 font-mono">
                slug: <span class="text-on-surface-variant font-medium">{project.slug}</span>
              </div>
            </div>

            <span class="p-2 rounded-lg bg-surface-container {project.iconColor || 'text-primary'}">
              <span class="material-symbols-outlined text-[20px]">{project.icon || 'hub'}</span>
            </span>
          </div>

          <!-- Meter and Stats -->
          <div class="space-y-2 bg-surface-container-lowest/60 p-3 rounded-lg border border-outline-variant/10">
            <div class="flex justify-between items-center font-code-sm text-code-sm font-mono">
              <span class="text-on-surface-variant">Assigned RPM Sub-cap</span>
              <span class="text-on-surface font-medium">
                {assignedRpm} / {maxCap} RPM
                <span class="font-bold {rpmPercent >= 50 ? 'text-primary' : 'text-secondary'}">
                  ({rpmPercent}%)
                </span>
              </span>
            </div>
            <div class="h-2 w-full bg-surface-container rounded-full overflow-hidden">
              <div
                class="h-full rounded-full {rpmPercent >= 50 ? 'bg-primary' : 'bg-secondary'}"
                style="width: {rpmPercent}%"
              ></div>
            </div>
            <div class="flex items-center justify-between pt-1 text-xs font-code-sm text-on-surface-variant font-mono">
              <span>Active Keys: <span class="text-on-surface font-medium">{keyCount} Active Key{keyCount !== 1 ? 's' : ''}</span></span>
              <span>Latency: <span class="text-secondary font-medium">{project.latency || '12ms avg'}</span></span>
            </div>
          </div>

          <!-- Card Actions -->
          <div class="flex items-center justify-between pt-2 border-t border-outline-variant/20">
            <div class="flex items-center gap-2">
              <button
                type="button"
                onclick={() => (showProjectSettingsModal = project)}
                class="px-3 py-1.5 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-body-sm text-body-sm hover:bg-surface-container-high transition-colors cursor-pointer"
              >
                Project Settings
              </button>
              <button
                type="button"
                onclick={() => handleRotateKey(project.id)}
                class="px-3 py-1.5 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-body-sm text-body-sm hover:bg-surface-container-high transition-colors flex items-center gap-1 cursor-pointer"
              >
                <span class="material-symbols-outlined text-[14px]">sync</span>
                Rotate Key
              </button>
            </div>
            <button
              type="button"
              onclick={() => (showProjectSettingsModal = project)}
              class="text-outline hover:text-on-surface p-1 transition-colors cursor-pointer"
            >
              <span class="material-symbols-outlined text-[18px]">more_vert</span>
            </button>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <!-- 4. Project-Scoped API Keys Table -->
  <section class="space-y-3">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h2 class="font-headline-md text-headline-md font-semibold text-on-surface">
          Project-Scoped Virtual Tokens &amp; Credentials
        </h2>
        <p class="font-body-sm text-body-sm text-outline">
          Virtual credentials scoped to project routing contexts with automated rate-limits.
        </p>
      </div>

      <!-- Search & Project Select Filters -->
      <div class="flex items-center gap-2 flex-wrap">
        <div class="relative">
          <span class="material-symbols-outlined text-outline text-[16px] absolute left-3 top-2.5">
            search
          </span>
          <input
            type="text"
            bind:value={keySearch}
            placeholder="Search keys or prefixes..."
            class="pl-8 pr-3 py-1.5 bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface font-body-sm text-body-sm focus:outline-none focus:border-primary w-52 sm:w-64 transition-colors font-mono"
          />
        </div>
        <select
          bind:value={keyProjectFilter}
          class="px-3 py-1.5 bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface font-body-sm text-body-sm focus:outline-none focus:border-primary cursor-pointer transition-colors font-mono"
        >
          <option value="all">All Projects</option>
          {#each localProjects as proj}
            <option value={proj.id}>{proj.name}</option>
          {/each}
        </select>
      </div>
    </div>

    <!-- Keys Table -->
    <div class="specular-card rounded-xl bg-surface-container-low/70 border border-outline-variant/20 overflow-hidden shadow-sm">
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse font-sans">
          <thead>
            <tr class="border-b border-outline-variant/20 bg-surface-container-lowest/70 font-label-sm text-label-sm text-outline uppercase tracking-wider font-mono">
              <th class="py-3 px-4">KEY NAME</th>
              <th class="py-3 px-4">ASSOCIATED PROJECT</th>
              <th class="py-3 px-4">TOKEN PREFIX &amp; SECRET</th>
              <th class="py-3 px-4">CREATED / LAST USED</th>
              <th class="py-3 px-4">STATUS</th>
              <th class="py-3 px-4 text-right">ACTIONS</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-outline-variant/10 font-body-sm text-body-sm">
            {#if filteredKeys.length === 0}
              <tr>
                <td colspan="6" class="py-8 text-center text-outline font-mono text-xs">
                  No credentials found matching your filter criteria.
                </td>
              </tr>
            {:else}
              {#each filteredKeys as key (key.id)}
                <tr class="hover:bg-surface-container-high/40 transition-colors {key.isRevoked ? 'opacity-75' : ''}">
                  <!-- Key Name -->
                  <td class="py-3 px-4 font-code-sm text-code-sm font-semibold font-mono {key.isRevoked ? 'text-outline line-through' : 'text-on-surface'}">
                    <div class="flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full {key.isRevoked ? 'bg-outline' : 'bg-secondary'}"></span>
                      <span>{key.name}</span>
                    </div>
                  </td>

                  <!-- Associated Project -->
                  <td class="py-3 px-4">
                    <span class="font-label-sm text-label-sm px-2 py-0.5 rounded-full bg-surface-container-high border border-outline-variant/20 font-mono {key.isRevoked ? 'text-outline' : 'text-on-surface'}">
                      {getProjectName(key.projectId)}
                    </span>
                  </td>

                  <!-- Token Prefix & Secret -->
                  <td class="py-3 px-4">
                    <div class="flex items-center gap-2 font-code-sm text-code-sm bg-surface-container-lowest px-2 py-1 rounded border border-outline-variant/10 w-fit font-mono {key.isRevoked ? 'opacity-60' : ''}">
                      <span class="{key.isRevoked ? 'text-outline' : 'text-primary'}">{key.tokenPrefix}</span>
                      <span class="text-outline">••••••••••••</span>
                      <button
                        type="button"
                        onclick={() => copyKeySecret(key.fullSecret || `${key.tokenPrefix}44781d09e`, key.id)}
                        class="text-outline hover:text-on-surface transition-colors cursor-pointer"
                        title="Copy Key Secret"
                      >
                        {#if copiedKeyId === key.id}
                          <span class="material-symbols-outlined text-[14px] text-secondary">check</span>
                        {:else}
                          <span class="material-symbols-outlined text-[14px]">content_copy</span>
                        {/if}
                      </button>
                    </div>
                  </td>

                  <!-- Created / Last Used -->
                  <td class="py-3 px-4 font-code-sm text-code-sm font-mono">
                    <div class="{key.isRevoked ? 'text-outline' : 'text-on-surface'}">
                      {key.displayTime || 'Just now'}
                    </div>
                    <div class="text-outline text-[10px]">
                      {key.displayCreated || 'Oct 14, 2024'}
                    </div>
                  </td>

                  <!-- Status (Toggle or Badge) -->
                  <td class="py-3 px-4">
                    {#if key.isRevoked}
                      <span class="font-label-sm text-label-sm px-2 py-0.5 rounded bg-error-container/20 text-error border border-error/20 font-medium font-mono">
                        Revoked
                      </span>
                    {:else}
                      <label class="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!key.isRevoked}
                          onchange={() => handleToggleKey(key.id)}
                          class="sr-only peer"
                        />
                        <div class="w-9 h-5 bg-surface-container peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-secondary"></div>
                        <span class="ml-2 font-code-sm text-code-sm text-secondary font-medium font-mono">
                          Active
                        </span>
                      </label>
                    {/if}
                  </td>

                  <!-- Actions -->
                  <td class="py-3 px-4 text-right font-mono">
                    <div class="flex items-center justify-end gap-1">
                      {#if key.isRevoked}
                        <button
                          type="button"
                          onclick={() => handleDeleteKey(key.id)}
                          class="px-2.5 py-1 rounded bg-surface-container hover:bg-surface-container-high text-outline hover:text-on-surface font-label-sm text-label-sm transition-colors cursor-pointer"
                        >
                          Delete
                        </button>
                      {:else}
                        <button
                          type="button"
                          onclick={() => handleRevokeKey(key.id)}
                          class="px-2.5 py-1 rounded bg-error-container/20 hover:bg-error-container/40 text-error border border-error/20 font-label-sm text-label-sm transition-colors cursor-pointer"
                        >
                          Revoke
                        </button>
                      {/if}
                      <button
                        type="button"
                        class="p-1 rounded hover:bg-surface-container text-outline hover:text-on-surface transition-colors cursor-pointer"
                      >
                        <span class="material-symbols-outlined text-[16px]">more_horiz</span>
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- 5. Bottom Edge Telemetry Ticker -->
  <div class="flex flex-wrap items-center justify-between gap-4 p-3 rounded-xl bg-surface-container-lowest border border-outline-variant/20 font-code-sm text-code-sm text-on-surface-variant font-mono">
    <div class="flex items-center gap-4 flex-wrap">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-secondary shadow-[0_0_6px_rgba(78,222,163,0.6)]"></span>
        <span>Edge Virtualizer: <span class="text-on-surface font-semibold">NOMINAL</span></span>
      </div>
      <span class="text-outline">•</span>
      <div>Sybil Consensus: <span class="text-secondary font-medium">Synced (Layer 5/5)</span></div>
      <span class="text-outline">•</span>
      <div>Active Proxy Node: <span class="text-primary font-medium">iad-edge-01.keycollective.net</span></div>
    </div>
    <div class="flex items-center gap-2 text-outline">
      <span>{currentUtcString || 'UTC 2024-11-14 08:34:11'}</span>
    </div>
  </div>
</main>

<!-- Verification Proof Modal -->
{#if showVerificationProofModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={() => (showVerificationProofModal = false)}
  >
    <div
      class="rounded-xl bg-surface-container-low border border-outline-variant/30 p-6 max-w-lg w-full space-y-4 specular-card shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-secondary">verified</span>
          <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface">
            Cryptographic Proof &amp; Sybil Attestation
          </h3>
        </div>
        <button
          type="button"
          onclick={() => (showVerificationProofModal = false)}
          class="text-outline hover:text-on-surface transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="space-y-3 font-mono text-xs text-on-surface-variant">
        <div class="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/15 space-y-1">
          <div class="text-outline text-[10px] uppercase tracking-wider font-semibold">Turnstile Challenge Signature</div>
          <div class="text-secondary break-all">
            0x4a9b91c0e35f8d227b4012fa1982bca81498b3017f8a329d91f801ca458d92e1
          </div>
        </div>

        <div class="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/15 space-y-1">
          <div class="text-outline text-[10px] uppercase tracking-wider font-semibold">Edge Node Attestation Key</div>
          <div class="text-primary break-all">
            ed25519:iad-edge-01:99a81f3b20ce19da01f28b4931a77481c
          </div>
        </div>

        <div class="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/15 space-y-1">
          <div class="text-outline text-[10px] uppercase tracking-wider font-semibold">Sybil Risk Vector Analysis</div>
          <div class="text-on-surface">Score: <strong class="text-secondary">92 / 100</strong> • Risk tier: LOW</div>
          <div class="text-outline text-[11px]">ASN 13335 (Dedicated Cloudflare Edge Transit) • Zero Tor/Proxy hops detected.</div>
        </div>
      </div>

      <div class="flex justify-end pt-2">
        <button
          type="button"
          onclick={() => (showVerificationProofModal = false)}
          class="px-4 py-2 rounded-lg bg-primary text-on-primary font-mono text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
        >
          Close Proof
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Create New Project Modal -->
{#if showNewProjectModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={() => (showNewProjectModal = false)}
  >
    <div
      class="rounded-xl bg-surface-container-low border border-outline-variant/30 p-6 max-w-md w-full space-y-4 specular-card shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary">add_box</span>
          <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface">
            Create New Project
          </h3>
        </div>
        <button
          type="button"
          onclick={() => (showNewProjectModal = false)}
          class="text-outline hover:text-on-surface transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <form onsubmit={(e) => { e.preventDefault(); handleCreateNewProject(); }} class="space-y-3 font-sans">
        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="np-name">Project Name</label>
          <input
            id="np-name"
            type="text"
            bind:value={newProjectName}
            placeholder="e.g., Voice Agent Gateway"
            required
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-body-sm text-body-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="np-slug">Project Slug</label>
          <input
            id="np-slug"
            type="text"
            bind:value={newProjectSlug}
            placeholder="e.g., voice-agent-gateway"
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-code-sm text-code-sm font-mono focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="np-desc">Description</label>
          <input
            id="np-desc"
            type="text"
            bind:value={newProjectDesc}
            placeholder="Optional project purpose or routing domain"
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-body-sm text-body-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="np-rpm">RPM Sub-Cap Limit</label>
          <input
            id="np-rpm"
            type="number"
            min="1"
            max="100"
            bind:value={newProjectRpm}
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-code-sm text-code-sm font-mono focus:outline-none focus:border-primary"
          />
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-outline-variant/20">
          <button
            type="button"
            onclick={() => (showNewProjectModal = false)}
            class="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-outline hover:text-on-surface font-mono text-xs transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="px-4 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
          >
            Create Project
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Project Settings Modal -->
{#if showProjectSettingsModal}
  {@const modalProj = showProjectSettingsModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={() => (showProjectSettingsModal = null)}
  >
    <div
      class="rounded-xl bg-surface-container-low border border-outline-variant/30 p-6 max-w-md w-full space-y-4 specular-card shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary">settings</span>
          <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface">
            {modalProj.name} Settings
          </h3>
        </div>
        <button
          type="button"
          onclick={() => (showProjectSettingsModal = null)}
          class="text-outline hover:text-on-surface transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="space-y-3 font-mono text-xs text-on-surface-variant">
        <div>
          <span class="text-outline">Project ID:</span>
          <code class="ml-2 text-on-surface">{modalProj.id}</code>
        </div>
        <div>
          <span class="text-outline">Slug:</span>
          <code class="ml-2 text-primary">{modalProj.slug}</code>
        </div>
        <div>
          <span class="text-outline">Assigned Sub-Cap:</span>
          <span class="ml-2 text-on-surface">{modalProj.maxRpmSubCap || 20} RPM</span>
        </div>
        <div>
          <span class="text-outline">Status:</span>
          <span class="ml-2 {modalProj.isArchived ? 'text-outline' : 'text-secondary'}">
            {modalProj.isArchived ? 'Archived' : 'Active (Healthy)'}
          </span>
        </div>
      </div>

      <div class="flex justify-between items-center pt-3 border-t border-outline-variant/20">
        <button
          type="button"
          onclick={() => {
            localProjects = localProjects.map((p) =>
              p.id === modalProj.id ? { ...p, isArchived: !p.isArchived } : p
            );
            showProjectSettingsModal = null;
          }}
          class="px-3 py-1.5 rounded-lg border font-mono text-xs transition-colors cursor-pointer {modalProj.isArchived ? 'bg-secondary/10 border-secondary/30 text-secondary' : 'bg-error-container/20 border-error/20 text-error'}"
        >
          {modalProj.isArchived ? 'Unarchive Project' : 'Archive Project'}
        </button>
        <button
          type="button"
          onclick={() => (showProjectSettingsModal = null)}
          class="px-4 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-mono text-xs font-semibold transition-colors cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  </div>
{/if}
