<script lang="ts">
  import type { TenantSurveillanceRow } from '../../../../../src/contracts/v3_5_types';
  import type { UserTier } from '../../../../../src/contracts/v3_types';

  let {
    targetTenant,
    actionModalType,
    selectedNewTier = $bindable(),
    actionReason = $bindable(),
    onClose,
    onConfirm,
  }: {
    targetTenant: TenantSurveillanceRow | null;
    actionModalType: 'tier' | 'quarantine' | 'reset' | null;
    selectedNewTier: UserTier;
    actionReason: string;
    onClose: () => void;
    onConfirm: () => void;
  } = $props();
</script>

<!-- Modal: Tier Override -->
{#if actionModalType === 'tier' && targetTenant}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
    <div class="specular-card w-full max-w-md rounded-xl bg-surface-container-high p-6 space-y-4 border border-outline-variant/40 shadow-2xl">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-on-surface font-semibold text-[16px]">
          <span class="material-symbols-outlined text-primary">manage_accounts</span>
          <span>Assign Tenant Tier Override</span>
        </div>
        <button
          type="button"
          onclick={onClose}
          class="text-outline hover:text-on-surface p-1 rounded transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <p class="text-body-sm font-body-sm text-on-surface-variant text-[13px]">
        Override the authorization tier for <strong class="text-on-surface">{targetTenant.email}</strong> (<code class="text-primary">{targetTenant.tenantId}</code>).
      </p>

      <div class="space-y-1.5">
        <label for="admin-target-tier-select" class="text-label-sm font-mono text-outline uppercase">New Authorization Tier</label>
        <select
          id="admin-target-tier-select"
          bind:value={selectedNewTier}
          class="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/40 text-code-sm font-mono text-on-surface focus:outline-none focus:border-primary cursor-pointer"
        >
          <option value="ultra">ULTRA — Unlimited RPM / RPD (VIP Developer)</option>
          <option value="admin">ADMIN — Root Platform Superuser</option>
          <option value="max">MAX — 60 RPM / 10,000 RPD (Private + Communal Pool)</option>
          <option value="builder">BUILDER — 20 RPM / 2,000 RPD (Private Pool Only)</option>
          <option value="probationary">PROBATIONARY — 2 RPM / 50 RPD (Sandboxed)</option>
          <option value="demo">DEMO — 1 RPM / 5 RPD (Playground Only)</option>
        </select>
      </div>

      <div class="space-y-1.5">
        <label for="admin-tier-reason-input" class="text-label-sm font-mono text-outline uppercase">Audit Reason Note (Required)</label>
        <input
          id="admin-tier-reason-input"
          bind:value={actionReason}
          type="text"
          placeholder="Reason for tier change..."
          class="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/40 text-code-sm font-mono text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
        />
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onclick={onClose}
          class="px-3.5 py-1.5 rounded-lg bg-surface-container text-on-surface-variant hover:text-on-surface text-label-md font-mono transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={onConfirm}
          class="px-4 py-1.5 rounded-lg bg-primary-container text-on-primary font-mono text-label-md font-bold uppercase transition-all cursor-pointer shadow-md shadow-primary/20"
        >
          Update Tier
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal: Quarantine / Unquarantine -->
{#if actionModalType === 'quarantine' && targetTenant}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
    <div class="specular-card w-full max-w-md rounded-xl bg-surface-container-high p-6 space-y-4 border {targetTenant.isQuarantined ? 'border-secondary/40' : 'border-error/50'} shadow-2xl">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 {targetTenant.isQuarantined ? 'bg-secondary/20 text-secondary border border-secondary/30' : 'bg-error/20 text-error border border-error/40'}">
          <span class="material-symbols-outlined text-[24px]">
            {targetTenant.isQuarantined ? 'lock_open' : 'gavel'}
          </span>
        </div>
        <div class="space-y-1">
          <h3 class="text-headline-sm font-headline-sm font-semibold text-on-surface text-[16px]">
            {targetTenant.isQuarantined ? 'Lift Abuse Quarantine?' : 'Execute Abuse Quarantine (Ban Hammer)?'}
          </h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant text-[13px]">
            {targetTenant.isQuarantined
              ? `Re-activating ${targetTenant.email}. DO in-memory counters will be re-initialized upon next request.`
              : `Freezing ${targetTenant.email} (${targetTenant.tenantId}). Sets is_quarantined = 1 in D1 and immediately evicts tenant from DO isolate memory within 5ms.`}
          </p>
        </div>
      </div>

      <div class="space-y-1.5">
        <label for="admin-quarantine-reason-input" class="text-label-sm font-mono text-outline uppercase">Audit Reason Note (Required)</label>
        <input
          id="admin-quarantine-reason-input"
          bind:value={actionReason}
          type="text"
          placeholder="Reason for quarantine action..."
          class="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/40 text-code-sm font-mono text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
        />
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onclick={onClose}
          class="px-3.5 py-1.5 rounded-lg bg-surface-container text-on-surface-variant hover:text-on-surface text-label-md font-mono transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={onConfirm}
          class="px-4 py-1.5 rounded-lg font-mono text-label-md font-bold uppercase transition-all cursor-pointer {targetTenant.isQuarantined ? 'bg-secondary text-charcoal hover:bg-secondary-fixed' : 'bg-error text-on-error hover:bg-error-container shadow-[0_0_16px_rgba(239,68,68,0.4)]'}"
        >
          {targetTenant.isQuarantined ? 'Confirm Re-instate' : 'Execute Quarantine'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal: Reset Quota -->
{#if actionModalType === 'reset' && targetTenant}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
    <div class="specular-card w-full max-w-md rounded-xl bg-surface-container-high p-6 space-y-4 border border-outline-variant/40 shadow-2xl">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-on-surface font-semibold text-[16px]">
          <span class="material-symbols-outlined text-primary">restart_alt</span>
          <span>Reset Tenant Sliding Quotas</span>
        </div>
        <button
          type="button"
          onclick={onClose}
          class="text-outline hover:text-on-surface p-1 rounded transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <p class="text-body-sm font-body-sm text-on-surface-variant text-[13px]">
        Zero out the current sliding-window RPM counter for <strong class="text-on-surface">{targetTenant.email}</strong> in the Durable Object transactional store.
      </p>

      <div class="space-y-1.5">
        <label for="admin-reset-reason-input" class="text-label-sm font-mono text-outline uppercase">Audit Reason Note</label>
        <input
          id="admin-reset-reason-input"
          bind:value={actionReason}
          type="text"
          placeholder="Reason for resetting quota..."
          class="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/40 text-code-sm font-mono text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
        />
      </div>

      <div class="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onclick={onClose}
          class="px-3.5 py-1.5 rounded-lg bg-surface-container text-on-surface-variant hover:text-on-surface text-label-md font-mono transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={onConfirm}
          class="px-4 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-label-md font-bold uppercase transition-all cursor-pointer"
        >
          Reset Quota
        </button>
      </div>
    </div>
  </div>
{/if}
