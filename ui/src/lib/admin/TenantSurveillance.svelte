<script lang="ts">
  import type { TenantSurveillanceRow, AdminActionPayload, Microdollars } from '../../../../src/contracts/v3_5_types';
  import type { UserTier } from '../../../../src/contracts/v3_types';
  import { formatMicrodollars } from '../types';

  let {
    tenants = [],
    adminEmail = 'admin@keycollective.io',
    onAdminAction,
  }: {
    tenants?: TenantSurveillanceRow[];
    adminEmail?: string;
    onAdminAction?: (payload: AdminActionPayload) => void;
  } = $props();

  // Search, filter, and sorting state
  let searchQuery = $state('');
  let tierFilter = $state<string>('all');
  let quarantineFilter = $state<'all' | 'active' | 'quarantined'>('all');
  let anomalyOnly = $state(false);
  let sortBy = $state<'rpm' | 'spend' | 'recent' | 'id'>('rpm');

  // Modal interaction state
  let targetTenant = $state<TenantSurveillanceRow | null>(null);
  let actionModalType = $state<'tier' | 'quarantine' | 'reset' | null>(null);
  let selectedNewTier = $state<UserTier>('ultra');
  let actionReason = $state('');

  // Anomaly calculation
  function isAnomaly(tenant: TenantSurveillanceRow): boolean {
    if (tenant.rpmLimit <= 0 || tenant.rpmLimit === Infinity) return false;
    return (tenant.currentRpm / tenant.rpmLimit) >= 0.85;
  }

  // Filtered & Sorted tenants
  let filteredTenants = $derived.by(() => {
    return tenants
      .filter((t) => {
        if (quarantineFilter === 'active' && t.isQuarantined) return false;
        if (quarantineFilter === 'quarantined' && !t.isQuarantined) return false;
        if (tierFilter !== 'all' && t.tier !== tierFilter) return false;
        if (anomalyOnly && !isAnomaly(t)) return false;
        if (searchQuery.trim() !== '') {
          const q = searchQuery.toLowerCase();
          return (
            t.tenantId.toLowerCase().includes(q) ||
            t.email.toLowerCase().includes(q) ||
            t.authProvider.toLowerCase().includes(q) ||
            t.tier.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'rpm') return b.currentRpm - a.currentRpm;
        if (sortBy === 'spend') return b.todaySpendMicrodollars - a.todaySpendMicrodollars;
        if (sortBy === 'recent') return b.lastActiveTimestamp - a.lastActiveTimestamp;
        return a.tenantId.localeCompare(b.tenantId);
      });
  });

  let anomalyCount = $derived(tenants.filter(isAnomaly).length);
  let quarantinedCount = $derived(tenants.filter((t) => t.isQuarantined).length);

  function getTierBadgeClass(tier: UserTier): string {
    switch (tier) {
      case 'admin':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'ultra':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/40 font-bold';
      case 'max':
        return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40';
      case 'builder':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'probationary':
        return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40';
      case 'demo':
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
      default:
        return 'bg-slate-500/20 text-slate-300 border-slate-500/40';
    }
  }

  function getAuthProviderIcon(provider: string): string {
    switch (provider.toLowerCase()) {
      case 'github':
        return 'code';
      case 'google':
        return 'account_circle';
      default:
        return 'mail';
    }
  }

  function formatRelativeTime(ts: number): string {
    const diff = Math.max(0, Date.now() - ts);
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ago`;
  }

  function openTierModal(tenant: TenantSurveillanceRow) {
    targetTenant = tenant;
    actionModalType = 'tier';
    selectedNewTier = tenant.tier === 'ultra' ? 'builder' : 'ultra';
    actionReason = `Promoting ${tenant.email} to ${selectedNewTier.toUpperCase()} based on identity verification`;
  }

  function openQuarantineModal(tenant: TenantSurveillanceRow) {
    targetTenant = tenant;
    actionModalType = 'quarantine';
    actionReason = tenant.isQuarantined
      ? `Reinstating tenant account after verification review`
      : `Immediate abuse quarantine: Exceeded rate limit thresholds or anomaly detected`;
  }

  function openResetModal(tenant: TenantSurveillanceRow) {
    targetTenant = tenant;
    actionModalType = 'reset';
    actionReason = `Resetting tenant sliding-window rate counters`;
  }

  function handleConfirmAction() {
    if (!targetTenant || !actionModalType) return;

    let payload: AdminActionPayload;

    if (actionModalType === 'tier') {
      payload = {
        adminEmail,
        targetTenantId: targetTenant.tenantId,
        action: 'UPDATE_TIER',
        newTier: selectedNewTier,
        reason: actionReason || `Tier updated to ${selectedNewTier}`,
      };
    } else if (actionModalType === 'quarantine') {
      payload = {
        adminEmail,
        targetTenantId: targetTenant.tenantId,
        action: targetTenant.isQuarantined ? 'UNQUARANTINE' : 'QUARANTINE',
        reason: actionReason || (targetTenant.isQuarantined ? 'Unquarantined by admin' : 'Quarantined for abuse'),
      };
    } else {
      payload = {
        adminEmail,
        targetTenantId: targetTenant.tenantId,
        action: 'RESET_QUOTA',
        reason: actionReason || 'Manual quota reset',
      };
    }

    if (onAdminAction) {
      onAdminAction(payload);
    }

    targetTenant = null;
    actionModalType = null;
  }
</script>

<div class="space-y-6">
  <!-- Header & Toolbar -->
  <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
    <div class="space-y-0.5">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-primary text-[20px]" data-icon="surveillance">surveillance</span>
        <h2 class="text-headline-sm font-headline-sm font-semibold text-on-surface">Tenant Surveillance &amp; Abuse Sentinel</h2>
        <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-primary/10 text-primary border border-primary/20">
          {tenants.length} Tenants Active
        </span>
        {#if anomalyCount > 0}
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
            ⚠️ {anomalyCount} Anomaly Spikes
          </span>
        {/if}
        {#if quarantinedCount > 0}
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-error/20 text-error border border-error/40">
            {quarantinedCount} Quarantined
          </span>
        {/if}
      </div>
      <p class="text-body-sm font-body-sm text-on-surface-variant">
        Real-time per-tenant velocity inspection, microdollar spend tracking, and 1-click ban hammer with &lt;5ms DO isolate eviction.
      </p>
    </div>
  </div>

  <!-- Filter & Search Bar Toolbar -->
  <div class="p-3 rounded-xl bg-surface-container-low/90 backdrop-blur-md border border-outline-variant/30 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
    <!-- Search Input -->
    <div class="relative flex-1 min-w-[240px]">
      <span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-outline text-[16px]">search</span>
      <input
        bind:value={searchQuery}
        type="text"
        placeholder="Filter by Tenant ID, Email, Provider..."
        class="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface placeholder:text-outline focus:outline-none focus:border-primary transition-colors text-[12px]"
      />
    </div>

    <!-- Tier Filter Dropdown -->
    <div class="flex items-center gap-1.5">
      <label for="admin-tier-filter-select" class="text-outline text-[11px]">Tier:</label>
      <select
        id="admin-tier-filter-select"
        bind:value={tierFilter}
        class="px-2.5 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-[12px] focus:outline-none focus:border-primary cursor-pointer"
      >
        <option value="all">All Tiers</option>
        <option value="ultra">Ultra (VIP)</option>
        <option value="admin">Admin</option>
        <option value="max">Max (60 RPM)</option>
        <option value="builder">Builder (20 RPM)</option>
        <option value="probationary">Probationary (2 RPM)</option>
      </select>
    </div>

    <!-- Quarantine Toggle Buttons -->
    <div class="flex items-center rounded-lg bg-surface-container-lowest border border-outline-variant/30 p-0.5">
      <button
        type="button"
        onclick={() => (quarantineFilter = 'all')}
        class="px-2.5 py-1 rounded text-[11px] transition-colors cursor-pointer {quarantineFilter === 'all' ? 'bg-surface-container-high text-primary font-semibold' : 'text-outline hover:text-on-surface'}"
      >
        All
      </button>
      <button
        type="button"
        onclick={() => (quarantineFilter = 'active')}
        class="px-2.5 py-1 rounded text-[11px] transition-colors cursor-pointer {quarantineFilter === 'active' ? 'bg-surface-container-high text-secondary font-semibold' : 'text-outline hover:text-on-surface'}"
      >
        Active
      </button>
      <button
        type="button"
        onclick={() => (quarantineFilter = 'quarantined')}
        class="px-2.5 py-1 rounded text-[11px] transition-colors cursor-pointer {quarantineFilter === 'quarantined' ? 'bg-error/20 text-error font-semibold' : 'text-outline hover:text-on-surface'}"
      >
        Quarantined
      </button>
    </div>

    <!-- Anomaly High Velocity Filter -->
    <button
      type="button"
      onclick={() => (anomalyOnly = !anomalyOnly)}
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] transition-colors cursor-pointer {anomalyOnly ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-bold' : 'bg-surface-container-lowest text-outline border-outline-variant/30 hover:text-on-surface'}"
    >
      <span class="material-symbols-outlined text-[14px]">warning</span>
      <span>Spikes Only (&gt;85% Cap)</span>
    </button>

    <!-- Sort By -->
    <div class="flex items-center gap-1.5">
      <label for="admin-sort-by-select" class="text-outline text-[11px]">Sort:</label>
      <select
        id="admin-sort-by-select"
        bind:value={sortBy}
        class="px-2.5 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-[12px] focus:outline-none focus:border-primary cursor-pointer"
      >
        <option value="rpm">RPM Velocity</option>
        <option value="spend">Today's Spend (µ$)</option>
        <option value="recent">Recently Active</option>
        <option value="id">Tenant ID</option>
      </select>
    </div>
  </div>

  <!-- Main Surveillance Table -->
  <div class="specular-card rounded-xl bg-surface-container-low/90 backdrop-blur-md border border-outline-variant/30 overflow-hidden shadow-xl">
    <div class="overflow-x-auto custom-scrollbar">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="border-b border-outline-variant/30 bg-surface-container/60 text-outline text-[11px] uppercase tracking-wider font-mono">
            <th class="py-3 px-4">Tenant ID / Account</th>
            <th class="py-3 px-3">Auth</th>
            <th class="py-3 px-3">Tier</th>
            <th class="py-3 px-4 min-w-[180px]">RPM Velocity / Limit</th>
            <th class="py-3 px-3">Today Spend</th>
            <th class="py-3 px-3 text-center">Keys</th>
            <th class="py-3 px-3">Status</th>
            <th class="py-3 px-3">Last Active</th>
            <th class="py-3 px-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-outline-variant/20 text-[12px] font-mono">
          {#if filteredTenants.length === 0}
            <tr>
              <td colspan="9" class="py-8 text-center text-outline text-body-sm font-sans">
                No tenants matched the filter criteria.
              </td>
            </tr>
          {:else}
            {#each filteredTenants as t}
              {@const nearCap = isAnomaly(t)}
              {@const rpmSat = t.rpmLimit === Infinity ? 0 : Math.min(100, Math.round((t.currentRpm / t.rpmLimit) * 100))}
              <tr class="hover:bg-surface-container/40 transition-colors {t.isQuarantined ? 'bg-error-container/5' : ''}">
                <!-- Tenant ID & Email -->
                <td class="py-3 px-4">
                  <div class="flex flex-col">
                    <span class="font-semibold text-on-surface font-code-sm text-[12px] flex items-center gap-1.5">
                      <span class="text-primary">{t.tenantId}</span>
                      {#if nearCap && !t.isQuarantined}
                        <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping" title="Rate Limit Spike"></span>
                      {/if}
                    </span>
                    <span class="text-[11px] text-on-surface-variant truncate max-w-[200px]" title={t.email}>
                      {t.email}
                    </span>
                  </div>
                </td>

                <!-- Auth Provider -->
                <td class="py-3 px-3">
                  <div class="flex items-center gap-1 text-[11px] text-outline capitalize">
                    <span class="material-symbols-outlined text-[15px]">{getAuthProviderIcon(t.authProvider)}</span>
                    <span>{t.authProvider}</span>
                  </div>
                </td>

                <!-- Tier Badge -->
                <td class="py-3 px-3">
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase border {getTierBadgeClass(t.tier)}">
                    {t.tier}
                  </span>
                </td>

                <!-- RPM Velocity & Limit with Progress Bar -->
                <td class="py-3 px-4">
                  <div class="space-y-1">
                    <div class="flex justify-between text-[11px]">
                      <span class="font-bold {nearCap ? 'text-amber-400' : 'text-on-surface'}">
                        {t.currentRpm} RPM
                      </span>
                      <span class="text-outline">
                        / {t.rpmLimit === Infinity ? '∞' : `${t.rpmLimit} max`}
                      </span>
                    </div>
                    <div class="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden">
                      <div
                        class="h-full rounded-full transition-all duration-500 {nearCap ? 'bg-amber-400' : 'bg-primary'}"
                        style="width: {rpmSat}%;"
                      ></div>
                    </div>
                  </div>
                </td>

                <!-- Today Spend Microdollars -->
                <td class="py-3 px-3 text-secondary font-semibold" title="{t.todaySpendMicrodollars} µ$">
                  {formatMicrodollars(t.todaySpendMicrodollars)}
                </td>

                <!-- Active Keys Count -->
                <td class="py-3 px-3 text-center">
                  <span class="px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant text-[11px]">
                    {t.activeKeyCount}
                  </span>
                </td>

                <!-- Quarantine Status -->
                <td class="py-3 px-3">
                  {#if t.isQuarantined}
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-error/20 text-error border border-error/40 uppercase animate-pulse">
                      QUARANTINED
                    </span>
                  {:else}
                    <span class="flex items-center gap-1 text-secondary text-[11px]">
                      <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                      Active
                    </span>
                  {/if}
                </td>

                <!-- Last Active -->
                <td class="py-3 px-3 text-outline text-[11px] whitespace-nowrap">
                  {formatRelativeTime(t.lastActiveTimestamp)}
                </td>

                <!-- Quick Action Buttons -->
                <td class="py-3 px-4 text-right whitespace-nowrap">
                  <div class="inline-flex items-center gap-1.5">
                    <!-- Override Tier -->
                    <button
                      type="button"
                      onclick={() => openTierModal(t)}
                      class="p-1.5 rounded bg-surface-container hover:bg-primary/20 text-outline hover:text-primary transition-colors cursor-pointer"
                      title="Override Tenant Tier"
                    >
                      <span class="material-symbols-outlined text-[16px]">manage_accounts</span>
                    </button>

                    <!-- Reset Quota -->
                    <button
                      type="button"
                      onclick={() => openResetModal(t)}
                      class="p-1.5 rounded bg-surface-container hover:bg-surface-container-highest text-outline hover:text-on-surface transition-colors cursor-pointer"
                      title="Reset Quota Counters"
                    >
                      <span class="material-symbols-outlined text-[16px]">restart_alt</span>
                    </button>

                    <!-- Ban Hammer (Quarantine / Unquarantine) -->
                    <button
                      type="button"
                      onclick={() => openQuarantineModal(t)}
                      class="p-1.5 rounded transition-colors cursor-pointer {t.isQuarantined ? 'bg-secondary/20 hover:bg-secondary/30 text-secondary' : 'bg-error/15 hover:bg-error/30 text-error'}"
                      title={t.isQuarantined ? 'Lift Quarantine (Re-admit)' : 'Abuse Quarantine (Evict from DO)'}
                    >
                      <span class="material-symbols-outlined text-[16px]">
                        {t.isQuarantined ? 'lock_open' : 'gavel'}
                      </span>
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
</div>

<!-- Modal: Tier Override -->
{#if actionModalType === 'tier' && targetTenant}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
    <div class="specular-card w-full max-w-md rounded-xl bg-surface-container-high p-6 space-y-4 border border-outline-variant/40 shadow-2xl">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-on-surface font-semibold text-[16px]">
          <span class="material-symbols-outlined text-primary">manage_accounts</span>
          <span>Assign Tenant Tier Override</span>
        </div>
        <button
          type="button"
          onclick={() => (actionModalType = null)}
          class="text-outline hover:text-on-surface p-1 rounded transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <p class="text-body-sm font-body-sm text-on-surface-variant text-[13px]">
        Override the authorization tier for <strong class="text-on-surface">{targetTenant.email}</strong> (<code class="text-primary">{targetTenant.tenantId}</code>).
      </p>

      <div class="space-y-1.5">
        <label for="admin-target-tier-select" class="text-label-sm font-mono text-outline uppercase">New Authorization Tier</label>
        <select
          id="admin-target-tier-select"
          bind:value={selectedNewTier}
          class="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/40 text-code-sm font-mono text-on-surface focus:outline-none focus:border-primary cursor-pointer"
        >
          <option value="ultra">ULTRA — Unlimited RPM / RPD (VIP Developer)</option>
          <option value="admin">ADMIN — Root Platform Superuser</option>
          <option value="max">MAX — 60 RPM / 10,000 RPD</option>
          <option value="builder">BUILDER — 20 RPM / 2,000 RPD</option>
          <option value="probationary">PROBATIONARY — 2 RPM / 50 RPD (Sandboxed)</option>
        </select>
      </div>

      <div class="space-y-1.5">
        <label for="admin-tier-reason-input" class="text-label-sm font-mono text-outline uppercase">Audit Reason Note (Required)</label>
        <input
          id="admin-tier-reason-input"
          bind:value={actionReason}
          type="text"
          placeholder="Reason for tier change..."
          class="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/40 text-code-sm font-mono text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
        />
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onclick={() => (actionModalType = null)}
          class="px-3.5 py-1.5 rounded-lg bg-surface-container text-on-surface-variant hover:text-on-surface text-label-md font-mono transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handleConfirmAction}
          class="px-4 py-1.5 rounded-lg bg-primary-container text-on-primary font-mono text-label-md font-bold uppercase transition-all cursor-pointer shadow-md shadow-primary/20"
        >
          Update Tier
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal: Quarantine / Unquarantine -->
{#if actionModalType === 'quarantine' && targetTenant}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
    <div class="specular-card w-full max-w-md rounded-xl bg-surface-container-high p-6 space-y-4 border {targetTenant.isQuarantined ? 'border-secondary/40' : 'border-error/50'} shadow-2xl">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 {targetTenant.isQuarantined ? 'bg-secondary/20 text-secondary border border-secondary/30' : 'bg-error/20 text-error border border-error/40'}">
          <span class="material-symbols-outlined text-[24px]">
            {targetTenant.isQuarantined ? 'lock_open' : 'gavel'}
          </span>
        </div>
        <div class="space-y-1">
          <h3 class="text-headline-sm font-headline-sm font-semibold text-on-surface text-[16px]">
            {targetTenant.isQuarantined ? 'Lift Abuse Quarantine?' : 'Execute Abuse Quarantine (Ban Hammer)?'}
          </h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant text-[13px]">
            {targetTenant.isQuarantined
              ? `Re-activating ${targetTenant.email}. DO in-memory counters will be re-initialized upon next request.`
              : `Freezing ${targetTenant.email} (${targetTenant.tenantId}). Sets is_quarantined = 1 in D1 and immediately evicts tenant from DO isolate memory within 5ms.`}
          </p>
        </div>
      </div>

      <div class="space-y-1.5">
        <label for="admin-quarantine-reason-input" class="text-label-sm font-mono text-outline uppercase">Audit Reason Note (Required)</label>
        <input
          id="admin-quarantine-reason-input"
          bind:value={actionReason}
          type="text"
          placeholder="Reason for quarantine action..."
          class="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/40 text-code-sm font-mono text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
        />
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onclick={() => (actionModalType = null)}
          class="px-3.5 py-1.5 rounded-lg bg-surface-container text-on-surface-variant hover:text-on-surface text-label-md font-mono transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handleConfirmAction}
          class="px-4 py-1.5 rounded-lg font-mono text-label-md font-bold uppercase transition-all cursor-pointer {targetTenant.isQuarantined ? 'bg-secondary text-charcoal hover:bg-secondary-fixed' : 'bg-error text-on-error hover:bg-error-container shadow-[0_0_16px_rgba(239,68,68,0.4)]'}"
        >
          {targetTenant.isQuarantined ? 'Confirm Re-instate' : 'Execute Quarantine'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal: Reset Quota -->
{#if actionModalType === 'reset' && targetTenant}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
    <div class="specular-card w-full max-w-md rounded-xl bg-surface-container-high p-6 space-y-4 border border-outline-variant/40 shadow-2xl">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-on-surface font-semibold text-[16px]">
          <span class="material-symbols-outlined text-primary">restart_alt</span>
          <span>Reset Tenant Sliding Quotas</span>
        </div>
        <button
          type="button"
          onclick={() => (actionModalType = null)}
          class="text-outline hover:text-on-surface p-1 rounded transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <p class="text-body-sm font-body-sm text-on-surface-variant text-[13px]">
        Zero out the current sliding-window RPM counter for <strong class="text-on-surface">{targetTenant.email}</strong> in the Durable Object transactional store.
      </p>

      <div class="space-y-1.5">
        <label for="admin-reset-reason-input" class="text-label-sm font-mono text-outline uppercase">Audit Reason Note</label>
        <input
          id="admin-reset-reason-input"
          bind:value={actionReason}
          type="text"
          placeholder="Reason for resetting quota..."
          class="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/40 text-code-sm font-mono text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
        />
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onclick={() => (actionModalType = null)}
          class="px-3.5 py-1.5 rounded-lg bg-surface-container text-on-surface-variant hover:text-on-surface text-label-md font-mono transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handleConfirmAction}
          class="px-4 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-label-md font-bold uppercase transition-all cursor-pointer"
        >
          Reset Quota
        </button>
      </div>
    </div>
  </div>
{/if}
