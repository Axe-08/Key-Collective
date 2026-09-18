<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let {
    isOpen = false,
    onClose,
    onSuccess,
  } = $props<{
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: (msg: string) => void;
  }>();

  let keyId = $state("");
  let reason = $state("abuse");
  let isSubmitting = $state(false);
  let turnstileToken = $state("");

  function handleTurnstileMessage(event: MessageEvent) {
    if (event.data && event.data.type === "turnstile_token") {
      turnstileToken = event.data.token;
    }
  }

  onMount(() => {
    if (typeof window !== "undefined") {
      window.addEventListener("message", handleTurnstileMessage);
    }
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("message", handleTurnstileMessage);
    }
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!keyId.trim()) return;

    isSubmitting = true;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (turnstileToken) {
        headers["x-turnstile-token"] = turnstileToken;
      }

      const res = await fetch("/api/abuse/report-key", {
        method: "POST",
        headers,
        body: JSON.stringify({ keyId, reason }),
      });

      if (onSuccess) {
        onSuccess("Key reported successfully.");
      }
      onClose();
      keyId = "";
      reason = "abuse";
    } catch (err) {
      console.error(err);
      if (onSuccess) {
        onSuccess("Failed to report key.");
      }
    } finally {
      isSubmitting = false;
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
          <label for="key-id" class="block text-label-sm text-on-surface-variant mb-1">Key ID</label>
          <input id="key-id" type="text" bind:value={keyId} required class="w-full px-3 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface" />
        </div>
        <div>
          <label for="reason" class="block text-label-sm text-on-surface-variant mb-1">Reason</label>
          <select id="reason" bind:value={reason} class="w-full px-3 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface">
            <option value="abuse">Abuse / Terms of Service Violation</option>
            <option value="leaked">Leaked / Compromised Key</option>
            <option value="invalid">Invalid / Dead Key</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="mt-2 pt-4 border-t flex justify-end gap-3">
          <button type="button" onclick={onClose} disabled={isSubmitting} class="px-4 py-2 text-on-surface-variant cursor-pointer">Cancel</button>
          <button type="submit" disabled={isSubmitting || !keyId.trim()} class="px-4 py-2 bg-error text-white rounded-lg cursor-pointer">Submit Report</button>
        </div>
      </form>
    </div>
  </div>
{/if}
