<script lang="ts">
  import { formatMicrodollars } from '../types';

  let {
    edgeHost = 'admin.key-col.axe08.tech',
    adminEmail = 'admin@keycollective.io',
    activeTenantsCount,
    anomalyCount,
    totalClusterRpm,
    totalCumulativeSpendMicrodollars,
    quarantinedCount,
    trippedCircuitsCount,
    globalKillSwitchActive,
    onNavigate,
  }: {
    edgeHost?: string;
    adminEmail?: string;
    activeTenantsCount: number;
    anomalyCount: number;
    totalClusterRpm: number;
    totalCumulativeSpendMicrodollars: number;
    quarantinedCount: number;
    trippedCircuitsCount: number;
    globalKillSwitchActive: boolean;
    onNavigate?: (tab: string) => void;
  } = $props();
</script>

<!-- Top Admin Subdomain & Security Header Banner -->
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
