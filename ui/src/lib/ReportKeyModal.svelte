<script lang="ts">
  // Abuse takedown (WP-0.4 / WP-3.6): the reporter pastes the leaked key itself; the server
  // revokes it by hash and always answers 200 so it never confirms whether a key exists.
  import Turnstile from './Turnstile.svelte';
  import { describeReportError, submitKeyReport } from './report_key';

  let {
    isOpen = false,
    onClose,
    onSuccess,
  } = $props<{
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: (msg: string) => void;
  }>();

  let leakedKey = $state("");
  let isSubmitting = $state(false);
  let turnstileToken = $state("");
  let turnstile: Turnstile | undefined = $state();

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!leakedKey.trim() || !turnstileToken) return;

    isSubmitting = true;
    try {
      const result = await submitKeyReport(leakedKey.trim(), turnstileToken);
      if (result.ok) {
        onSuccess?.("Report received. If the key is registered, it has been revoked.");
        onClose();
        leakedKey = "";
      } else {
        onSuccess?.(describeReportError(result));
      }
    } catch (err) {
      console.error(err);
      onSuccess?.("Report failed: the network request did not complete.");
    } finally {
      isSubmitting = false;
      turnstile?.reset();
    }
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onclick={onClose}></div>
    <div class="relative w-full max-w-md bg-surface-container-low border border-outline-variant/30 rounded-xl shadow-2xl overflow-hidden flex flex-col">
      <div class="px-5 py-4 border-b border-outline-variant/20 flex items-center gap-3 bg-surface-container-lowest/50">
        <div>
          <h2 class="text-title-md font-title-md font-semibold text-on-surface">Report Key</h2>
        </div>
      </div>
      <form onsubmit={handleSubmit} class="p-5 flex flex-col gap-4">
        <div>
          <label for="leaked-key" class="block text-label-sm text-on-surface-variant mb-1">Leaked key</label>
          <input id="leaked-key" type="password" autocomplete="off" bind:value={leakedKey} required placeholder="AIza… or gsk_…" class="w-full px-3 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface" />
          <p class="mt-1 text-[11px] text-on-surface-variant">Paste the exposed key. It is only used to look up and revoke the matching key.</p>
        </div>
        <Turnstile bind:this={turnstile} bind:token={turnstileToken} />
        <div class="mt-2 pt-4 border-t flex justify-end gap-3">
          <button type="button" onclick={onClose} disabled={isSubmitting} class="px-4 py-2 text-on-surface-variant cursor-pointer">Cancel</button>
          <button type="submit" disabled={isSubmitting || !leakedKey.trim() || !turnstileToken} class="px-4 py-2 bg-error text-white rounded-lg cursor-pointer">Submit Report</button>
        </div>
      </form>
    </div>
  </div>
{/if}
