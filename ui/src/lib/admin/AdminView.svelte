<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import type { TenantSurveillanceRow, AdminActionPayload, ProviderCircuitOverridePayload } from '../../../../src/contracts/v3_5_types';
  import type { UserTier } from '../../../../src/contracts/v3_types';
  import TenantSurveillance from './TenantSurveillance.svelte';
  import VelocityDials, { type ProviderMatrixItem } from './VelocityDials.svelte';
  import CircuitBreakerControls, { type CircuitState, type AuditLogEntry, type ProviderKey } from './CircuitBreakerControls.svelte';
  import AdminHeader from './AdminHeader.svelte';
  import KillSwitchBanner from './KillSwitchBanner.svelte';
  import AdminTabBar from './AdminTabBar.svelte';
  import TenantsView from './TenantsView.svelte';
  import KeysView from './KeysView.svelte';
  import ProvidersView from './ProvidersView.svelte';
  import AuditLogView from './AuditLogView.svelte';

  let {
    adminEmail = '',
    onNavigate,
  }: {
    adminEmail?: string;
    onNavigate?: (tab: string) => void;
  } = $props();

  // Admin sub-navigation view mode
  let adminTab = $state<'all' | 'surveillance' | 'tenants' | 'keys' | 'providers' | 'audit' | 'velocity' | 'circuits'>('surveillance');

  // Edge host & cluster identification
  const edgeHost = 'admin.key-col.axe08.tech';

  // Global Kill Switch State
  let globalKillSwitchActive = $state(false);

  // Per-Provider Circuit Breaker States
  let circuits = $state<Record<ProviderKey, CircuitState>>({
    gemini: {
      state: 'NORMAL',
      failureCount: 0,
      failureThreshold: 5,
      lastTrippedAt: null,
      avgLatencyMs: 0,
    },
    groq: {
      state: 'NORMAL',
      failureCount: 0,
      failureThreshold: 5,
      lastTrippedAt: null,
      avgLatencyMs: 0,
    },
    cerebras: {
      state: 'NORMAL',
      failureCount: 0,
      failureThreshold: 5,
      lastTrippedAt: null,
      avgLatencyMs: 0,
    },
    deepseek: {
      state: 'NORMAL',
      failureCount: 0,
      failureThreshold: 5,
      lastTrippedAt: null,
      avgLatencyMs: 0,
    },
  });

  // Live tenants and audit logs from D1 database (zero mock data)
  let tenants = $state<Record<string, unknown>[]>([]);
  let auditLogs = $state<AuditLogEntry[]>([]);
  let poolSummary = $state<{
    totalKeys: number;
    activeCommunityKeys: number;
    observationKeys: number;
    quarantinedKeys: number;
    privateKeys: number;
    totalDebtCu?: number;
    totalDebtMicroCu?: number;
    clusterRpmCurrent?: number;
    clusterRpmMax?: number;
    tokenVelocityTpm?: number;
    tokenVelocityMaxTpm?: number;
    spendRateCuPerHour?: number;
    upstreamLatencyMs?: number;
    rotationFairnessScore?: number;
    providers?: ProviderMatrixItem[];
  }>({
    totalKeys: 0,
    activeCommunityKeys: 0,
    observationKeys: 0,
    quarantinedKeys: 0,
    privateKeys: 0,
    totalDebtCu: 0,
    totalDebtMicroCu: 0,
    clusterRpmCurrent: 0,
    clusterRpmMax: 100,
    tokenVelocityTpm: 0,
    tokenVelocityMaxTpm: 40000,
    spendRateCuPerHour: 0,
    upstreamLatencyMs: 0,
    rotationFairnessScore: 100,
    providers: [],
  });
  let isLoading = $state(false);

  // Providers key matrix defaults to empty or live poolSummary
  let providers = $derived<ProviderMatrixItem[]>(
    poolSummary.providers && poolSummary.providers.length > 0
      ? poolSummary.providers
      : [
          { provider: 'gemini', name: 'Google Gemini Flash', model: 'gemini-1.5-flash-latest', activeKeys: 0, healthyKeys: 0, rateLimitedKeys: 0, rpmLimit: 0, currentRpm: 0, status: 'healthy' },
          { provider: 'groq', name: 'Groq LLaMA 3.3', model: 'openai/gpt-oss-120b', activeKeys: 0, healthyKeys: 0, rateLimitedKeys: 0, rpmLimit: 0, currentRpm: 0, status: 'healthy' },
          { provider: 'cerebras', name: 'Cerebras Inference', model: 'llama3.1-8b', activeKeys: 0, healthyKeys: 0, rateLimitedKeys: 0, rpmLimit: 0, currentRpm: 0, status: 'healthy' },
          { provider: 'deepseek', name: 'DeepSeek Reasoner', model: 'deepseek-reasoner', activeKeys: 0, healthyKeys: 0, rateLimitedKeys: 0, rpmLimit: 0, currentRpm: 0, status: 'healthy' },
        ]
  );

  let allKeys = $derived.by(() => {
    const list: Array<Record<string, unknown>> = [];
    for (const t of tenants) {
      if (Array.isArray(t.keys)) {
        for (const k of t.keys) {
          if (typeof k === 'object' && k !== null) {
            list.push({
              ...(k as Record<string, unknown>),
              tenantId: t.id ?? t.tenant_id,
            });
          }
        }
      }
    }
    return list;
  });

  async function loadAdminData() {
    isLoading = true;
    try {
      const res = await api.getAdminTenants();
      tenants = res.tenants || [];
      if (res.pool) {
        const poolAny = res.pool as Record<string, any>;
        poolSummary = {
          ...res.pool,
          spendRateCuPerHour: poolAny.spendRateCuPerHour ?? 0,
        };
      }
    } catch (err) {
      console.error('Failed to load admin surveillance data', err);
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    loadAdminData();
    const interval = setInterval(loadAdminData, 15000);
    return () => clearInterval(interval);
  });

  // Reactive summary calculations
  let activeTenantsCount = $derived(tenants.filter((t) => !t.isQuarantined && !t.is_quarantined).length);
  let quarantinedCount = $derived(tenants.filter((t) => t.isQuarantined || t.is_quarantined).length);
  let anomalyCount = $derived(
    tenants.filter((t) => t.rpmLimit > 0 && t.rpmLimit !== Infinity && t.currentRpm / t.rpmLimit >= 0.85).length
  );
  let totalClusterRpm = $derived(tenants.reduce((acc, t) => acc + (t.currentRpm || 0), 0));
  let totalCumulativeSpendCu = $derived(
    tenants.reduce((acc, t) => acc + (t.todaySpendCu ?? 0), 0)
  );
  let trippedCircuitsCount = $derived(
    (Object.keys(circuits) as ProviderKey[]).filter((p) => circuits[p].state === 'TRIPPED').length
  );

  // Administrative Action Handler (Tier update, Quarantine, Quota Reset)
  async function handleAdminAction(payload: AdminActionPayload) {
    const t0 = performance.now();
    if (payload.action === 'UPDATE_TIER' && payload.newTier) {
      await api.updateTenantTier(payload.targetTenantId, payload.newTier, payload.reason);
      const syncDurationMs = Math.round((performance.now() - t0) * 10) / 10;
      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail: payload.adminEmail,
          action: 'UPDATE_TIER',
          target: `${payload.targetTenantId} -> ${payload.newTier}`,
          reason: payload.reason,
          syncDurationMs,
        },
        ...auditLogs,
      ];
      await loadAdminData();
    } else if (payload.action === 'QUARANTINE') {
      await api.quarantineTenant(payload.targetTenantId, true, payload.reason);
      const syncDurationMs = Math.round((performance.now() - t0) * 10) / 10;
      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail: payload.adminEmail,
          action: 'QUARANTINE_TENANT',
          target: payload.targetTenantId,
          reason: payload.reason,
          syncDurationMs,
        },
        ...auditLogs,
      ];
      await loadAdminData();
    } else if (payload.action === 'UNQUARANTINE') {
      await api.quarantineTenant(payload.targetTenantId, false, payload.reason);
      const syncDurationMs = Math.round((performance.now() - t0) * 10) / 10;
      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail: payload.adminEmail,
          action: 'UNQUARANTINE_TENANT',
          target: payload.targetTenantId,
          reason: payload.reason,
          syncDurationMs,
        },
        ...auditLogs,
      ];
      await loadAdminData();
    } else if (payload.action === 'RESET_QUOTA') {
      await api.resetTenantQuota(payload.targetTenantId, payload.reason);
      const syncDurationMs = Math.round((performance.now() - t0) * 10) / 10;
      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail: payload.adminEmail,
          action: 'RESET_QUOTA',
          target: payload.targetTenantId,
          reason: payload.reason,
          syncDurationMs,
        },
        ...auditLogs,
      ];
      await loadAdminData();
    }
  }

  async function handleKeyRoutingStatus(keyId: string, status: 'ACTIVE' | 'QUARANTINED' | 'OBSERVATION') {
    const t0 = performance.now();
    await api.updateKeyRoutingStatus(keyId, status);
    const syncDurationMs = Math.round((performance.now() - t0) * 10) / 10;
    auditLogs = [
      {
        id: `aud_${Date.now().toString(36)}`,
        timestamp: Date.now(),
        adminEmail,
        action: `KEY_${status}`,
        target: keyId,
        reason: `Key status set to ${status}`,
        syncDurationMs,
      },
      ...auditLogs,
    ];
    await loadAdminData();
  }

  async function handleKeyPoolMode(keyId: string, poolType: 'COMMUNITY' | 'PRIVATE') {
    const t0 = performance.now();
    await api.updateKeyPoolMode(keyId, poolType);
    const syncDurationMs = Math.round((performance.now() - t0) * 10) / 10;
    auditLogs = [
      {
        id: `aud_${Date.now().toString(36)}`,
        timestamp: Date.now(),
        adminEmail,
        action: `KEY_POOL_${poolType}`,
        target: keyId,
        reason: `Key pool mode switched to ${poolType}`,
        syncDurationMs,
      },
      ...auditLogs,
    ];
    await loadAdminData();
  }

  async function handleDeleteKey(keyId: string) {
    if (confirm('Permanently remove this API key from the collective pool?')) {
      const t0 = performance.now();
      await api.adminDeleteKey(keyId);
      const syncDurationMs = Math.round((performance.now() - t0) * 10) / 10;
      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail,
          action: 'KEY_DELETED',
          target: keyId,
          reason: 'Key removed by administrator',
          syncDurationMs,
        },
        ...auditLogs,
      ];
      await loadAdminData();
    }
  }

  async function handleManagePool(action: 'ACTIVATE_ALL_OBSERVATION' | 'PURGE_QUARANTINED' | 'RESET_ALL_DEBT') {
    const t0 = performance.now();
    await api.manageCommunityPool(action);
    const syncDurationMs = Math.round((performance.now() - t0) * 10) / 10;
    auditLogs = [
      {
        id: `aud_${Date.now().toString(36)}`,
        timestamp: Date.now(),
        adminEmail,
        action: `POOL_${action}`,
        target: 'COMMUNITY_POOL',
        reason: `Admin trigger: ${action}`,
        syncDurationMs,
      },
      ...auditLogs,
    ];
    await loadAdminData();
  }

  // Provider Circuit Breaker Override Handler
  async function handleCircuitOverride(payload: ProviderCircuitOverridePayload) {
    const t0 = performance.now();
    if (payload.provider === 'all') {
      const keys = Object.keys(circuits) as ProviderKey[];
      for (const k of keys) {
        circuits[k] = {
          ...circuits[k],
          state: payload.state,
          lastTrippedAt: payload.state === 'TRIPPED' ? Date.now() : circuits[k].lastTrippedAt,
          reason: payload.reason,
        };
      }
    } else {
      const prov = payload.provider as ProviderKey;
      if (circuits[prov]) {
        circuits[prov] = {
          ...circuits[prov],
          state: payload.state,
          lastTrippedAt: payload.state === 'TRIPPED' ? Date.now() : circuits[prov].lastTrippedAt,
          reason: payload.reason,
        };

        // Update provider matrix status accordingly
        providers = providers.map((p) =>
          p.provider === prov
            ? { ...p, status: payload.state === 'TRIPPED' ? 'tripped' : 'healthy' }
            : p
        );
      }
    }

    let syncDurationMs = 0;
    try {
      await fetch('/api/admin/circuit-breaker', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: payload.provider,
          state: payload.state,
          reason: payload.reason,
          adminEmail: payload.adminEmail,
        }),
      });
      syncDurationMs = Math.round((performance.now() - t0) * 10) / 10;
    } catch {
      // fallback
    }

    auditLogs = [
      {
        id: `aud_${Date.now().toString(36)}`,
        timestamp: Date.now(),
        adminEmail: payload.adminEmail,
        action: payload.state === 'TRIPPED' ? 'CIRCUIT_TRIP_OVERRIDE' : 'CIRCUIT_RESET_NORMAL',
        target: payload.provider.toUpperCase(),
        reason: payload.reason,
        syncDurationMs,
      },
      ...auditLogs,
    ];
  }

  // Global Kill Switch Handler
  async function handleGlobalKillSwitch(active: boolean, reason: string) {
    const t0 = performance.now();
    globalKillSwitchActive = active;

    let syncDurationMs = 0;
    try {
      await fetch('/api/admin/kill-switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active, reason, adminEmail }),
      });
      syncDurationMs = Math.round((performance.now() - t0) * 10) / 10;
    } catch {
      // fallback
    }

    auditLogs = [
      {
        id: `aud_${Date.now().toString(36)}`,
        timestamp: Date.now(),
        adminEmail,
        action: active ? 'GLOBAL_KILL_SWITCH_ENGAGED' : 'GLOBAL_KILL_SWITCH_DISARMED',
        target: 'ALL_EDGE_ISOLATES',
        reason,
        syncDurationMs,
      },
      ...auditLogs,
    ];
  }
