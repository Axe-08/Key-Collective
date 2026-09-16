<script lang="ts">
  import type { TenantSurveillanceRow } from '../../../../../src/contracts/v3_5_types';
  import { formatMicrodollars } from '../../types';
  import { isAnomaly, getTierBadgeClass, getAuthProviderIcon, formatRelativeTime } from './helpers';

  interface ExtendedTenantRow extends TenantSurveillanceRow {
    communityDebtMicroCu?: number;
    community_debt_micro_cu?: number;
    keys?: Array<{
      id: string;
      tenant_id?: string;
      label: string;
      provider: string;
      key_prefix: string;
      key_suffix: string;
      rpm_limit: number;
      rpd_limit: number;
      priority: number;
      status: string;
      pool_type: 'PRIVATE' | 'COMMUNITY' | null;
      community_routing_status: 'OBSERVATION' | 'ACTIVE' | 'QUARANTINED' | 'REVOKED' | null;
      observation_until: string | null;
      dispatched_today: number | null;
      dispatched_communal: number | null;
      created_at: string;
    }>;
  }

  let {
    filteredTenants,
    onOpenTierModal,
    onOpenResetModal,
    onOpenQuarantineModal,
    onUpdateKeyRoutingStatus,
    onUpdateKeyPoolMode,
    onDeleteKey,
  }: {
    filteredTenants: ExtendedTenantRow[];
    onOpenTierModal: (tenant: ExtendedTenantRow) => void;
    onOpenResetModal: (tenant: ExtendedTenantRow) => void;
    onOpenQuarantineModal: (tenant: ExtendedTenantRow) => void;
    onUpdateKeyRoutingStatus?: (keyId: string, status: 'ACTIVE' | 'QUARANTINED' | 'OBSERVATION') => void;
    onUpdateKeyPoolMode?: (keyId: string, poolType: 'COMMUNITY' | 'PRIVATE') => void;
    onDeleteKey?: (keyId: string) => void;
  } = $props();

  let expandedTenantIds = $state<string[]>([]);

  function toggleExpand(tenantId: string) {
    if (expandedTenantIds.includes(tenantId)) {
      expandedTenantIds = expandedTenantIds.filter((id) => id !== tenantId);
    } else {
      expandedTenantIds = [...expandedTenantIds, tenantId];
    }
  }

  function formatDebt(debtMicroCu?: number): string {
    const val = debtMicroCu ?? 0;
    if (val === 0) return '0 µCU';
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)} CU`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(1)} mCU`;
    return `${val} µCU`;
  }
</script>

