<script lang="ts">
  // Starts the GitHub link flow (WP-3.3). The Sybil engine verifies a Turnstile token, so the
  // button waits for one and passes it to /api/auth/github/start.
  import Turnstile from './Turnstile.svelte';

  let { label = 'Link GitHub' }: { label?: string } = $props();
  let token = $state('');
</script>

<div class="space-y-2">
  <Turnstile bind:token />
  <a
    href={token ? `/api/auth/github/start?turnstile=${encodeURIComponent(token)}` : undefined}
    aria-disabled={!token}
    data-testid="link-github"
    class="inline-block rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary {token ? '' : 'pointer-events-none opacity-50'}"
  >
    {label}
  </a>
</div>
