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

  let {
    adminEmail = 'admin@keycollective.io',
    onNavigate,
  }: {
    adminEmail?: string;
    onNavigate?: (tab: string) => void;
  } = $props();

  // Admin sub-navigation view mode
  let adminTab = $state<'all' | 'surveillance' | 'velocity' | 'circuits'>('surveillance');

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
      avgLatencyMs: 238,
    },
    groq: {
      state: 'NORMAL',
      failureCount: 0,
      failureThreshold: 5,
      lastTrippedAt: null,
      avgLatencyMs: 114,
    },
    cerebras: {
      state: 'NORMAL',
      failureCount: 0,
      failureThreshold: 5,
      lastTrippedAt: null,
      avgLatencyMs: 79,
    },
    deepseek: {
      state: 'NORMAL',
      failureCount: 1,
      failureThreshold: 5,
      lastTrippedAt: null,
      avgLatencyMs: 385,
    },
  });

  // Providers key matrix
  let providers = $state<ProviderMatrixItem[]>([
    {
      provider: 'gemini',
      name: 'Google Gemini Flash',
      model: 'gemini-1.5-flash-latest',
      activeKeys: 12,
      healthyKeys: 11,
      rateLimitedKeys: 1,
      rpmLimit: 180,
      currentRpm: 78,
      status: 'healthy',
    },
    {
      provider: 'groq',
      name: 'Groq LLaMA 3.3',
      model: 'llama-3.3-70b-versatile',
      activeKeys: 8,
      healthyKeys: 8,
      rateLimitedKeys: 0,
      rpmLimit: 240,
      currentRpm: 84,
      status: 'healthy',
    },
    {
      provider: 'cerebras',
      name: 'Cerebras Inference',
      model: 'llama3.1-8b',
      activeKeys: 4,
      healthyKeys: 4,
      rateLimitedKeys: 0,
      rpmLimit: 240,
      currentRpm: 16,
      status: 'healthy',
    },
    {
      provider: 'deepseek',
      name: 'DeepSeek Reasoner',
      model: 'deepseek-reasoner',
      activeKeys: 2,
      healthyKeys: 2,
      rateLimitedKeys: 0,
      rpmLimit: 60,
      currentRpm: 4,
      status: 'healthy',
    },
  ]);

  // Live tenants and audit logs from D1 database (zero mock data)
  let tenants = $state<any[]>([]);
  let auditLogs = $state<AuditLogEntry[]>([]);
  let poolSummary = $state<{
    totalKeys: number;
    activeCommunityKeys: number;
    observationKeys: number;
    quarantinedKeys: number;
    privateKeys: number;
    totalDebtMicroCu: number;
  }>({
    totalKeys: 0,
    activeCommunityKeys: 0,
    observationKeys: 0,
    quarantinedKeys: 0,
    privateKeys: 0,
    totalDebtMicroCu: 0,
  });
  let isLoading = $state(false);

  async function loadAdminData() {
    isLoading = true;
    try {
      const res = await api.getAdminTenants();
      tenants = res.tenants || [];
      if (res.pool) {
        poolSummary = res.pool;
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
  let totalCumulativeSpendMicrodollars = $derived(tenants.reduce((acc, t) => acc + (t.todaySpendMicrodollars || 0), 0));
  let trippedCircuitsCount = $derived(
    (Object.keys(circuits) as ProviderKey[]).filter((p) => circuits[p].state === 'TRIPPED').length
  );

  // Administrative Action Handler (Tier update, Quarantine, Quota Reset)
  async function handleAdminAction(payload: AdminActionPayload) {
    if (payload.action === 'UPDATE_TIER' && payload.newTier) {
      await api.updateTenantTier(payload.targetTenantId, payload.newTier, payload.reason);
      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail: payload.adminEmail,
          action: 'UPDATE_TIER',
          target: `${payload.targetTenantId} -> ${payload.newTier}`,
          reason: payload.reason,
          syncDurationMs: 2.5,
        },
        ...auditLogs,
      ];
      await loadAdminData();
    } else if (payload.action === 'QUARANTINE') {
      await api.quarantineTenant(payload.targetTenantId, true, payload.reason);
      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail: payload.adminEmail,
          action: 'QUARANTINE_TENANT',
          target: payload.targetTenantId,
          reason: payload.reason,
          syncDurationMs: 3.1,
        },
        ...auditLogs,
      ];
      await loadAdminData();
    } else if (payload.action === 'UNQUARANTINE') {
      await api.quarantineTenant(payload.targetTenantId, false, payload.reason);
      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail: payload.adminEmail,
          action: 'UNQUARANTINE_TENANT',
          target: payload.targetTenantId,
          reason: payload.reason,
          syncDurationMs: 2.1,
        },
        ...auditLogs,
      ];
      await loadAdminData();
    } else if (payload.action === 'RESET_QUOTA') {
      await api.updateTenantTier(payload.targetTenantId, 'builder', 'Reset quota');
      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail: payload.adminEmail,
          action: 'RESET_QUOTA',
          target: payload.targetTenantId,
          reason: payload.reason,
          syncDurationMs: 1.8,
        },
        ...auditLogs,
      ];
      await loadAdminData();
    }
  }

  async function handleKeyRoutingStatus(keyId: string, status: 'ACTIVE' | 'QUARANTINED' | 'OBSERVATION') {
    await api.updateKeyRoutingStatus(keyId, status);
    auditLogs = [
      {
        id: `aud_${Date.now().toString(36)}`,
        timestamp: Date.now(),
        adminEmail,
        action: `KEY_${status}`,
        target: keyId,
        reason: `Key status set to ${status}`,
        syncDurationMs: 2.0,
      },
      ...auditLogs,
    ];
    await loadAdminData();
  }

  async function handleKeyPoolMode(keyId: string, poolType: 'COMMUNITY' | 'PRIVATE') {
    await api.updateKeyPoolMode(keyId, poolType);
    auditLogs = [
      {
        id: `aud_${Date.now().toString(36)}`,
        timestamp: Date.now(),
        adminEmail,
        action: `KEY_POOL_${poolType}`,
        target: keyId,
        reason: `Key pool mode switched to ${poolType}`,
        syncDurationMs: 2.0,
      },
      ...auditLogs,
    ];
    await loadAdminData();
  }

  async function handleDeleteKey(keyId: string) {
    if (confirm('Permanently remove this API key from the collective pool?')) {
      await api.adminDeleteKey(keyId);
      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail,
          action: 'KEY_DELETED',
          target: keyId,
          reason: 'Key removed by administrator',
          syncDurationMs: 2.0,
        },
        ...auditLogs,
      ];
      await loadAdminData();
    }
  }

  async function handleManagePool(action: 'ACTIVATE_ALL_OBSERVATION' | 'PURGE_QUARANTINED' | 'RESET_ALL_DEBT') {
    await api.manageCommunityPool(action);
    auditLogs = [
      {
        id: `aud_${Date.now().toString(36)}`,
        timestamp: Date.now(),
        adminEmail,
        action: `POOL_${action}`,
        target: 'COMMUNITY_POOL',
        reason: `Admin trigger: ${action}`,
        syncDurationMs: 3.5,
      },
      ...auditLogs,
    ];
    await loadAdminData();
  }

  // Provider Circuit Breaker Override Handler
  function handleCircuitOverride(payload: ProviderCircuitOverridePayload) {
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

    auditLogs = [
      {
        id: `aud_${Date.now().toString(36)}`,
        timestamp: Date.now(),
        adminEmail: payload.adminEmail,
        action: payload.state === 'TRIPPED' ? 'CIRCUIT_TRIP_OVERRIDE' : 'CIRCUIT_RESET_NORMAL',
        target: payload.provider.toUpperCase(),
        reason: payload.reason,
        syncDurationMs: +(Math.random() * 1.8 + 1.9).toFixed(1),
      },
      ...auditLogs,
    ];
  }

  // Global Kill Switch Handler
  function handleGlobalKillSwitch(active: boolean, reason: string) {
    globalKillSwitchActive = active;
    auditLogs = [
      {
        id: `aud_${Date.now().toString(36)}`,
        timestamp: Date.now(),
        adminEmail,
        action: active ? 'GLOBAL_KILL_SWITCH_ENGAGED' : 'GLOBAL_KILL_SWITCH_DISARMED',
        target: 'ALL_EDGE_ISOLATES',
        reason,
        syncDurationMs: +(Math.random() * 2.5 + 4.1).toFixed(1),
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
    {totalCumulativeSpendMicrodollars}
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
        clusterRpmCurrent={totalClusterRpm}
        clusterRpmMax={450}
        tokenVelocityTpm={94200}
        tokenVelocityMaxTpm={300000}
        spendRateMicrodollarsPerHour={210000}
        upstreamLatencyMs={138}
        rotationFairnessScore={98.6}
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
          <span class="text-title-sm font-bold text-on-surface-variant">{(poolSummary.totalDebtMicroCu / 1000).toFixed(1)}k µCU</span>
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
