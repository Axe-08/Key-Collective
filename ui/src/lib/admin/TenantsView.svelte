<script lang="ts">
  import type { TenantSurveillanceRow, AdminActionPayload } from '../../../../src/contracts/v3_5_types';
  import type { UserTier } from '../../../../src/contracts/v3_types';

  let {
    tenants = [],
    adminEmail = '',
    onAdminAction,
  }: {
    tenants?: TenantSurveillanceRow[];
    adminEmail?: string;
    onAdminAction?: (payload: AdminActionPayload) => void;
  } = $props();

  let searchQuery = $state('');
  let tierFilter = $state<string>('all');
  let quarantineFilter = $state<'all' | 'active' | 'quarantined'>('all');

  let resetModalTenant = $state<TenantSurveillanceRow | null>(null);
  let resetReason = $state('Administrative quota reset');

  let filteredTenants = $derived.by(() => {
    return tenants.filter((t) => {
      if (quarantineFilter === 'active' && t.isQuarantined) return false;
      if (quarantineFilter === 'quarantined' && !t.isQuarantined) return false;
      if (tierFilter !== 'all' && t.tier !== tierFilter) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        return (
          t.tenantId.toLowerCase().includes(q) ||
          t.email.toLowerCase().includes(q) ||
          t.tier.toLowerCase().includes(q)
        );
      }
      return true;
    });
  });

  function openResetModal(t: TenantSurveillanceRow) {
    resetModalTenant = t;
    resetReason = `Quota and communal debt reset for ${t.email}`;
  }

  function confirmReset() {
    if (!resetModalTenant || !onAdminAction) return;
    onAdminAction({
      adminEmail,
      targetTenantId: resetModalTenant.tenantId,
      action: 'RESET_QUOTA',
      reason: resetReason,
    });
    resetModalTenant = null;
  }
</script>

<div class="space-y-4" data-testid="admin-tenants-view">
  <!-- Controls & Search -->
  <div class="flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs">
    <div class="relative w-full sm:w-72">
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Filter tenants..."
        class="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-container-highest/60 border border-outline-variant/30 text-on-surface focus:outline-none focus:border-primary text-xs"
      />
      <span class="material-symbols-outlined absolute left-2.5 top-2 text-[14px] text-outline">search</span>
    </div>

    <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
      <select
        bind:value={tierFilter}
        class="px-2.5 py-1.5 rounded-lg bg-surface-container-highest/60 border border-outline-variant/30 text-on-surface text-xs"
      >
        <option value="all">All Tiers</option>
        <option value="admin">Admin</option>
        <option value="ultra">Ultra</option>
        <option value="max">Max</option>
        <option value="builder">Builder</option>
        <option value="probationary">Probationary</option>
        <option value="demo">Demo</option>
      </select>

      <select
        bind:value={quarantineFilter}
        class="px-2.5 py-1.5 rounded-lg bg-surface-container-highest/60 border border-outline-variant/30 text-on-surface text-xs"
      >
        <option value="all">All Status</option>
        <option value="active">Active</option>
        <option value="quarantined">Quarantined</option>
      </select>
    </div>
  </div>

  <!-- Tenants Table -->
  <div class="rounded-xl border border-outline-variant/30 overflow-hidden bg-surface-container-low/70">
    <table class="w-full text-left font-mono text-xs">
      <thead class="bg-surface-container-highest/40 text-outline border-b border-outline-variant/20">
        <tr>
          <th class="py-2.5 px-3 font-medium">Tenant ID</th>
          <th class="py-2.5 px-3 font-medium">Email</th>
          <th class="py-2.5 px-3 font-medium">Tier</th>
          <th class="py-2.5 px-3 font-medium">RPM Limit</th>
          <th class="py-2.5 px-3 font-medium">Debt CU</th>
          <th class="py-2.5 px-3 font-medium">Today Spend CU</th>
          <th class="py-2.5 px-3 font-medium">Status</th>
          <th class="py-2.5 px-3 font-medium text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/10">
        {#if filteredTenants.length === 0}
          <tr>
            <td colspan="8" class="py-8 text-center text-outline">
              No tenants matching current filters.
            </td>
          </tr>
        {:else}
          {#each filteredTenants as t (t.tenantId)}
            <tr class="hover:bg-surface-container-highest/30 transition-colors">
              <td class="py-2.5 px-3 text-on-surface font-semibold truncate max-w-[140px]">{t.tenantId}</td>
              <td class="py-2.5 px-3 text-outline truncate max-w-[160px]">{t.email}</td>
              <td class="py-2.5 px-3">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-primary/10 text-primary border border-primary/20">
                  {t.tier}
                </span>
              </td>
              <td class="py-2.5 px-3 text-on-surface">{t.rpmLimit === Infinity ? '∞' : t.rpmLimit}</td>
              <td class="py-2.5 px-3 {t.communityDebtCu > 0 ? 'text-amber-400 font-semibold' : 'text-outline'}">
                {t.communityDebtCu.toLocaleString()} CU
              </td>
              <td class="py-2.5 px-3 text-on-surface">{t.todaySpendCu.toLocaleString()} CU</td>
              <td class="py-2.5 px-3">
                {#if t.isQuarantined}
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-error/15 text-error border border-error/30">
                    Quarantined
                  </span>
                {:else}
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-secondary/15 text-secondary border border-secondary/30">
                    Active
                  </span>
                {/if}
              </td>
              <td class="py-2.5 px-3 text-right">
                <button
                  type="button"
                  onclick={() => openResetModal(t)}
                  class="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[10px] font-semibold cursor-pointer transition-colors"
                  title="Reset Quota & Debt"
                >
                  Reset Quota
                </button>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <!-- Reset Quota Confirmation Modal -->
  {#if resetModalTenant}
    <div class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-surface-container rounded-xl border border-outline-variant/40 p-5 max-w-md w-full space-y-4 font-mono">
        <div class="flex items-center gap-2 text-amber-400 text-sm font-semibold">
          <span class="material-symbols-outlined text-[18px]">restart_alt</span>
          <span>Confirm Quota & Debt Reset</span>
        </div>

        <p class="text-xs text-outline leading-relaxed">
          Resetting sliding window rate limit counters and clearing communal debt for tenant:
          <strong class="text-on-surface">{resetModalTenant.email}</strong> (<span class="text-primary">{resetModalTenant.tenantId}</span>).
        </p>

        <div class="space-y-1">
          <label for="reset-reason-input" class="text-[11px] text-outline">Audit Reason</label>
          <input
            id="reset-reason-input"
            type="text"
            bind:value={resetReason}
            class="w-full px-3 py-1.5 rounded bg-surface-container-highest/80 border border-outline-variant/30 text-xs text-on-surface focus:outline-none focus:border-amber-400"
          />
        </div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant/20">
          <button
            type="button"
            onclick={() => (resetModalTenant = null)}
            class="px-3 py-1.5 rounded text-xs text-outline hover:text-on-surface hover:bg-surface-container-high cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={confirmReset}
            class="px-3 py-1.5 rounded text-xs bg-amber-500 text-on-primary font-semibold hover:bg-amber-600 cursor-pointer transition-colors"
          >
            Confirm Reset
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
