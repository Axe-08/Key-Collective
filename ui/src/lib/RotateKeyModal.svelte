<script lang="ts">
  import { api } from './api';

  interface Props {
    isOpen: boolean;
    keyId: string;
    provider?: string;
    onClose: () => void;
    onRotated?: (keyId: string) => void;
  }

  let {
    isOpen = false,
    keyId = '',
    provider = 'google',
    onClose,
    onRotated,
  }: Props = $props();

  let newKey = $state('');
  let isSubmitting = $state(false);
  let errorMessage = $state<string | null>(null);
  let successMessage = $state<string | null>(null);

  async function handleRotate(e: Event) {
    e.preventDefault();
    if (!newKey.trim()) return;

    isSubmitting = true;
    errorMessage = null;
    successMessage = null;

    const res = await api.rotateKeySecret(keyId, newKey.trim());
    isSubmitting = false;

    if (res.ok) {
      successMessage = 'Key rotated successfully. Vesting tenure and standing multiplier preserved.';
      setTimeout(() => {
        onRotated?.(keyId);
        onClose();
        newKey = '';
        successMessage = null;
      }, 1200);
    } else {
      if (res.error === 'project_mismatch') {
        errorMessage = 'Project mismatch: the rotated key must belong to the exact same GCP project to preserve vesting tenure (Flow D).';
      } else if (res.error === 'key_already_registered') {
        errorMessage = 'This API key is already registered in the collective pool.';
      } else {
        errorMessage = res.message || 'Failed to rotate key. Please verify the key is valid and has active quota.';
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
        <div class="flex items-center gap-2 text-primary font-semibold">
          <span class="material-symbols-outlined text-[20px]">sync</span>
          <span class="text-sm">Rotate API Key Secret (Flow D)</span>
        </div>
        <button
          type="button"
          onclick={onClose}
          class="text-outline hover:text-on-surface p-1 rounded cursor-pointer"
        >
          <span class="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      <!-- Flow D Information Notice -->
      <div class="p-5 space-y-4">
        <div class="p-3 rounded-lg bg-primary/10 border border-primary/20 text-on-surface space-y-1.5 leading-relaxed">
          <div class="font-semibold text-primary flex items-center gap-1.5">
            <span class="material-symbols-outlined text-[16px]">verified</span>
            <span>30-Minute Zero-Loss Rotation Window</span>
          </div>
          <p class="text-[11px] text-outline">
            Key Collective provides a 30-minute grace window for keys from the same project.
            Rotating your key replaces the stored secret while <strong class="text-on-surface">fully inheriting your accumulated key age and vesting multiplier bonus</strong>.
          </p>
          <p class="text-[11px] text-outline">
            The new key must belong to the same upstream project ({provider === 'google' ? 'GCP Project' : 'Provider Organization'}).
          </p>
        </div>

        {#if errorMessage}
          <div class="p-3 rounded-lg bg-error/15 border border-error/30 text-error flex items-start gap-2">
            <span class="material-symbols-outlined text-[18px] shrink-0 mt-0.5">error</span>
            <span class="text-xs leading-relaxed">{errorMessage}</span>
          </div>
        {/if}

        {#if successMessage}
          <div class="p-3 rounded-lg bg-secondary/15 border border-secondary/30 text-secondary flex items-start gap-2">
            <span class="material-symbols-outlined text-[18px] shrink-0 mt-0.5">check_circle</span>
            <span class="text-xs leading-relaxed">{successMessage}</span>
          </div>
        {/if}

        <form onsubmit={handleRotate} class="space-y-4">
          <div>
            <label for="new-key-input" class="block text-outline text-[11px] mb-1 font-medium">
              New {provider === 'google' ? 'Gemini / Google AI Studio' : 'Groq'} Secret Key
            </label>
            <input
              id="new-key-input"
              type="password"
              autocomplete="off"
              bind:value={newKey}
              required
              placeholder={provider === 'google' ? 'AIzaSy...' : 'gsk_...'}
              class="w-full px-3 py-2 rounded-lg bg-surface-container-highest/80 border border-outline-variant/30 text-on-surface focus:outline-none focus:border-primary text-xs"
            />
          </div>

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
              type="submit"
              disabled={isSubmitting || !newKey.trim()}
              class="px-4 py-1.5 rounded bg-primary text-on-primary font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              {#if isSubmitting}
                <span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                <span>Validating...</span>
              {:else}
                <span class="material-symbols-outlined text-[16px]">sync</span>
                <span>Confirm Rotation</span>
              {/if}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
{/if}
