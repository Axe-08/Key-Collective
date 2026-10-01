<script lang="ts">
  // "Claim your old keys" (WP-3.5): shown while GET /api/session lists claimable legacy
  // GitHub-only accounts that match the caller's linked GitHub id.
  import { sessionAuthTransport } from './api/client';

  let { accounts, onClaimed }: { accounts: string[]; onClaimed: () => void } = $props();

  let busy = $state(false);
  let message = $state('');
  let error = $state('');

  async function claim() {
    busy = true;
    error = '';
    try {
      const res = await fetch('/api/auth/claim-legacy', {
        method: 'POST',
        credentials: 'same-origin',
        headers: sessionAuthTransport.getHeaders('POST'),
      });
      if (!res.ok) throw new Error(`Claim failed (HTTP ${res.status})`);
      const body = (await res.json()) as { claimed_keys?: number };
      message = `${body.claimed_keys ?? 0} keys moved to this account.`;
      onClaimed();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Claim failed';
    } finally {
      busy = false;
    }
  }
</script>

<div data-testid="claim-legacy-card" class="mx-4 mt-3 rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
  <h3 class="font-semibold text-on-surface">Claim your old keys</h3>
  <p class="text-sm text-on-surface-variant">
    Your GitHub account owns keys from an earlier Key Collective sign-in ({accounts.join(', ')}). Move them to this account.
  </p>
  {#if message}
    <p class="text-sm text-green-400" role="status">{message}</p>
  {:else}
    <button
      type="button"
      data-testid="claim-legacy"
      onclick={claim}
      disabled={busy}
      class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-50"
    >
      {busy ? 'Claiming…' : 'Claim Old Keys'}
    </button>
  {/if}
  {#if error}<p class="text-sm text-red-400" role="alert">{error}</p>{/if}
</div>
