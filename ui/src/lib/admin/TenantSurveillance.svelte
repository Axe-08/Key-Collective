<script lang="ts">
  import type { TenantSurveillanceRow, AdminActionPayload } from '../../../../src/contracts/v3_5_types';
  import type { UserTier } from '../../../../src/contracts/v3_types';
  import {
    isAnomaly,
    SurveillanceFilterBar,
    SurveillanceTable,
    SurveillanceActionModal,
  } from './surveillance';

  let {
    tenants = [],
    adminEmail = 'admin@keycollective.io',
    onAdminAction,
    onUpdateKeyRoutingStatus,
    onUpdateKeyPoolMode,
    onDeleteKey,
  }: {
    tenants?: any[];
    adminEmail?: string;
    onAdminAction?: (payload: AdminActionPayload) => void;
    onUpdateKeyRoutingStatus?: (keyId: string, status: 'ACTIVE' | 'QUARANTINED' | 'OBSERVATION') => void;
    onUpdateKeyPoolMode?: (keyId: string, poolType: 'COMMUNITY' | 'PRIVATE') => void;
    onDeleteKey?: (keyId: string) => void;
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
  <SurveillanceFilterBar
    bind:searchQuery
    bind:tierFilter
    bind:quarantineFilter
    bind:anomalyOnly
    bind:sortBy
  />

  <!-- Main Surveillance Table -->
  <SurveillanceTable
    {filteredTenants}
    onOpenTierModal={openTierModal}
    onOpenResetModal={openResetModal}
    onOpenQuarantineModal={openQuarantineModal}
    {onUpdateKeyRoutingStatus}
    {onUpdateKeyPoolMode}
    {onDeleteKey}
  />
</div>

<!-- Modal: Actions -->
<SurveillanceActionModal
  {targetTenant}
  {actionModalType}
  bind:selectedNewTier
  bind:actionReason
  onClose={() => (actionModalType = null)}
  onConfirm={handleConfirmAction}
/>
