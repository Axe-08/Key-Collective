<script lang="ts">
  import type { UserAccount, Project, ProjectKey, UserTier } from '../../../src/contracts/v3_types';
  import { TIER_LIMITS_MAP } from '../../../src/contracts/v3_types';
  import MarkdownExport from './MarkdownExport.svelte';

  export let userAccount: UserAccount;
  export let projects: Project[];
  export let keys: ProjectKey[];

  // Safe accessor fallbacks
  $: safeProjects = projects ?? [];
  $: safeKeys = keys ?? [];

  // Active tier limits lookup
  $: tierLimits = (userAccount && userAccount.tier && TIER_LIMITS_MAP[userAccount.tier])
    ? TIER_LIMITS_MAP[userAccount.tier]
    : undefined;

  // Search & Filter state
  let projectSearch = '';
  let projectFilter = 'all'; // 'all' | 'active' | 'archived'
  let keySearch = '';
  let keyFilter = 'all'; // 'all' | 'active' | 'revoked'

  // Filtered lists
  $: filteredProjects = safeProjects.filter((p) => {
    if (projectFilter === 'active' && p.isArchived) return false;
    if (projectFilter === 'archived' && !p.isArchived) return false;
    if (projectSearch.trim() !== '') {
      const q = projectSearch.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q))
      );
    }
    return true;
  });

  $: filteredKeys = safeKeys.filter((k) => {
    if (keyFilter === 'active' && k.isRevoked) return false;
    if (keyFilter === 'revoked' && !k.isRevoked) return false;
    if (keySearch.trim() !== '') {
      const q = keySearch.toLowerCase();
      return (
        k.name.toLowerCase().includes(q) ||
        k.id.toLowerCase().includes(q) ||
        k.tokenPrefix.toLowerCase().includes(q) ||
        k.projectId.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Markdown Export formatted bundle
  $: exportMarkdownData = `# Key Collective — Developer Workbench Configuration

**Exported:** ${new Date().toISOString()}

---

## 👤 User Profile
- **Account ID:** \`${userAccount?.id ?? 'N/A'}\`
- **GitHub Username:** \`@${userAccount?.githubUsername ?? 'N/A'}\`
- **Primary Email:** ${userAccount?.primaryEmail ?? 'N/A'} (Verified: ${userAccount?.isEmailVerified ? 'Yes' : 'No'})
- **Current Tier:** **${userAccount?.tier ? userAccount.tier.toUpperCase() : 'N/A'}**
- **Sybil Verification Score:** ${userAccount?.sybilScore ?? 0}/100
- **Registration IP:** \`${userAccount?.registrationIp ?? 'N/A'}\`
- **Account Created:** ${userAccount?.createdAt ?? 'N/A'}

---

## ⚡ Tier Quotas & Limits
- **Tier:** ${tierLimits?.tier ?? userAccount?.tier ?? 'N/A'}
- **RPM Limit:** ${tierLimits?.rpmLimit === Infinity ? 'Unlimited' : (tierLimits?.rpmLimit?.toLocaleString() ?? 'N/A')}
- **RPD Limit:** ${tierLimits?.rpdLimit === Infinity ? 'Unlimited' : (tierLimits?.rpdLimit?.toLocaleString() ?? 'N/A')}
- **Max Projects:** ${tierLimits?.maxProjects === Infinity ? 'Unlimited' : (tierLimits?.maxProjects ?? 'N/A')}
- **Custom Sub-Caps Permitted:** ${tierLimits?.allowCustomSubCaps ? 'Yes' : 'No'}
- **Arbitration Priority Weight:** P${tierLimits?.priorityWeight ?? 'N/A'}

---

## 📁 Registered Projects (${safeProjects.length})
${
  safeProjects.length === 0
    ? '_No projects configured._'
    : safeProjects
        .map(
          (p, i) =>
            `### ${i + 1}. ${p.name} (\`${p.slug}\`)
- **Project ID:** \`${p.id}\`
- **Description:** ${p.description || '_None provided_'}
- **Sub-Cap Limit:** ${p.maxRpmSubCap ? `${p.maxRpmSubCap} RPM` : 'Inherited from Tier'}
- **Status:** ${p.isArchived ? 'Archived' : 'Active'}
- **Associated Keys:** ${safeKeys.filter((k) => k.projectId === p.id).length}
- **Created:** ${p.createdAt}`
        )
        .join('\n\n')
}

---

## 🔑 Project-Scoped API Keys (${safeKeys.length})
| Key ID | Key Name | Project ID | Prefix | Status | Last Used | Created |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${
  safeKeys.length === 0
    ? '| - | - | _No keys registered_ | - | - | - | - |'
    : safeKeys
        .map(
          (k) =>
            `| \`${k.id}\` | **${k.name}** | \`${k.projectId}\` | \`${k.tokenPrefix}...\` | ${k.isRevoked ? '🔴 Revoked' : '🟢 Active'} | ${k.lastUsedAt ?? 'Never'} | ${k.createdAt} |`
        )
        .join('\n')
}
`;

  function getTierBadgeClass(tier?: UserTier): string {
    switch (tier) {
      case 'admin':
        return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
      case 'ultra':
        return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
      case 'max':
        return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
      case 'builder':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'probationary':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'demo':
        return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
      case 'suspended':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      default:
        return 'bg-slate-800 text-slate-400 border-white/10';
    }
  }

  function getProjectKeyCount(projectId: string): number {
    return safeKeys.filter((k) => k.projectId === projectId).length;
  }
</script>

<div class="space-y-6 text-slate-100 font-sans">
  <!-- Workbench Header & Profile Card -->
  <div class="rounded-xl bg-slate-900/70 border border-white/[0.08] shadow-xl backdrop-blur-sm p-6">
    <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div class="flex items-center gap-4">
        {#if userAccount?.avatarUrl}
          <img
            src={userAccount.avatarUrl}
            alt={userAccount.githubUsername}
            class="w-14 h-14 rounded-full border-2 border-indigo-500/30 bg-slate-950 object-cover"
          />
        {:else}
          <div class="w-14 h-14 rounded-full bg-slate-800 border-2 border-white/10 flex items-center justify-center text-slate-400 font-mono text-xl font-bold">
            {userAccount?.githubUsername ? userAccount.githubUsername.slice(0, 2).toUpperCase() : 'KC'}
          </div>
        {/if}

        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-xl font-bold text-white tracking-tight">
              {userAccount?.githubUsername ? `@${userAccount.githubUsername}` : 'Workbench'}
            </h1>
            {#if userAccount?.tier}
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold border uppercase tracking-wider {getTierBadgeClass(userAccount.tier)}">
                {userAccount.tier}
              </span>
            {/if}
            {#if userAccount?.isEmailVerified}
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <svg class="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                </svg>
                Verified
              </span>
            {/if}
          </div>
          <div class="flex items-center gap-3 mt-1 text-xs text-slate-400 font-mono flex-wrap">
            <span>ID: <code class="text-slate-300">{userAccount?.id ?? 'N/A'}</code></span>
            <span>•</span>
            <span>{userAccount?.primaryEmail ?? 'No email provided'}</span>
            <span>•</span>
            <span class="inline-flex items-center gap-1 text-slate-300">
              Sybil Score:
              <strong class="{userAccount && userAccount.sybilScore >= 50 ? 'text-emerald-400' : 'text-amber-400'}">
                {userAccount?.sybilScore ?? 0}/100
              </strong>
            </span>
          </div>
        </div>
      </div>

      <!-- Export Action Button -->
      <div class="flex items-center gap-3">
        <MarkdownExport
          data={exportMarkdownData}
          filename={`workbench-${userAccount?.githubUsername || 'export'}.md`}
          class="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-medium shadow-md shadow-indigo-600/20 border border-indigo-400/30 transition-all active:scale-95 cursor-pointer"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>Export Markdown</span>
        </MarkdownExport>
      </div>
    </div>
  </div>

  <!-- Tier Quota Overview Cards -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    <!-- Tier Card -->
    <div class="rounded-xl bg-slate-900/60 border border-white/[0.08] p-4 flex flex-col justify-between">
      <span class="text-xs font-mono uppercase tracking-wider text-slate-400">User Tier</span>
      <div class="mt-2 flex items-baseline justify-between">
        <span class="text-xl font-bold font-mono text-white capitalize">{userAccount?.tier ?? 'Unknown'}</span>
        <span class="text-xs font-mono text-slate-400">Priority P{tierLimits?.priorityWeight ?? '-'}</span>
      </div>
      <p class="mt-2 text-[11px] text-slate-400 font-sans">
        Anti-Sybil verified level with edge router arbitration priority.
      </p>
    </div>

    <!-- RPM Limit Card -->
    <div class="rounded-xl bg-slate-900/60 border border-white/[0.08] p-4 flex flex-col justify-between">
      <span class="text-xs font-mono uppercase tracking-wider text-slate-400">RPM Limit</span>
      <div class="mt-2 flex items-baseline justify-between">
        <span class="text-xl font-bold font-mono text-indigo-400">
          {tierLimits?.rpmLimit === Infinity ? 'Unlimited' : (tierLimits?.rpmLimit ?? '0')}
        </span>
        <span class="text-xs font-mono text-slate-500">req / min</span>
      </div>
      <p class="mt-2 text-[11px] text-slate-400 font-sans">
        DO sliding-window distributed rate limit ceiling.
      </p>
    </div>

    <!-- RPD Limit Card -->
    <div class="rounded-xl bg-slate-900/60 border border-white/[0.08] p-4 flex flex-col justify-between">
      <span class="text-xs font-mono uppercase tracking-wider text-slate-400">RPD Limit</span>
      <div class="mt-2 flex items-baseline justify-between">
        <span class="text-xl font-bold font-mono text-emerald-400">
          {tierLimits?.rpdLimit === Infinity ? 'Unlimited' : (tierLimits?.rpdLimit?.toLocaleString() ?? '0')}
        </span>
        <span class="text-xs font-mono text-slate-500">req / day</span>
      </div>
      <p class="mt-2 text-[11px] text-slate-400 font-sans">
        Daily rollover quota resets at 00:00 UTC.
      </p>
    </div>

    <!-- Projects Capacity Card -->
    <div class="rounded-xl bg-slate-900/60 border border-white/[0.08] p-4 flex flex-col justify-between">
      <span class="text-xs font-mono uppercase tracking-wider text-slate-400">Projects Capacity</span>
      <div class="mt-2 flex items-baseline justify-between">
        <span class="text-xl font-bold font-mono text-white">
          {safeProjects.length} <span class="text-slate-500 font-normal text-sm">/ {tierLimits?.maxProjects === Infinity ? '∞' : (tierLimits?.maxProjects ?? '-')}</span>
        </span>
        <span class="text-xs font-mono {tierLimits?.allowCustomSubCaps ? 'text-emerald-400' : 'text-slate-500'}">
          {tierLimits?.allowCustomSubCaps ? 'Sub-Caps ✓' : 'No Sub-Caps'}
        </span>
      </div>
      <p class="mt-2 text-[11px] text-slate-400 font-sans">
        Isolated multi-project namespaces for team API keys.
      </p>
    </div>
  </div>

  <!-- Projects Section -->
  <div class="rounded-xl bg-slate-900/70 border border-white/[0.08] shadow-xl backdrop-blur-sm overflow-hidden">
    <div class="p-4 border-b border-white/[0.08] bg-slate-900/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold font-mono uppercase tracking-wider text-slate-200">
          Projects
        </h2>
        <span class="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-slate-800 text-slate-300 border border-white/10">
          {filteredProjects.length} of {safeProjects.length}
        </span>
      </div>

      <!-- Search & Filter Controls -->
      <div class="flex items-center gap-2">
        <input
          type="text"
          bind:value={projectSearch}
          placeholder="Filter projects..."
          class="px-3 py-1.5 rounded-lg bg-slate-950/70 border border-white/10 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />
        <select
          bind:value={projectFilter}
          class="py-1.5 px-2.5 rounded-lg bg-slate-950/70 border border-white/10 text-xs font-mono text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
          aria-label="Filter projects by status"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>
    </div>

    <!-- Projects List -->
    {#if filteredProjects.length === 0}
      <div class="p-8 text-center text-slate-500 font-mono text-xs">
        No projects found matching the criteria.
      </div>
    {:else}
      <div class="divide-y divide-white/[0.05]">
        {#each filteredProjects as project (project.id)}
          <div class="p-4 hover:bg-slate-800/20 transition-colors flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-slate-200 text-sm">{project.name}</span>
                <code class="px-1.5 py-0.5 rounded bg-slate-950 text-indigo-400 text-[11px] font-mono border border-white/5">
                  {project.slug}
                </code>
                {#if project.isArchived}
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700">
                    Archived
                  </span>
                {:else}
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                    Active
                  </span>
                {/if}
              </div>
              <p class="text-xs text-slate-400 line-clamp-1">
                {project.description || 'No description provided.'}
              </p>
              <div class="text-[10px] text-slate-500 font-mono flex items-center gap-3 pt-0.5">
                <span>ID: {project.id}</span>
                <span>•</span>
                <span>Sub-Cap: {project.maxRpmSubCap ? `${project.maxRpmSubCap} RPM` : 'Inherited'}</span>
                <span>•</span>
                <span>Created: {new Date(project.createdAt).toLocaleDateString()}</span>
              </div>
            </div>

            <!-- Project Stats / Key count badge -->
            <div class="flex items-center gap-3">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-950 border border-white/10 text-xs font-mono text-slate-300">
                <svg class="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 2l-2 2m-1-1l-2 2m-1-1l-2 2m-1-1l-2 2M3 21l9-9m0 0l-3-3m3 3l3 3" />
                </svg>
                {getProjectKeyCount(project.id)} Keys
              </span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Keys Management Section -->
  <div class="rounded-xl bg-slate-900/70 border border-white/[0.08] shadow-xl backdrop-blur-sm overflow-hidden">
    <div class="p-4 border-b border-white/[0.08] bg-slate-900/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold font-mono uppercase tracking-wider text-slate-200">
          Project API Keys
        </h2>
        <span class="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-slate-800 text-slate-300 border border-white/10">
          {filteredKeys.length} of {safeKeys.length}
        </span>
      </div>

      <!-- Search & Filter Controls -->
      <div class="flex items-center gap-2">
        <input
          type="text"
          bind:value={keySearch}
          placeholder="Filter keys or project ID..."
          class="px-3 py-1.5 rounded-lg bg-slate-950/70 border border-white/10 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />
        <select
          bind:value={keyFilter}
          class="py-1.5 px-2.5 rounded-lg bg-slate-950/70 border border-white/10 text-xs font-mono text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
          aria-label="Filter keys by status"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="revoked">Revoked</option>
        </select>
      </div>
    </div>

    <!-- Keys Table -->
    <div class="overflow-x-auto">
      <table class="w-full text-left text-xs font-mono border-collapse">
        <thead>
          <tr class="border-b border-white/[0.08] bg-slate-950/40 text-slate-400 uppercase tracking-wider text-[11px]">
            <th class="py-3 px-4 font-semibold">Key Name</th>
            <th class="py-3 px-4 font-semibold">Project ID</th>
            <th class="py-3 px-4 font-semibold">Token Prefix</th>
            <th class="py-3 px-4 font-semibold">Status</th>
            <th class="py-3 px-4 font-semibold">Last Used</th>
            <th class="py-3 px-4 font-semibold text-right">Created</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-white/[0.05]">
          {#if filteredKeys.length === 0}
            <tr>
              <td colspan="6" class="py-8 text-center text-slate-500 font-mono">
                No API keys found.
              </td>
            </tr>
          {:else}
            {#each filteredKeys as key (key.id)}
              <tr class="hover:bg-slate-800/30 transition-colors">
                <td class="py-3 px-4">
                  <div class="font-medium text-slate-200">{key.name}</div>
                  <div class="text-[10px] text-slate-500">{key.id}</div>
                </td>
                <td class="py-3 px-4">
                  <code class="px-1.5 py-0.5 rounded bg-slate-950 text-slate-300 text-[11px] border border-white/5">
                    {key.projectId}
                  </code>
                </td>
                <td class="py-3 px-4">
                  <span class="px-2 py-0.5 rounded bg-slate-950/80 border border-white/10 text-slate-300 tracking-wider">
                    {key.tokenPrefix}...
                  </span>
                </td>
                <td class="py-3 px-4">
                  {#if key.isRevoked}
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/25">
                      <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                      Revoked
                    </span>
                  {:else}
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      Active
                    </span>
                  {/if}
                </td>
                <td class="py-3 px-4 text-slate-400">
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}
                </td>
                <td class="py-3 px-4 text-right text-slate-500">
                  {new Date(key.createdAt).toLocaleDateString()}
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
