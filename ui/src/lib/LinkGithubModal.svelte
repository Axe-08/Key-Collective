<script lang="ts">
  import LinkGithubButton from './LinkGithubButton.svelte';

  let {
    isOpen = false,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  } = $props();
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid="link-github-modal">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onclick={onClose}></div>
    <div class="relative w-full max-w-md rounded-2xl border border-outline-variant/30 bg-[#0d0f14] p-6 shadow-2xl space-y-4">
      <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-xl">share</span>
          <h3 class="text-base font-semibold text-white">Link GitHub Account</h3>
        </div>
        <button
          type="button"
          class="rounded-lg p-1 text-outline hover:text-white hover:bg-surface-container transition-colors cursor-pointer"
          onclick={onClose}
          aria-label="Close"
        >
          <span class="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      <div class="space-y-2 text-xs text-white/70 leading-relaxed">
        <p>
          Linking your GitHub account verifies your developer standing through an automated Sybil check and unlocks community key-sharing.
        </p>
        <p class="text-white/50 text-[11px]">
          Please complete the bot verification below before continuing to GitHub authentication.
        </p>
      </div>

      <div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/20 flex flex-col items-center justify-center min-h-[120px]">
        <LinkGithubButton label="Authorize with GitHub" />
      </div>

      <div class="flex justify-end pt-2 border-t border-outline-variant/10">
        <button
          type="button"
          onclick={onClose}
          class="px-4 py-2 bg-transparent text-white/70 rounded-lg text-xs hover:bg-surface-container hover:text-white transition-colors cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

