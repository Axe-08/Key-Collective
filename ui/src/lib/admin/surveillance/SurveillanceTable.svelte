<script lang="ts">
  import type { TenantSurveillanceRow } from '../../../../../src/contracts/v3_5_types';
  import { formatMicrodollars } from '../../types';
  import { isAnomaly, getTierBadgeClass, getAuthProviderIcon, formatRelativeTime } from './helpers';

  let {
    filteredTenants,
    onOpenTierModal,
    onOpenResetModal,
    onOpenQuarantineModal,
  }: {
    filteredTenants: TenantSurveillanceRow[];
    onOpenTierModal: (tenant: TenantSurveillanceRow) => void;
    onOpenResetModal: (tenant: TenantSurveillanceRow) => void;
    onOpenQuarantineModal: (tenant: TenantSurveillanceRow) => void;
  } = $props();
</script>

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
                    onclick={() => onOpenTierModal(t)}
                    class="p-1.5 rounded bg-surface-container hover:bg-primary/20 text-outline hover:text-primary transition-colors cursor-pointer"
                    title="Override Tenant Tier"
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
