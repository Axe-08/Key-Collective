<script lang="ts">
  import type { ProviderCircuitOverridePayload } from '../../../../src/contracts/v3_5_types';

  export type ProviderKey = 'gemini' | 'groq' | 'cerebras' | 'deepseek';

  export interface CircuitState {
    readonly state: 'NORMAL' | 'TRIPPED';
    readonly failureCount: number;
    readonly failureThreshold: number;
    readonly lastTrippedAt: number | null;
    readonly reason?: string;
    readonly avgLatencyMs: number;
  }

  export interface AuditLogEntry {
    readonly id: string;
    readonly timestamp: number;
    readonly adminEmail: string;
    readonly action: string;
    readonly target: string;
    readonly reason: string;
    readonly syncDurationMs: number;
  }

  let {
    globalKillSwitchActive = false,
    adminEmail = 'admin@keycollective.io',
    circuits = {
      gemini: {
        state: 'NORMAL',
        failureCount: 0,
        failureThreshold: 5,
        lastTrippedAt: null,
        avgLatencyMs: 242,
      },
      groq: {
        state: 'NORMAL',
        failureCount: 0,
        failureThreshold: 5,
        lastTrippedAt: null,
        avgLatencyMs: 118,
      },
      cerebras: {
        state: 'NORMAL',
        failureCount: 0,
        failureThreshold: 5,
        lastTrippedAt: null,
        avgLatencyMs: 82,
      },
      deepseek: {
        state: 'NORMAL',
        failureCount: 1,
        failureThreshold: 5,
        lastTrippedAt: null,
        avgLatencyMs: 380,
      },
    },
    auditLogs = [
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
        action: 'CIRCUIT_OVERRIDE',
        target: 'gemini',
        reason: 'Pre-flight circuit reset verified',
        syncDurationMs: 2.1,
      },
    ],
    onCircuitOverride,
    onGlobalKillSwitch,
  }: {
    globalKillSwitchActive?: boolean;
    adminEmail?: string;
    circuits?: Record<ProviderKey, CircuitState>;
    auditLogs?: AuditLogEntry[];
    onCircuitOverride?: (payload: ProviderCircuitOverridePayload) => void;
    onGlobalKillSwitch?: (active: boolean, reason: string) => void;
  } = $props();

  let isKillModalOpen = $state(false);
  let killSwitchReason = $state('Emergency upstream maintenance');

  let selectedProviderForModal = $state<ProviderKey | null>(null);
  let overrideModalState = $state<'TRIPPED' | 'NORMAL'>('TRIPPED');
  let overrideReason = $state('Provider upstream degradation');

  const providerNames: Record<ProviderKey, string> = {
    gemini: 'Google Gemini Flash',
    groq: 'Groq LLaMA 3.3',
    cerebras: 'Cerebras Ultra-Fast',
    deepseek: 'DeepSeek Reasoner',
  };

  function handleOpenProviderModal(provider: ProviderKey, targetState: 'TRIPPED' | 'NORMAL') {
    selectedProviderForModal = provider;
    overrideModalState = targetState;
    overrideReason = targetState === 'TRIPPED'
      ? 'Manual override: Upstream rate limits / 504 timeouts'
      : 'Manual recovery: Upstream health restored';
  }

  function handleConfirmProviderOverride() {
    if (!selectedProviderForModal) return;
    const payload: ProviderCircuitOverridePayload = {
      adminEmail,
      provider: selectedProviderForModal,
      state: overrideModalState,
      reason: overrideReason || 'Manual administrator override',
    };
    if (onCircuitOverride) {
      onCircuitOverride(payload);
    }
    selectedProviderForModal = null;
  }

  function handleConfirmKillSwitch() {
    const nextState = !globalKillSwitchActive;
    if (onGlobalKillSwitch) {
      onGlobalKillSwitch(nextState, killSwitchReason || 'Global emergency kill switch toggle');
    }
    isKillModalOpen = false;
  }
</script>

