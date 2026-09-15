<script lang="ts">
  interface Props {
    open: boolean;
    target: { keyId: string; targetPool: 'COMMUNITY' | 'PRIVATE' } | null;
    loading: boolean;
    error: string | null;
    onClose: () => void;
    onConfirm: () => void;
  }

  let {
    open,
    target,
    loading,
    error,
    onClose,
    onConfirm,
  }: Props = $props();
</script>

{#if open && target}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={onClose}
  >
    <div
      class="rounded-xl bg-surface-container-low border border-outline-variant/30 p-6 max-w-md w-full space-y-4 specular-card shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center gap-3 border-b border-outline-variant/20 pb-3">
        <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
          <span class="material-symbols-outlined text-primary text-[18px]">swap_horiz</span>
        </div>
        <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface">Confirm Pool Switch</h3>
      </div>
      
      <div class="text-body-sm font-body-sm text-on-surface-variant">
        {#if target.targetPool === 'COMMUNITY'}
          <p class="mb-2">Switching this key to the Community Pool enters a 24-hour observation period (OBSERVATION status) before receiving reciprocal community routing credits.</p>
          <p class="font-semibold text-amber-400">Pool switches are frozen during the midnight UTC reset window (23:30–00:30 UTC).</p>
        {:else}
          <p>Switching this key to Private will remove it from the reciprocal Community Pool immediately. It will only serve your personal requests.</p>
        {/if}
      </div>

      {#if error}
        <div class="p-3 bg-error/10 border border-error/20 text-error text-xs rounded-lg mt-2">
          {error}
        </div>
      {/if}

      <div class="flex justify-end gap-3 pt-3 border-t border-outline-variant/20">
        <button
          type="button"
          onclick={onClose}
          disabled={loading}
          class="px-4 py-2 rounded-lg border border-outline-variant/30 text-on-surface hover:bg-surface-container-high transition-colors font-semibold text-sm cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={onConfirm}
          disabled={loading}
          class="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-on-primary font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
        >
          {#if loading}
            <span class="material-symbols-outlined animate-spin text-[16px]">refresh</span>
          {/if}
          Confirm Switch
        </button>
      </div>
    </div>
  </div>
{/if}
