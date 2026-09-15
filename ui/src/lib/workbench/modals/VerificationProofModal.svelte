<script lang="ts">
  interface Props {
    show: boolean;
    onClose: () => void;
  }

  let { show, onClose }: Props = $props();
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={onClose}
  >
    <div
      class="rounded-xl bg-surface-container-low border border-outline-variant/30 p-6 max-w-lg w-full space-y-4 specular-card shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-secondary">verified</span>
          <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface">
            Cryptographic Proof &amp; Sybil Attestation
          </h3>
        </div>
        <button
          type="button"
          onclick={onClose}
          class="text-outline hover:text-on-surface transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="space-y-3 font-mono text-xs text-on-surface-variant">
        <div class="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/15 space-y-1">
          <div class="text-outline text-[10px] uppercase tracking-wider font-semibold">Turnstile Challenge Signature</div>
          <div class="text-secondary break-all">
            0x4a9b91c0e35f8d227b4012fa1982bca81498b3017f8a329d91f801ca458d92e1
          </div>
        </div>

        <div class="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/15 space-y-1">
          <div class="text-outline text-[10px] uppercase tracking-wider font-semibold">Edge Node Attestation Key</div>
          <div class="text-primary break-all">
            ed25519:iad-edge-01:99a81f3b20ce19da01f28b4931a77481c
          </div>
        </div>

        <div class="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/15 space-y-1">
          <div class="text-outline text-[10px] uppercase tracking-wider font-semibold">Sybil Risk Vector Analysis</div>
          <div class="text-on-surface">Score: <strong class="text-secondary">92 / 100</strong> • Risk tier: LOW</div>
          <div class="text-outline text-[11px]">ASN 13335 (Dedicated Cloudflare Edge Transit) • Zero Tor/Proxy hops detected.</div>
        </div>
      </div>

      <div class="flex justify-end pt-2">
        <button
          type="button"
          onclick={onClose}
          class="px-4 py-2 rounded-lg bg-primary text-on-primary font-mono text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
        >
          Close Proof
        </button>
      </div>
    </div>
  </div>
{/if}
