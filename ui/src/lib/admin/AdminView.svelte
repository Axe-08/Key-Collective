<script lang="ts">
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

  // Initial Tenants with realistic operational data
  let tenants = $state<TenantSurveillanceRow[]>([
    {
      tenantId: 'usr_ultra_01',
      email: 'dev-lead@anthropic-partner.io',
      authProvider: 'github',
      tier: 'ultra',
      currentRpm: 142,
      rpmLimit: Infinity,
      todaySpendMicrodollars: 1420000, // $1.42
      activeKeyCount: 12,
      isQuarantined: false,
      lastActiveTimestamp: Date.now() - 4000,
    },
    {
      tenantId: 'usr_max_05',
      email: 'platform-team@enterprise-ai.corp',
      authProvider: 'google',
      tier: 'max',
      currentRpm: 48,
      rpmLimit: 60,
      todaySpendMicrodollars: 840000, // $0.84
      activeKeyCount: 8,
      isQuarantined: false,
      lastActiveTimestamp: Date.now() - 12000,
    },
    {
      tenantId: 'usr_builder_02',
      email: 'sarah@startup-nexus.co',
      authProvider: 'github',
      tier: 'builder',
      currentRpm: 19,
      rpmLimit: 20,
      todaySpendMicrodollars: 180000, // $0.18
      activeKeyCount: 3,
      isQuarantined: false,
      lastActiveTimestamp: Date.now() - 25000,
    },
    {
      tenantId: 'usr_gh_9824102',
      email: 'dev@keycollective.io',
      authProvider: 'github',
      tier: 'builder',
      currentRpm: 6,
      rpmLimit: 20,
      todaySpendMicrodollars: 42000, // $0.042
      activeKeyCount: 2,
      isQuarantined: false,
      lastActiveTimestamp: Date.now() - 60000,
    },
    {
      tenantId: 'usr_prob_03',
      email: 'anon-scraping@proton.me',
      authProvider: 'email',
      tier: 'probationary',
      currentRpm: 2,
      rpmLimit: 2,
      todaySpendMicrodollars: 2000, // $0.002
      activeKeyCount: 1,
      isQuarantined: false,
      lastActiveTimestamp: Date.now() - 95000,
    },
    {
      tenantId: 'usr_quar_04',
      email: 'sybil-botnet-node9@badactor.xyz',
      authProvider: 'email',
      tier: 'probationary',
      currentRpm: 0,
      rpmLimit: 2,
      todaySpendMicrodollars: 0,
      activeKeyCount: 0,
      isQuarantined: true,
      lastActiveTimestamp: Date.now() - 3600000 * 5,
    },
  ]);

  // Immutable Audit Trail
  let auditLogs = $state<AuditLogEntry[]>([
    {
      id: 'aud_init_01',
      timestamp: Date.now() - 3600000 * 2,
      adminEmail: 'admin@keycollective.io',
      action: 'BOOTSTRAP',
      target: 'GLOBAL_CONFIG',
      reason: 'Initial Edge Cluster Bootstrapping (SIN-01)',
      syncDurationMs: 3.2,
    },
    {
      id: 'aud_init_02',
      timestamp: Date.now() - 1800000,
      adminEmail: 'admin@keycollective.io',
      action: 'CIRCUIT_RESET',
      target: 'gemini',
      reason: 'Pre-flight circuit reset verified',
      syncDurationMs: 2.1,
    },
    {
      id: 'aud_init_03',
      timestamp: Date.now() - 900000,
      adminEmail: 'admin@keycollective.io',
      action: 'QUARANTINE',
      target: 'usr_quar_04',
      reason: 'Sybil velocity blast detected across 40 edge IPs',
      syncDurationMs: 4.8,
    },
  ]);

  // Reactive summary calculations
  let activeTenantsCount = $derived(tenants.filter((t) => !t.isQuarantined).length);
  let quarantinedCount = $derived(tenants.filter((t) => t.isQuarantined).length);
  let anomalyCount = $derived(
    tenants.filter((t) => t.rpmLimit > 0 && t.rpmLimit !== Infinity && t.currentRpm / t.rpmLimit >= 0.85).length
  );
  let totalClusterRpm = $derived(tenants.reduce((acc, t) => acc + t.currentRpm, 0));
  let totalCumulativeSpendMicrodollars = $derived(tenants.reduce((acc, t) => acc + t.todaySpendMicrodollars, 0));
  let trippedCircuitsCount = $derived(
    (Object.keys(circuits) as ProviderKey[]).filter((p) => circuits[p].state === 'TRIPPED').length
  );

  // Administrative Action Handler (Tier update, Quarantine, Quota Reset)
  function handleAdminAction(payload: AdminActionPayload) {
    const target = tenants.find((t) => t.tenantId === payload.targetTenantId);
    if (!target) return;

    if (payload.action === 'UPDATE_TIER' && payload.newTier) {
      const oldTier = target.tier;
      let newRpmLimit = 20;
      if (payload.newTier === 'ultra') newRpmLimit = Infinity;
      else if (payload.newTier === 'admin') newRpmLimit = Infinity;
      else if (payload.newTier === 'max') newRpmLimit = 60;
      else if (payload.newTier === 'builder') newRpmLimit = 20;
      else if (payload.newTier === 'probationary') newRpmLimit = 2;

      tenants = tenants.map((t) =>
        t.tenantId === payload.targetTenantId
          ? { ...t, tier: payload.newTier as UserTier, rpmLimit: newRpmLimit }
          : t
      );

      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail: payload.adminEmail,
          action: 'UPDATE_TIER',
          target: `${target.tenantId} (${oldTier} -> ${payload.newTier})`,
          reason: payload.reason,
          syncDurationMs: +(Math.random() * 2 + 2).toFixed(1),
        },
        ...auditLogs,
      ];
    } else if (payload.action === 'QUARANTINE') {
      tenants = tenants.map((t) =>
        t.tenantId === payload.targetTenantId
          ? { ...t, isQuarantined: true, currentRpm: 0 }
          : t
      );

      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail: payload.adminEmail,
          action: 'QUARANTINE_TENANT',
          target: target.tenantId,
          reason: payload.reason,
          syncDurationMs: +(Math.random() * 1.5 + 3.1).toFixed(1),
        },
        ...auditLogs,
      ];
    } else if (payload.action === 'UNQUARANTINE') {
      tenants = tenants.map((t) =>
        t.tenantId === payload.targetTenantId
          ? { ...t, isQuarantined: false }
          : t
      );

      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail: payload.adminEmail,
          action: 'UNQUARANTINE_TENANT',
          target: target.tenantId,
          reason: payload.reason,
          syncDurationMs: +(Math.random() * 1.5 + 2.5).toFixed(1),
        },
        ...auditLogs,
      ];
    } else if (payload.action === 'RESET_QUOTA') {
      tenants = tenants.map((t) =>
        t.tenantId === payload.targetTenantId
          ? { ...t, currentRpm: 0 }
          : t
      );

      auditLogs = [
        {
          id: `aud_${Date.now().toString(36)}`,
          timestamp: Date.now(),
          adminEmail: payload.adminEmail,
          action: 'RESET_QUOTA',
          target: target.tenantId,
          reason: payload.reason,
          syncDurationMs: +(Math.random() * 1.2 + 1.8).toFixed(1),
        },
        ...auditLogs,
      ];
    }
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
    <!-- Tenant Surveillance & Abuse Sentinel Component Section -->
    <section class="space-y-4">
      <TenantSurveillance
        {tenants}
        {adminEmail}
        onAdminAction={handleAdminAction}
      />
    </section>
  {/if}
</div>
