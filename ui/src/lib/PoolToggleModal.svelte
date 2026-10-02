<script lang="ts">
  import { api } from './api';

  interface Props {
    isOpen: boolean;
    keyId: string;
    currentPoolType: 'COMMUNITY' | 'PRIVATE';
    onClose: () => void;
    onToggled?: (keyId: string, newPoolType: 'COMMUNITY' | 'PRIVATE') => void;
  }

  let {
    isOpen = false,
    keyId = '',
    currentPoolType = 'COMMUNITY',
    onClose,
    onToggled,
  }: Props = $props();

  let targetPoolType = $derived<'COMMUNITY' | 'PRIVATE'>(
    currentPoolType === 'COMMUNITY' ? 'PRIVATE' : 'COMMUNITY'
  );

  let isSubmitting = $state(false);
  let errorMessage = $state<string | null>(null);

  async function handleToggle() {
    isSubmitting = true;
    errorMessage = null;

    const res = await api.toggleUserPoolMode(keyId, targetPoolType);
    isSubmitting = false;

    if (res.ok) {
      onToggled?.(keyId, targetPoolType);
      onClose();
    } else {
      if (res.status === 423 || res.error === 'pool_toggle_frozen') {
        errorMessage = 'Pool switching is frozen during the midnight quota reset window (23:30–00:30 UTC per FR-22). Please try again after 00:31 UTC.';
      } else if (res.status === 403 || res.error === 'github_link_required') {
        errorMessage = 'Linking your GitHub account is required before contributing keys to the Community Pool (Flow A / D-05).';
      } else {
        errorMessage = res.message || 'Failed to update pool mode. Please check connection and try again.';
      }
    }
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <!-- Backdrop -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onclick={onClose}></div>

    <!-- Modal Content -->
    <div class="relative w-full max-w-lg bg-surface-container-low border border-outline-variant/40 rounded-xl shadow-2xl overflow-hidden flex flex-col font-mono text-xs">
      <!-- Modal Header -->
      <div class="px-5 py-4 border-b border-outline-variant/20 flex items-center justify-between bg-surface-container-lowest/60">
        <div class="flex items-center gap-2 {targetPoolType === 'COMMUNITY' ? 'text-secondary' : 'text-primary'} font-semibold">
          <span class="material-symbols-outlined text-[20px]">
            {targetPoolType === 'COMMUNITY' ? 'groups' : 'lock'}
          </span>
          <span class="text-sm">
            Switch Key to {targetPoolType === 'COMMUNITY' ? 'Community Pool' : 'Private Mode'} (Flow E)
          </span>
        </div>
        <button
          type="button"
          onclick={onClose}
          class="text-outline hover:text-on-surface p-1 rounded cursor-pointer"
        >
          <span class="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      <div class="p-5 space-y-4">
        {#if targetPoolType === 'COMMUNITY'}
          <!-- Moving PRIVATE -> COMMUNITY -->
          <div class="p-3 rounded-lg bg-secondary/10 border border-secondary/20 text-on-surface space-y-2 leading-relaxed">
            <div class="font-semibold text-secondary flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[16px]">hourglass_top</span>
              <span>24-Hour Observation & Verification Window</span>
            </div>
            <p class="text-[11px] text-outline">
              Contributing this key will place it into the <strong class="text-on-surface">Observation state</strong> for 24 hours.
              During observation, the key's health and RPM limits are verified at the edge.
            </p>
            <p class="text-[11px] text-outline">
              Once graduated, the key enters communal dispatch and begins earning you reciprocal Credit Units (CU) and unlocking multiplier tiers.
            </p>
          </div>
        {:else}
          <!-- Moving COMMUNITY -> PRIVATE -->
          <div class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-on-surface space-y-2 leading-relaxed">
            <div class="font-semibold text-amber-300 flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[16px]">warning</span>
              <span>Withdrawal & Communal Debt Invariant</span>
            </div>
            <p class="text-[11px] text-outline">
              Withdrawing this key immediately locks it for your exclusive personal use. It will no longer serve communal requests.
            </p>
            <p class="text-[11px] text-outline">
              <strong class="text-amber-200">Communal Debt Notice:</strong> Any existing debt accrued while borrowing communal capacity remains on your account. It will continue to decay by 20% (or 30% for trusted tenants) every midnight at 00:00 UTC until cleared.
            </p>
          </div>
        {/if}

        <!-- Midnight Freeze Window Warning -->
        <div class="p-2.5 rounded bg-surface-container-highest/40 border border-outline-variant/20 text-[10px] text-outline flex items-center gap-2">
          <span class="material-symbols-outlined text-[15px] text-outline shrink-0">ac_unit</span>
          <span>FR-22 Invariant: Pool mode switching is frozen daily between 23:30 and 00:30 UTC during the midnight reset.</span>
        </div>

        {#if errorMessage}
          <div class="p-3 rounded-lg bg-error/15 border border-error/30 text-error flex items-start gap-2">
            <span class="material-symbols-outlined text-[18px] shrink-0 mt-0.5">error</span>
            <span class="text-xs leading-relaxed">{errorMessage}</span>
          </div>
        {/if}

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant/20">
          <button
            type="button"
            onclick={onClose}
            disabled={isSubmitting}
            class="px-3.5 py-1.5 rounded text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={handleToggle}
            disabled={isSubmitting}
            class="px-4 py-1.5 rounded {targetPoolType === 'COMMUNITY' ? 'bg-secondary text-on-secondary' : 'bg-primary text-on-primary'} font-semibold hover:opacity-90 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
          >
            {#if isSubmitting}
              <span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
              <span>Updating...</span>
            {:else}
              <span class="material-symbols-outlined text-[16px]">
                {targetPoolType === 'COMMUNITY' ? 'groups' : 'lock'}
              </span>
              <span>Confirm Switch to {targetPoolType}</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