<div class="specular-card rounded-xl bg-surface-container-low/90 backdrop-blur-md border border-outline-variant/30 overflow-hidden shadow-xl">
  <div class="overflow-x-auto custom-scrollbar">
    <table class="w-full text-left border-collapse">
      <thead>
        <tr class="border-b border-outline-variant/30 bg-surface-container/60 text-outline text-[11px] uppercase tracking-wider font-mono">
          <th class="py-3 px-3 w-8"></th>
          <th class="py-3 px-4">Tenant ID / Account</th>
          <th class="py-3 px-3">Auth</th>
          <th class="py-3 px-3">Tier</th>
          <th class="py-3 px-4 min-w-[170px]">RPM Velocity / Limit</th>
          <th class="py-3 px-3">Today Spend</th>
          <th class="py-3 px-3">Communal Debt</th>
          <th class="py-3 px-3 text-center">Keys</th>
          <th class="py-3 px-3">Status</th>
          <th class="py-3 px-3">Last Active</th>
          <th class="py-3 px-4 text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/20 text-[12px] font-mono">
        {#if filteredTenants.length === 0}
          <tr>
            <td colspan="11" class="py-12 text-center text-outline text-body-sm font-sans">
              <div class="flex flex-col items-center justify-center gap-2">
                <span class="material-symbols-outlined text-outline text-[32px]">group_off</span>
                <span>No registered tenants currently in D1 database.</span>
                <span class="text-xs text-outline/60">Registered users who log in or submit provider keys will appear here live.</span>
              </div>
            </td>
          </tr>
        {:else}
          {#each filteredTenants as t}
            {@const nearCap = isAnomaly(t)}
            {@const rpmSat = t.rpmLimit === Infinity ? 0 : Math.min(100, Math.round((t.currentRpm / t.rpmLimit) * 100))}
            {@const isExpanded = expandedTenantIds.includes(t.tenantId)}
            {@const debt = t.communityDebtMicroCu ?? t.community_debt_micro_cu ?? 0}
            {@const tenantKeys = t.keys ?? []}

            <tr class="hover:bg-surface-container/40 transition-colors {t.isQuarantined ? 'bg-error-container/5' : ''}">
              <!-- Expand / Collapse Dropdown Chevron -->
              <td class="py-3 px-3 text-center">
                <button
                  type="button"
                  onclick={() => toggleExpand(t.tenantId)}
                  class="p-1 rounded hover:bg-surface-container-highest text-outline hover:text-on-surface transition-transform duration-200 cursor-pointer"
                  title={isExpanded ? 'Collapse keys' : 'Expand keys for this tenant'}
                  aria-label={isExpanded ? 'Collapse keys' : 'Expand keys'}
                >
                  <span class="material-symbols-outlined text-[18px] transition-transform duration-200 {isExpanded ? 'rotate-90 text-primary' : ''}">
                    chevron_right
                  </span>
                </button>
              </td>

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

              <!-- Community Debt Micro-CU -->
              <td class="py-3 px-3">
                {#if debt > 0}
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    ⚠️ {formatDebt(debt)}
                  </span>
                {:else}
                  <span class="text-outline text-[11px]">0 µCU</span>
                {/if}
              </td>

              <!-- Active Keys Count -->
              <td class="py-3 px-3 text-center">
                <button
                  type="button"
                  onclick={() => toggleExpand(t.tenantId)}
                  class="px-2 py-0.5 rounded bg-surface-container hover:bg-primary/20 hover:text-primary transition-colors cursor-pointer text-on-surface-variant text-[11px]"
                  title="Click to view tenant keys"
                >
                  {tenantKeys.length} keys
                </button>
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
                    onclick={() => onOpenTierModal(t)}
                    class="p-1.5 rounded bg-surface-container hover:bg-primary/20 text-outline hover:text-primary transition-colors cursor-pointer"
                    title="Promote or Override Tenant Tier"
                  >
                    <span class="material-symbols-outlined text-[16px]">manage_accounts</span>
                  </button>

                  <!-- Reset Quota -->
                  <button
                    type="button"
                    onclick={() => onOpenResetModal(t)}
                    class="p-1.5 rounded bg-surface-container hover:bg-surface-container-highest text-outline hover:text-on-surface transition-colors cursor-pointer"
                    title="Reset Quota Counters"
                  >
                    <span class="material-symbols-outlined text-[16px]">restart_alt</span>
                  </button>

                  <!-- Ban Hammer (Quarantine / Unquarantine) -->
                  <button
                    type="button"
                    onclick={() => onOpenQuarantineModal(t)}
                    class="p-1.5 rounded transition-colors cursor-pointer {t.isQuarantined ? 'bg-secondary/20 hover:bg-secondary/30 text-secondary' : 'bg-error/15 hover:bg-error/30 text-error'}"
                    title={t.isQuarantined ? 'Lift Quarantine (Re-admit Tenant)' : 'Abuse Quarantine (Evict Tenant)'}
                  >
                    <span class="material-symbols-outlined text-[16px]">
                      {t.isQuarantined ? 'lock_open' : 'gavel'}
                    </span>
                  </button>
                </div>
              </td>
            </tr>

            <!-- Expanded Row: Contributed Keys Table -->
            {#if isExpanded}
              <tr class="bg-surface-container-lowest/70 border-y border-outline-variant/30">
                <td colspan="11" class="p-4 sm:p-5">
                  <div class="rounded-xl border border-outline-variant/30 bg-surface-container-low p-4 space-y-3 shadow-inner">
                    <div class="flex items-center justify-between gap-3">
                      <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-primary text-[18px]">vpn_key</span>
                        <h4 class="font-headline-sm text-sm font-semibold text-on-surface">
                          Contributed Keys for <span class="font-mono text-primary">{t.tenantId}</span>
                        </h4>
                        <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-surface-container text-outline">
                          {tenantKeys.length} total
                        </span>
                      </div>
                      <span class="text-xs text-outline italic">
                        Raw API secrets encrypted at rest (AES-256-GCM) — zero plaintext exposed.
                      </span>
                    </div>

                    {#if tenantKeys.length === 0}
                      <div class="p-6 text-center text-outline text-xs border border-dashed border-outline-variant/30 rounded-lg">
                        This tenant has not added any API provider keys yet.
                      </div>
                    {:else}
                      <div class="overflow-x-auto rounded-lg border border-outline-variant/20 custom-scrollbar">
                        <table class="w-full text-left border-collapse text-[11px] font-mono">
                          <thead class="bg-surface-container text-outline uppercase text-[10px] tracking-wider">
                            <tr class="border-b border-outline-variant/30">
                              <th class="p-2.5">Provider</th>
                              <th class="p-2.5">Label</th>
                              <th class="p-2.5">Key Mask</th>
                              <th class="p-2.5">Pool Mode</th>
                              <th class="p-2.5">Routing Status</th>
                              <th class="p-2.5">Rate Limits</th>
                              <th class="p-2.5">Dispatched</th>
                              <th class="p-2.5 text-right">Admin Key Actions</th>
                            </tr>
                          </thead>
                          <tbody class="divide-y divide-outline-variant/15">
                            {#each tenantKeys as k}
                              <tr class="hover:bg-surface-container/30 transition-colors">
                                <!-- Provider -->
                                <td class="p-2.5 capitalize font-semibold text-on-surface">{k.provider}</td>

                                <!-- Label -->
                                <td class="p-2.5 text-on-surface-variant truncate max-w-[150px]" title={k.label}>{k.label}</td>

                                <!-- Key Mask (zero plaintext) -->
                                <td class="p-2.5 font-code-sm text-outline">
                                  {k.key_prefix}...{k.key_suffix}
                                </td>

                                <!-- Pool Type -->
                                <td class="p-2.5">
                                  <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase border {k.pool_type === 'COMMUNITY' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-secondary/10 text-secondary border-secondary/20'}">
                                    {k.pool_type || 'COMMUNITY'}
                                  </span>
                                </td>

                                <!-- Community Routing Status -->
                                <td class="p-2.5">
                                  {#if k.community_routing_status === 'ACTIVE'}
                                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-secondary/15 text-secondary border border-secondary/30">
                                      ACTIVE IN POOL
                                    </span>
                                  {:else if k.community_routing_status === 'OBSERVATION'}
                                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30" title="In 24h observation window">
                                      OBSERVATION
                                    </span>
                                  {:else if k.community_routing_status === 'QUARANTINED'}
                                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-error/20 text-error border border-error/40 animate-pulse">
                                      QUARANTINED
                                    </span>
                                  {:else}
                                    <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-surface-container text-outline">
                                      {k.status}
                                    </span>
                                  {/if}
                                </td>

                                <!-- RPM / RPD -->
                                <td class="p-2.5 text-outline">
                                  {k.rpm_limit} RPM · {k.rpd_limit} RPD
                                </td>

                                <!-- Dispatched count -->
                                <td class="p-2.5 text-outline">
                                  {k.dispatched_today || 0} reqs
                                  {#if k.dispatched_communal}
                                    <span class="text-primary text-[10px]">({k.dispatched_communal} communal)</span>
                                  {/if}
                                </td>

                                <!-- Key Manipulation Actions -->
                                <td class="p-2.5 text-right whitespace-nowrap">
                                  <div class="inline-flex items-center gap-1.5">
                                    <!-- 1-Click Approve / Activate (Bypass 24h Observation or Lift Quarantine) -->
                                    {#if k.community_routing_status === 'OBSERVATION' || k.community_routing_status === 'QUARANTINED'}
                                      <button
                                        type="button"
                                        onclick={() => onUpdateKeyRoutingStatus?.(k.id, 'ACTIVE')}
                                        class="px-2 py-1 rounded bg-secondary/15 hover:bg-secondary/25 text-secondary text-[11px] font-semibold flex items-center gap-1 border border-secondary/30 cursor-pointer transition-colors"
                                        title="Immediately activate key into pool without 24h observation"
                                      >
                                        <span class="material-symbols-outlined text-[14px]">check_circle</span>
                                        <span>Approve &amp; Activate</span>
                                      </button>
                                    {:else if k.community_routing_status === 'ACTIVE'}
                                      <!-- Quarantine Key -->
                                      <button
                                        type="button"
                                        onclick={() => onUpdateKeyRoutingStatus?.(k.id, 'QUARANTINED')}
                                        class="px-2 py-1 rounded bg-error/15 hover:bg-error/25 text-error text-[11px] font-semibold flex items-center gap-1 border border-error/30 cursor-pointer transition-colors"
                                        title="Quarantine key from routing pool"
                                      >
                                        <span class="material-symbols-outlined text-[14px]">block</span>
                                        <span>Quarantine</span>
                                      </button>
                                    {/if}

                                    <!-- Switch Pool Mode (COMMUNITY <-> PRIVATE) -->
                                    <button
                                      type="button"
                                      onclick={() => onUpdateKeyPoolMode?.(k.id, k.pool_type === 'COMMUNITY' ? 'PRIVATE' : 'COMMUNITY')}
                                      class="px-2 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-outline hover:text-on-surface text-[11px] border border-outline-variant/30 cursor-pointer transition-colors"
                                      title="Switch key between Community and Private pool"
                                    >
                                      {k.pool_type === 'COMMUNITY' ? 'To Private' : 'To Community'}
                                    </button>

                                    <!-- Delete Key -->
                                    <button
                                      type="button"
                                      onclick={() => onDeleteKey?.(k.id)}
                                      class="p-1 rounded bg-surface-container hover:bg-error/20 text-outline hover:text-error transition-colors cursor-pointer"
                                      title="Delete key from pool"
                                    >
                                      <span class="material-symbols-outlined text-[15px]">delete</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                      </div>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

