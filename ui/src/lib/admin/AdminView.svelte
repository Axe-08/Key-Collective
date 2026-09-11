<script lang="ts">
  import type { TenantSurveillanceRow, AdminActionPayload, ProviderCircuitOverridePayload, Microdollars } from '../../../../src/contracts/v3_5_types';
  import type { UserTier } from '../../../../src/contracts/v3_types';
  import TenantSurveillance from './TenantSurveillance.svelte';
  import VelocityDials, { type ProviderMatrixItem } from './VelocityDials.svelte';
  import CircuitBreakerControls, { type CircuitState, type AuditLogEntry, type ProviderKey } from './CircuitBreakerControls.svelte';
  import { formatMicrodollars } from '../types';

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
  const edgeNodeId = 'SIN-01';

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
  <div class="specular-border rounded-xl bg-surface-container-low/95 backdrop-blur-xl border border-outline-variant/40 p-5 shadow-2xl relative overflow-hidden">
    <!-- Background Amber Glow Accent -->
    <div class="absolute -right-16 -top-16 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
      <!-- Left: Host, Badge & Title -->
      <div class="space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <!-- Subdomain Badge -->
          <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 font-mono text-label-sm font-bold shadow-inner">
            <span class="material-symbols-outlined text-[15px]">lock</span>
            <span>{edgeHost}</span>
          </div>

          <!-- Zero-Knowledge 404 Guard Indicator -->
          <div class="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-mono text-[10px]" title="Non-admin requests receive HTTP 404 Not Found at edge isolate">
            <span class="material-symbols-outlined text-[12px] text-primary">visibility_off</span>
            <span>Zero-Knowledge 404 Guard</span>
          </div>
        </div>

        <div>
          <h1 class="text-headline-lg font-headline-lg text-on-surface font-bold tracking-tight flex items-center gap-2.5">
            <span>Root Platform Surveillance &amp; Edge Operations</span>
            <span class="px-2 py-0.5 rounded text-xs font-mono font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40">
              SUPERUSER
            </span>
          </h1>
          <p class="text-body-md font-body-md text-on-surface-variant mt-0.5">
            Administrative surveillance console for tenant velocity dials, fixed-point microdollar spend ledger, and sub-5ms circuit breaker trip overrides.
          </p>
        </div>
      </div>

      <!-- Right: Operator Session & Navigation Quick-Link -->
      <div class="flex items-center gap-3 shrink-0">
        <!-- Operator Pill -->
        <div class="px-3 py-2 rounded-lg bg-surface-container-lowest/80 border border-outline-variant/30 flex items-center gap-2.5">
          <div class="w-7 h-7 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center justify-center font-mono font-bold text-xs">
            A
          </div>
          <div class="flex flex-col">
            <span class="text-label-sm font-mono text-outline leading-tight">Admin Session</span>
            <span class="text-label-md font-mono text-on-surface font-semibold leading-tight">{adminEmail}</span>
          </div>
        </div>

        {#if onNavigate}
          <button
            type="button"
            onclick={() => onNavigate('pool')}
            class="px-3 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface border border-outline-variant/40 text-label-md font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Return to Public Console"
          >
            <span class="material-symbols-outlined text-[16px]">arrow_back</span>
            <span>Exit Admin</span>
          </button>
        {/if}
      </div>
    </div>

    <!-- Live Platform KPI Readout Strip -->
    <div class="mt-5 pt-4 border-t border-outline-variant/20 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono text-xs">
      <!-- KPI 1: Active Tenants -->
      <div class="p-2.5 rounded-lg bg-surface-container-lowest/60 border border-outline-variant/20 flex flex-col">
        <span class="text-outline text-[11px] uppercase">Active Tenants</span>
        <span class="text-headline-sm font-bold text-on-surface text-[18px]">{activeTenantsCount}</span>
        <span class="text-secondary text-[10px]">Zero Cross-Tenant State</span>
      </div>

      <!-- KPI 2: Anomaly Spikes -->
      <div class="p-2.5 rounded-lg bg-surface-container-lowest/60 border border-outline-variant/20 flex flex-col">
        <span class="text-outline text-[11px] uppercase">Anomaly Spikes</span>
        <span class="text-headline-sm font-bold {anomalyCount > 0 ? 'text-amber-400 animate-pulse' : 'text-secondary'} text-[18px]">
          {anomalyCount}
        </span>
        <span class="text-outline text-[10px]">&gt;85% RPM Cap</span>
      </div>

      <!-- KPI 3: Cluster Throughput -->
      <div class="p-2.5 rounded-lg bg-surface-container-lowest/60 border border-outline-variant/20 flex flex-col">
        <span class="text-outline text-[11px] uppercase">Cluster RPM</span>
        <span class="text-headline-sm font-bold text-primary text-[18px]">{totalClusterRpm} RPM</span>
        <span class="text-outline text-[10px]">Sliding Window</span>
      </div>

      <!-- KPI 4: Cumulative Spend -->
      <div class="p-2.5 rounded-lg bg-surface-container-lowest/60 border border-outline-variant/20 flex flex-col">
        <span class="text-outline text-[11px] uppercase">Today's Spend</span>
        <span class="text-headline-sm font-bold text-secondary text-[18px]" title="{totalCumulativeSpendMicrodollars} µ$">
          {formatMicrodollars(totalCumulativeSpendMicrodollars)}
        </span>
        <span class="text-outline text-[10px]">Fixed-Point (µ$)</span>
      </div>

      <!-- KPI 5: Quarantined Count -->
      <div class="p-2.5 rounded-lg bg-surface-container-lowest/60 border border-outline-variant/20 flex flex-col">
        <span class="text-outline text-[11px] uppercase">Quarantined</span>
        <span class="text-headline-sm font-bold {quarantinedCount > 0 ? 'text-error' : 'text-outline'} text-[18px]">
          {quarantinedCount}
        </span>
        <span class="text-outline text-[10px]">&lt;5ms DO Eviction</span>
      </div>

      <!-- KPI 6: Circuit Health -->
      <div class="p-2.5 rounded-lg bg-surface-container-lowest/60 border border-outline-variant/20 flex flex-col">
        <span class="text-outline text-[11px] uppercase">Circuit Overrides</span>
        <span class="text-headline-sm font-bold {trippedCircuitsCount > 0 || globalKillSwitchActive ? 'text-error' : 'text-secondary'} text-[18px]">
          {globalKillSwitchActive ? 'HALT (503)' : trippedCircuitsCount > 0 ? `${trippedCircuitsCount} TRIPPED` : 'ALL NORMAL'}
        </span>
        <span class="text-outline text-[10px]">Edge Fallback Cascading</span>
      </div>
    </div>
  </div>

  <!-- 2. Global Kill Switch Active Warning Banner (Top Level Priority) -->
  {#if globalKillSwitchActive}
    <div class="specular-card p-4 rounded-xl bg-error-container/30 border-2 border-error text-on-error-container flex flex-col sm:flex-row items-center justify-between gap-3 shadow-[0_0_24px_rgba(239,68,68,0.4)] animate-pulse">
      <div class="flex items-center gap-3">
        <span class="material-symbols-outlined text-error text-[28px]">emergency</span>
        <div>
          <h3 class="font-mono font-bold text-[15px] uppercase tracking-wide text-error">
            CRITICAL: Global Edge Proxy Kill Switch Engaged
          </h3>
          <p class="text-xs font-mono text-on-surface-variant">
            All edge isolates are returning HTTP 503 Service Unavailable. Upstream providers are completely shielded.
          </p>
        </div>
      </div>
      <button
        type="button"
        onclick={() => handleGlobalKillSwitch(false, 'Manual recovery via top banner')}
        class="px-4 py-1.5 rounded-lg bg-secondary text-charcoal font-mono font-bold text-xs uppercase transition-all hover:bg-secondary-fixed cursor-pointer shrink-0"
      >
        Disarm Kill Switch
      </button>
    </div>
  {/if}

  <!-- 3. Admin View Navigation Sub-Tabs Bar -->
  <div class="flex items-center justify-between border-b border-outline-variant/30 pb-2">
    <div class="flex items-center gap-2">
      <!-- Tab 1: Tenant Surveillance -->
      <button
        type="button"
        onclick={() => (adminTab = 'surveillance')}
        class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-mono text-label-md transition-all cursor-pointer {adminTab === 'surveillance' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
      >
        <span class="material-symbols-outlined text-[16px]">surveillance</span>
        <span>Tenant Surveillance</span>
        <span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-surface-container text-on-surface-variant">
          {tenants.length}
        </span>
      </button>

      <!-- Tab 3: Velocity Dials -->
      <button
        type="button"
        onclick={() => (adminTab = 'velocity')}
        class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-mono text-label-md transition-all cursor-pointer {adminTab === 'velocity' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
      >
        <span class="material-symbols-outlined text-[16px]">speed</span>
        <span>Velocity Dials</span>
      </button>

      <!-- Tab 4: Circuit Breakers -->
      <button
        type="button"
        onclick={() => (adminTab = 'circuits')}
        class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-mono text-label-md transition-all cursor-pointer {adminTab === 'circuits' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
      >
        <span class="material-symbols-outlined text-[16px]">flash_on</span>
        <span>Circuit Breakers</span>
        {#if trippedCircuitsCount > 0}
          <span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-error/20 text-error border border-error/40 animate-pulse">
            {trippedCircuitsCount}
          </span>
        {/if}
      </button>
    </div>

    <div class="hidden sm:flex items-center gap-2 text-xs font-mono text-outline">
      <span class="material-symbols-outlined text-[15px] text-secondary">verified_user</span>
      <span>AES-256-GCM Credential Vault Verified</span>
    </div>
  </div>

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