<div class="space-y-6">
  <!-- Section Title -->
  <div class="flex items-center justify-between">
    <div class="space-y-0.5">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-amber-400 text-[20px]" data-icon="flash_on">flash_on</span>
        <h2 class="text-headline-sm font-headline-sm font-semibold text-on-surface">Circuit Breakers &amp; Emergency Controls</h2>
      </div>
      <p class="text-body-sm font-body-sm text-on-surface-variant">
        Real-time Durable Object circuit breaker state. Manual overrides immediately bypass failing upstreams and cascade traffic.
      </p>
    </div>
    <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-high border border-outline-variant/30 text-label-sm font-mono text-outline">
      <span class="material-symbols-outlined text-[15px] text-amber-400">shield</span>
      <span>DO Isolated Memory</span>
    </div>
  </div>

  <!-- Global Kill Switch Banner (Specular Alert Card) -->
  <div class="specular-card rounded-xl p-5 border {globalKillSwitchActive ? 'bg-error-container/20 border-error/50 shadow-[0_0_24px_rgba(239,68,68,0.3)]' : 'bg-surface-container-low/90 border-outline-variant/30'}">
    <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div class="flex items-start gap-3.5">
        <div class="w-10 h-10 rounded-lg flex items-center justify-center {globalKillSwitchActive ? 'bg-error/20 text-error border border-error/40 animate-pulse' : 'bg-surface-container-highest text-outline-variant border border-outline-variant/30'}">
          <span class="material-symbols-outlined text-[24px]" data-icon="emergency_home">emergency_home</span>
        </div>
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="text-headline-sm font-headline-sm font-semibold text-on-surface text-[15px]">Global Edge Proxy Kill Switch</span>
            {#if globalKillSwitchActive}
              <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-error text-on-error uppercase animate-pulse">
                KILL SWITCH ACTIVE (HTTP 503)
              </span>
            {:else}
              <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-container-high text-secondary border border-secondary/30 uppercase font-semibold">
                Standby (Routing Normal)
              </span>
            {/if}
          </div>
          <p class="text-body-sm font-body-sm text-on-surface-variant text-[12px] max-w-2xl">
            When triggered, all edge isolates return <code class="font-mono text-error font-semibold">503 Service Unavailable</code> immediately without calling any upstream provider. Zero key pool quota is consumed.
          </p>
        </div>
      </div>

      <button
        type="button"
        onclick={() => (isKillModalOpen = true)}
        class="px-4 py-2 rounded-lg font-mono text-label-md font-bold uppercase transition-all active:scale-[0.98] cursor-pointer shrink-0 {globalKillSwitchActive ? 'bg-secondary text-charcoal hover:bg-secondary-fixed shadow-[0_0_12px_rgba(78,222,163,0.4)]' : 'bg-error text-on-error hover:bg-error-container shadow-[0_0_16px_rgba(239,68,68,0.35)]'}"
      >
        {globalKillSwitchActive ? 'Disarm & Restore Proxy' : 'Trigger Global Kill Switch'}
      </button>
    </div>
  </div>

  <!-- 4 Per-Provider Circuit Breaker Cards Grid -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    {#each (Object.keys(circuits) as ProviderKey[]) as provKey}
      {@const prov = circuits[provKey]}
      {@const isTripped = prov.state === 'TRIPPED'}
      <div class="specular-card rounded-xl bg-surface-container-low/90 backdrop-blur-md p-4 flex flex-col justify-between gap-3 border transition-all {isTripped ? 'border-error/50 bg-error-container/10 shadow-[0_0_16px_rgba(239,68,68,0.2)]' : 'border-outline-variant/30 hover:border-outline-variant/50'}">
        <!-- Card Header -->
        <div class="flex items-start justify-between">
          <div class="space-y-0.5">
            <div class="flex items-center gap-1.5">
              <span class="font-semibold text-on-surface text-[14px]">{providerNames[provKey]}</span>
            </div>
            <span class="font-mono text-[10px] text-outline uppercase tracking-wider">
              {provKey} upstream
            </span>
          </div>

          <!-- Status Badge -->
          <div class="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase {isTripped ? 'bg-error/20 text-error border border-error/40' : 'bg-secondary/10 text-secondary border border-secondary/30'}">
            <span class="w-1.5 h-1.5 rounded-full {isTripped ? 'bg-error animate-ping' : 'bg-secondary'}"></span>
            <span>{prov.state}</span>
          </div>
        </div>

        <!-- Telemetry Details -->
        <div class="space-y-2 py-1 text-[11px] font-mono text-on-surface-variant border-y border-outline-variant/20">
          <div class="flex justify-between">
            <span>Failure Count</span>
            <span class="font-bold {prov.failureCount > 0 ? 'text-amber-400' : 'text-on-surface'}">
              {prov.failureCount} / {prov.failureThreshold} max
            </span>
          </div>
          <div class="flex justify-between">
            <span>Avg Latency</span>
            <span class="text-cyan-300 font-semibold">{prov.avgLatencyMs}ms</span>
          </div>
          {#if isTripped && prov.reason}
            <div class="text-[10px] text-error truncate" title={prov.reason}>
              Note: {prov.reason}
            </div>
          {/if}
        </div>

        <!-- Action Button -->
        {#if isTripped}
          <button
            type="button"
            onclick={() => handleOpenProviderModal(provKey, 'NORMAL')}
            class="w-full py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-secondary border border-secondary/30 text-label-sm font-mono font-semibold transition-colors active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5"
          >
            <span class="material-symbols-outlined text-[15px]">restart_alt</span>
            <span>Reset to Normal</span>
          </button>
        {:else}
          <button
            type="button"
            onclick={() => handleOpenProviderModal(provKey, 'TRIPPED')}
            class="w-full py-1.5 rounded-lg bg-surface-container-high hover:bg-error/20 text-on-surface hover:text-error border border-outline-variant/30 hover:border-error/40 text-label-sm font-mono font-medium transition-colors active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5"
          >
            <span class="material-symbols-outlined text-[15px]">power_off</span>
            <span>Trip Circuit Override</span>
          </button>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Live Operations Audit Trail -->
  <div class="specular-card rounded-xl bg-surface-container-low/90 backdrop-blur-md p-5 space-y-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-primary text-[19px]" data-icon="history_edu">history_edu</span>
        <h3 class="text-headline-sm font-headline-sm font-semibold text-on-surface text-[15px]">Administrative Circuit &amp; Security Audit Trail</h3>
      </div>
      <span class="text-label-sm font-mono text-outline">
        {auditLogs.length} Total Events Logged
      </span>
    </div>

    <!-- Audit Table / Stream -->
    <div class="rounded-lg border border-outline-variant/30 bg-surface-container-lowest/80 overflow-hidden">
      <div class="overflow-x-auto custom-scrollbar">
        <table class="w-full text-left text-code-sm font-code-sm border-collapse">
          <thead>
            <tr class="border-b border-outline-variant/30 bg-surface-container/60 text-outline text-[11px] uppercase tracking-wider font-mono">
              <th class="py-2.5 px-3">Timestamp</th>
              <th class="py-2.5 px-3">Operator</th>
              <th class="py-2.5 px-3">Action</th>
              <th class="py-2.5 px-3">Target</th>
              <th class="py-2.5 px-3">Reason / Context</th>
              <th class="py-2.5 px-3 text-right">Sync SLA</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-outline-variant/20 text-[12px] font-mono">
            {#each auditLogs as log}
              <tr class="hover:bg-surface-container/30 transition-colors">
                <td class="py-2 px-3 text-outline whitespace-nowrap">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </td>
                <td class="py-2 px-3 text-on-surface truncate max-w-[160px]">
                  {log.adminEmail}
                </td>
                <td class="py-2 px-3">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase {log.action.includes('KILL') || log.action.includes('QUARANTINE') ? 'bg-error/15 text-error border border-error/30' : 'bg-primary/10 text-primary border border-primary/30'}">
                    {log.action}
                  </span>
                </td>
                <td class="py-2 px-3 text-secondary font-semibold">
                  {log.target}
                </td>
                <td class="py-2 px-3 text-on-surface-variant max-w-xs truncate" title={log.reason}>
                  {log.reason}
                </td>
                <td class="py-2 px-3 text-right text-secondary whitespace-nowrap">
                  {log.syncDurationMs}ms DO
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<!-- Provider Override Confirmation Modal -->
{#if selectedProviderForModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
    <div class="specular-card w-full max-w-md rounded-xl bg-surface-container-high p-6 space-y-4 border border-outline-variant/40 shadow-2xl">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-on-surface font-semibold text-[16px]">
          <span class="material-symbols-outlined {overrideModalState === 'TRIPPED' ? 'text-error' : 'text-secondary'}">
            {overrideModalState === 'TRIPPED' ? 'power_off' : 'restart_alt'}
          </span>
          <span>{overrideModalState === 'TRIPPED' ? 'Trip Circuit Override' : 'Reset Circuit to Normal'}</span>
        </div>
        <button
          type="button"
          onclick={() => (selectedProviderForModal = null)}
          class="text-outline hover:text-on-surface p-1 rounded transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <p class="text-body-sm font-body-sm text-on-surface-variant text-[13px]">
        You are applying a manual override for <strong class="text-on-surface">{providerNames[selectedProviderForModal]}</strong>. The proxy will immediately {overrideModalState === 'TRIPPED' ? 'halt sending requests to this upstream and cascade to the next healthy provider' : 'resume sending requests to this upstream'}.
      </p>

      <div class="space-y-1.5">
        <label for="override-reason-input" class="text-label-sm font-mono text-outline uppercase">Audit Reason Note (Required)</label>
        <input
          id="override-reason-input"
          bind:value={overrideReason}
          type="text"
          placeholder="Enter reason for audit trail..."
          class="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/40 text-code-sm font-mono text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
        />
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onclick={() => (selectedProviderForModal = null)}
          class="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface-variant hover:text-on-surface text-label-md font-mono transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handleConfirmProviderOverride}
          class="px-4 py-1.5 rounded-lg text-label-md font-mono font-bold uppercase transition-all cursor-pointer {overrideModalState === 'TRIPPED' ? 'bg-error text-on-error hover:bg-error-container' : 'bg-secondary text-charcoal hover:bg-secondary-fixed'}"
        >
          Confirm Override
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Global Kill Switch Confirmation Modal -->
{#if isKillModalOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
    <div class="specular-card w-full max-w-lg rounded-xl bg-surface-container-high p-6 space-y-5 border border-error/50 shadow-2xl">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-lg bg-error/20 text-error border border-error/40 flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-[24px]">warning</span>
        </div>
        <div class="space-y-1">
          <h3 class="text-headline-sm font-headline-sm font-semibold text-on-surface text-[17px]">
            {globalKillSwitchActive ? 'Disarm Global Kill Switch?' : 'CONFIRM GLOBAL EMERGENCY KILL SWITCH'}
          </h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant text-[13px]">
            {globalKillSwitchActive
              ? 'Disarming will restore edge proxy routing across all providers. Upstream traffic will resume.'
              : 'CRITICAL ACTION: This will instantly cause ALL edge isolates to respond with HTTP 503 to all client requests edge-wide. Outbound requests to Gemini, Groq, Cerebras, and DeepSeek will be completely blocked.'}
          </p>
        </div>
      </div>

      <div class="space-y-1.5">
        <label for="kill-switch-reason-input" class="text-label-sm font-mono text-outline uppercase">Emergency Reason (Recorded in Immutable Audit Log)</label>
        <input
          id="kill-switch-reason-input"
          bind:value={killSwitchReason}
          type="text"
          placeholder="Reason for emergency kill switch..."
          class="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/40 text-code-sm font-mono text-on-surface placeholder:text-outline focus:outline-none focus:border-error"
        />
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onclick={() => (isKillModalOpen = false)}
          class="px-3.5 py-2 rounded-lg bg-surface-container text-on-surface-variant hover:text-on-surface text-label-md font-mono transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handleConfirmKillSwitch}
          class="px-5 py-2 rounded-lg text-label-md font-mono font-bold uppercase transition-all cursor-pointer {globalKillSwitchActive ? 'bg-secondary text-charcoal hover:bg-secondary-fixed' : 'bg-error text-on-error hover:bg-error-container shadow-[0_0_16px_rgba(239,68,68,0.5)]'}"
        >
          {globalKillSwitchActive ? 'Confirm Disarm' : 'EXECUTE EMERGENCY HALT'}
        </button>
      </div>
    </div>
  </div>
{/if}
