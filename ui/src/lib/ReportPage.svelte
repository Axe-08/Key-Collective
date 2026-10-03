<script lang="ts">
  import Turnstile from './Turnstile.svelte';
  import { describeReportError, submitKeyReport } from './report_key';

  interface Props {
    onBack?: () => void;
  }

  let { onBack }: Props = $props();

  let leakedKey = $state('');
  let isSubmitting = $state(false);
  let turnstileToken = $state('');
  let turnstile: Turnstile | undefined = $state();
  let statusMsg = $state<{ type: 'success' | 'error'; text: string } | null>(null);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!leakedKey.trim() || !turnstileToken) return;

    isSubmitting = true;
    statusMsg = null;

    try {
      const result = await submitKeyReport(leakedKey.trim(), turnstileToken);
      if (result.ok) {
        statusMsg = {
          type: 'success',
          text: 'Report received. If this key is registered in Key Collective, it has been immediately revoked and tombstoned.',
        };
        leakedKey = '';
      } else {
        statusMsg = { type: 'error', text: describeReportError(result) };
      }
    } catch (err) {
      console.error('Key report request failed', err);
      statusMsg = { type: 'error', text: 'Report failed: the network request did not complete.' };
    } finally {
      isSubmitting = false;
      turnstile?.reset();
    }
  }
</script>

<div class="max-w-lg mx-auto my-12 p-6 rounded-2xl bg-surface-container-low border border-outline-variant/40 shadow-2xl space-y-5 font-mono text-xs" data-testid="report-page">
  <div class="flex items-center justify-between border-b border-outline-variant/20 pb-4">
    <div class="flex items-center gap-2.5 text-error font-semibold">
      <span class="material-symbols-outlined text-[22px]">security</span>
      <h1 class="text-base text-on-surface">Public Compromised Key Takedown</h1>
    </div>
    {#if onBack}
      <button
        type="button"
        onclick={onBack}
        class="px-2.5 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-outline hover:text-on-surface cursor-pointer"
      >
        Back
      </button>
    {/if}
  </div>

  <div class="p-3.5 rounded-lg bg-surface-container-highest/40 border border-outline-variant/20 text-outline leading-relaxed space-y-1.5">
    <p>
      If you discovered an API key belonging to you or your organization exposed in public or used without authorization, paste the plaintext key below.
    </p>
    <p class="text-[11px]">
      <strong class="text-on-surface">Zero-Knowledge Verification:</strong> The key is SHA-256 hashed at the edge to locate and immediately revoke any matching pool entry. The server responds identically whether or not the key was found.
    </p>
  </div>

  {#if statusMsg}
    <div class="p-3 rounded-lg border {statusMsg.type === 'success' ? 'bg-secondary/15 border-secondary/30 text-secondary' : 'bg-error/15 border-error/30 text-error'}">
      {statusMsg.text}
    </div>
  {/if}

  <form onsubmit={handleSubmit} class="space-y-4">
    <div>
      <label for="report-leaked-key-input" class="block text-outline mb-1 font-medium">
        Compromised API Key
      </label>
      <input
        id="report-leaked-key-input"
        type="password"
        autocomplete="off"
        bind:value={leakedKey}
        required
        placeholder="AIzaSy... or gsk_..."
        class="w-full px-3 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface focus:outline-none focus:border-error"
      />
    </div>

    <Turnstile bind:this={turnstile} bind:token={turnstileToken} />

    <div class="pt-2 flex justify-end">
      <button
        type="submit"
        disabled={isSubmitting || !leakedKey.trim() || !turnstileToken}
        class="px-4 py-2 rounded-lg bg-error text-white font-semibold hover:bg-error/90 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
      >
        <span class="material-symbols-outlined text-[16px]">gavel</span>
        <span>{isSubmitting ? 'Revoking...' : 'Submit Takedown'}</span>
      </button>
    </div>
  </form>
</div>
