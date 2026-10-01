<script lang="ts">
  import { submitConsent } from './auth/session';
  import { CONSENT_TEXTS } from './auth/consent_texts';

  let { onConsented }: { onConsented: () => void } = $props();

  let ticked = $state({ c1: false, c2: false, c3: false });
  let submitting = $state(false);
  let error = $state('');
  const allTicked = $derived(ticked.c1 && ticked.c2 && ticked.c3);

  async function submit() {
    submitting = true;
    error = '';
    try {
      await submitConsent();
      onConsented();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Consent was not recorded';
    } finally {
      submitting = false;
    }
  }
</script>

<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); void submit(); }}>
  <h2 class="text-lg font-semibold text-white">Before you continue</h2>
  {#each (['c1', 'c2', 'c3'] as const) as id}
    <label class="flex gap-3 items-start text-sm text-white/80">
      <input type="checkbox" data-testid={`consent-${id}`} bind:checked={ticked[id]} class="mt-1" />
      <span>{CONSENT_TEXTS[id]}</span>
    </label>
  {/each}
  {#if error}<p class="text-sm text-red-400" role="alert">{error}</p>{/if}
  <button
    type="submit"
    data-testid="consent-submit"
    disabled={!allTicked || submitting}
    class="w-full rounded-xl bg-white text-gray-900 font-semibold py-3 disabled:opacity-40"
  >
    Agree and continue
  </button>
</form>
