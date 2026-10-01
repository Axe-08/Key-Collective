<script lang="ts">
  // Shows a newly issued or rotated API key secret exactly once (WP-3.9).
  let { secret, onClose }: { secret: string | null; onClose: () => void } = $props();
  let copied = $state(false);

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      copied = true;
    } catch {
      copied = false;
    }
  }
</script>

{#if secret}
  <div class="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div class="absolute inset-0 bg-black/70"></div>
    <div class="relative w-full max-w-lg rounded-xl border border-outline-variant/30 bg-surface-container-low p-5 space-y-3">
      <h2 class="font-semibold text-on-surface">Your new API key</h2>
      <p class="text-sm text-amber-300" data-testid="secret-once">Copy it now. It is shown once and cannot be retrieved after you close this dialog.</p>
      <code data-testid="secret-value" class="block break-all rounded-lg bg-surface-container-lowest p-3 font-mono text-xs text-on-surface">{secret}</code>
      <div class="flex justify-end gap-2">
        <button type="button" onclick={copy} class="rounded-lg border border-outline-variant/30 px-3 py-1.5 text-xs">{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" data-testid="secret-done" onclick={() => { copied = false; onClose(); }} class="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary">I have saved it</button>
      </div>
    </div>
  </div>
{/if}