</script>

<div class="space-y-6">
  <!-- 1. Top Admin Subdomain & Security Header Banner -->
  <AdminHeader
    {edgeHost}
    {adminEmail}
    {activeTenantsCount}
    {anomalyCount}
    {totalClusterRpm}
    totalCumulativeSpendCu={totalCumulativeSpendCu}
    {quarantinedCount}
    {trippedCircuitsCount}
    {globalKillSwitchActive}
    {onNavigate}
  />

  <!-- 2. Global Kill Switch Active Warning Banner (Top Level Priority) -->
  <KillSwitchBanner
    {globalKillSwitchActive}
    onDisarm={() => handleGlobalKillSwitch(false, 'Manual recovery via top banner')}
  />

  <!-- 3. Admin View Navigation Sub-Tabs Bar -->
  <AdminTabBar
    bind:adminTab
    tenantsCount={tenants.length}
    {trippedCircuitsCount}
  />

  <!-- 4. Tab Views -->
  {#if adminTab === 'velocity'}
    <!-- Velocity Dials Component Section -->
    <section class="space-y-4">
      <VelocityDials
        clusterRpmCurrent={poolSummary.clusterRpmCurrent ?? 0}
        clusterRpmMax={poolSummary.clusterRpmMax ?? 100}
        tokenVelocityTpm={poolSummary.tokenVelocityTpm ?? 0}
        tokenVelocityMaxTpm={poolSummary.tokenVelocityMaxTpm ?? 40000}
        upstreamLatencyMs={poolSummary.upstreamLatencyMs ?? 0}
        rotationFairnessScore={poolSummary.rotationFairnessScore ?? 100}
        {providers}
      />
    </section>
  {/if}

  {#if adminTab === 'circuits'}
    <!-- Circuit Breaker & Emergency Controls Component Section -->
    <section class="space-y-4">
      <CircuitBreakerControls
        {globalKillSwitchActive}
        {adminEmail}
        {circuits}
        {auditLogs}
        onCircuitOverride={handleCircuitOverride}
        onGlobalKillSwitch={handleGlobalKillSwitch}
      />
    </section>
  {/if}

  {#if adminTab === 'tenants'}
    <section class="space-y-4">
      <TenantsView
        {tenants}
        {adminEmail}
        onResetQuota={async (tenantId, reason) => {
          await handleAdminAction({ action: 'RESET_QUOTA', targetTenantId: tenantId, reason, adminEmail });
        }}
        onAdjustTier={async (tenantId, newTier) => {
          await handleAdminAction({ action: 'ADJUST_TIER', targetTenantId: tenantId, newTier, adminEmail });
        }}
        onToggleCommunal={async (tenantId, allow) => {
          await handleAdminAction({ action: allow ? 'UNFREEZE' : 'FREEZE_COMMUNAL', targetTenantId: tenantId, adminEmail });
        }}
      />
    </section>
  {/if}

  {#if adminTab === 'keys'}
    <section class="space-y-4">
      <KeysView
        keys={allKeys}
        onUpdateStatus={handleKeyRoutingStatus}
        onDeleteKey={handleDeleteKey}
      />
    </section>
  {/if}

  {#if adminTab === 'providers'}
    <section class="space-y-4">
      <ProvidersView
        {circuits}
        onCircuitOverride={handleCircuitOverride}
      />
    </section>
  {/if}

  {#if adminTab === 'audit'}
    <section class="space-y-4">
      <AuditLogView {auditLogs} />
    </section>
  {/if}

  {#if adminTab === 'surveillance'}
    <!-- Community Pool Management & Fleet Overview Controls -->
    <div class="specular-card rounded-xl bg-surface-container-low/90 backdrop-blur-md border border-outline-variant/30 p-5 shadow-lg space-y-4">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/20 pb-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <span class="material-symbols-outlined text-[24px]">hub</span>
          </div>
          <div>
            <h3 class="text-title-md font-semibold text-on-surface flex items-center gap-2">
              Community Pool Management
              <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-secondary/15 text-secondary border border-secondary/30 uppercase">
                Fleet Active
              </span>
            </h3>
            <p class="text-body-sm text-on-surface-variant">
              High-velocity arbitration across communal provider keys. 1-click approvals, purge quarantined keys, and reconcile compute debt.
            </p>
          </div>
        </div>

        <!-- Global Pool Actions -->
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onclick={() => handleManagePool('ACTIVATE_ALL_OBSERVATION')}
            class="px-3 py-1.5 rounded-lg bg-secondary/15 hover:bg-secondary/25 text-secondary text-xs font-semibold flex items-center gap-1.5 border border-secondary/30 cursor-pointer transition-colors"
            title="Immediately approve all community keys currently in 24h observation"
          >
            <span class="material-symbols-outlined text-[16px]">done_all</span>
            <span>Approve All Observation ({poolSummary.observationKeys})</span>
          </button>

          <button
            type="button"
            onclick={() => handleManagePool('PURGE_QUARANTINED')}
            class="px-3 py-1.5 rounded-lg bg-error/15 hover:bg-error/25 text-error text-xs font-semibold flex items-center gap-1.5 border border-error/30 cursor-pointer transition-colors"
            title="Delete all invalid or quarantined keys fleet-wide"
          >
            <span class="material-symbols-outlined text-[16px]">cleaning_services</span>
            <span>Purge Quarantined ({poolSummary.quarantinedKeys})</span>
          </button>

          <button
            type="button"
            onclick={() => handleManagePool('RESET_ALL_DEBT')}
            class="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-outline hover:text-on-surface text-xs font-semibold flex items-center gap-1.5 border border-outline-variant/30 cursor-pointer transition-colors"
            title="Reset debt for all tenants"
          >
            <span class="material-symbols-outlined text-[16px]">currency_exchange</span>
            <span>Reconcile Fleet Debt</span>
          </button>

          <button
            type="button"
            onclick={loadAdminData}
            class="p-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-outline hover:text-on-surface transition-colors cursor-pointer"
            title="Refresh Live Data from D1"
          >
            <span class="material-symbols-outlined text-[18px] {isLoading ? 'animate-spin' : ''}">refresh</span>
          </button>
        </div>
      </div>

      <!-- Quick Metrics Grid -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-1 text-center font-mono">
        <div class="p-2.5 rounded-lg bg-surface-container/40 border border-outline-variant/15">
          <span class="text-[10px] text-outline uppercase block">Fleet Keys</span>
          <span class="text-title-sm font-bold text-on-surface">{poolSummary.totalKeys}</span>
        </div>
        <div class="p-2.5 rounded-lg bg-surface-container/40 border border-outline-variant/15">
          <span class="text-[10px] text-outline uppercase block">Active Communal</span>
          <span class="text-title-sm font-bold text-secondary">{poolSummary.activeCommunityKeys}</span>
        </div>
        <div class="p-2.5 rounded-lg bg-surface-container/40 border border-outline-variant/15">
          <span class="text-[10px] text-outline uppercase block">Observation</span>
          <span class="text-title-sm font-bold text-amber-300">{poolSummary.observationKeys}</span>
        </div>
        <div class="p-2.5 rounded-lg bg-surface-container/40 border border-outline-variant/15">
          <span class="text-[10px] text-outline uppercase block">Quarantined</span>
          <span class="text-title-sm font-bold text-error">{poolSummary.quarantinedKeys}</span>
        </div>
        <div class="p-2.5 rounded-lg bg-surface-container/40 border border-outline-variant/15">
          <span class="text-[10px] text-outline uppercase block">Private Keys</span>
          <span class="text-title-sm font-bold text-primary">{poolSummary.privateKeys}</span>
        </div>
        <div class="p-2.5 rounded-lg bg-surface-container/40 border border-outline-variant/15">
          <span class="text-[10px] text-outline uppercase block">Total Debt</span>
          <span class="text-title-sm font-bold text-on-surface-variant">{(poolSummary.totalDebtCu ?? poolSummary.totalDebtMicroCu ?? 0).toLocaleString()} CU</span>
        </div>
      </div>
    </div>

    <!-- Tenant Surveillance & Abuse Sentinel Component Section -->
    <section class="space-y-4">
      <TenantSurveillance
        {tenants}
        {adminEmail}
        onAdminAction={handleAdminAction}
        onUpdateKeyRoutingStatus={handleKeyRoutingStatus}
        onUpdateKeyPoolMode={handleKeyPoolMode}
        onDeleteKey={handleDeleteKey}
      />
    </section>
  {/if}
</div>
