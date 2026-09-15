<script lang="ts">
  interface Props {
    show: boolean;
    name: string;
    slug: string;
    desc: string;
    rpm: number;
    onClose: () => void;
    onSubmit: () => void;
  }

  let {
    show,
    name = $bindable(''),
    slug = $bindable(''),
    desc = $bindable(''),
    rpm = $bindable(10),
    onClose,
    onSubmit,
  }: Props = $props();
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={onClose}
  >
    <div
      class="rounded-xl bg-surface-container-low border border-outline-variant/30 p-6 max-w-md w-full space-y-4 specular-card shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary">add_box</span>
          <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface">
            Create New Project
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

      <form onsubmit={(e) => { e.preventDefault(); onSubmit(); }} class="space-y-3 font-sans">
        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="np-name">Project Name</label>
          <input
            id="np-name"
            type="text"
            bind:value={name}
            placeholder="e.g., Voice Agent Gateway"
            required
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-body-sm text-body-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="np-slug">Project Slug</label>
          <input
            id="np-slug"
            type="text"
            bind:value={slug}
            placeholder="e.g., voice-agent-gateway"
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-code-sm text-code-sm font-mono focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="np-desc">Description</label>
          <input
            id="np-desc"
            type="text"
            bind:value={desc}
            placeholder="Optional project purpose or routing domain"
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-body-sm text-body-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label class="block font-mono text-xs text-outline mb-1" for="np-rpm">RPM Sub-Cap Limit</label>
          <input
            id="np-rpm"
            type="number"
            min="1"
            max="100"
            bind:value={rpm}
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface font-code-sm text-code-sm font-mono focus:outline-none focus:border-primary"
          />
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-outline-variant/20">
          <button
            type="button"
            onclick={onClose}
            class="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-outline hover:text-on-surface font-mono text-xs transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="px-4 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
          >
            Create Project
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
