<script lang="ts">
  import type { Provider, CreateKeyPayload } from './types';

  let {
    isOpen,
    onClose,
    onAddKey,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onAddKey: (payload: CreateKeyPayload) => Promise<void>;
  } = $props();

  let provider = $state<Provider>('gemini');
  let label = $state('');
  let apiKey = $state('');
  let rpmLimit = $state(15);
  let rpdLimit = $state(1500);
  let priority = $state(0);

  let isSubmitting = $state(false);
  let errorMessage = $state<string | null>(null);
  let showKey = $state(false);

  // When provider changes, update default RPM/RPD limits if user hasn't manually customized them away from defaults
  function handleProviderSelect(selected: Provider) {
    provider = selected;
    if (selected === 'gemini') {
      rpmLimit = 15;
      rpdLimit = 1500;
    } else {
      rpmLimit = 30;
      rpdLimit = 14400;
    }
  }

  // Handle escape key
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen && !isSubmitting) {
      onClose();
    }
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    errorMessage = null;

    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      errorMessage = 'Please provide a valid API key.';
      return;
    }

    if (provider === 'gemini' && !trimmedKey.startsWith('AIza')) {
      if (!confirm('Warning: Gemini API keys usually start with "AIza". Are you sure you want to save this key?')) {
        return;
      }
    } else if (provider === 'groq' && !trimmedKey.startsWith('gsk_')) {
      if (!confirm('Warning: Groq API keys usually start with "gsk_". Are you sure you want to save this key?')) {
        return;
      }
    }

    isSubmitting = true;
    try {
      await onAddKey({
        provider,
        label: label.trim() || `${provider}-key-${Date.now().toString(36).slice(-4)}`,
        key: trimmedKey,
        rpm_limit: Number(rpmLimit) || 15,
        rpd_limit: Number(rpdLimit) || 1500,
        priority: Number(priority) || 0,
      });

      // Reset form
      label = '';
      apiKey = '';
      priority = 0;
      handleProviderSelect('gemini');
      onClose();
    } catch (err: any) {
      errorMessage = err?.message || 'Failed to register API key with proxy backend.';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if isOpen}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => {
      if (e.target === e.currentTarget && !isSubmitting) onClose();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    }}
  >
    <div class="w-full max-w-lg rounded-2xl bg-[#0e121a] border border-white/10 shadow-2xl shadow-indigo-950/40 overflow-hidden my-8">
      <!-- Modal Header -->
      <div class="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between bg-slate-900/50">
        <div class="flex items-center gap-2.5">
          <div class="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-white font-mono tracking-tight">Register New API Key</h3>
            <p class="text-[11px] text-slate-400 font-mono">Provision a key into the Key Collective proxy pool</p>
          </div>
        </div>
        <button
          type="button"
          onclick={onClose}
          disabled={isSubmitting}
          class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
          aria-label="Close dialog"
        >
          <svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>

      <!-- Form Content -->
      <form onsubmit={handleSubmit} class="p-6 space-y-4 text-xs font-mono">
        {#if errorMessage}
          <div class="p-3 rounded-lg bg-rose-950/60 border border-rose-500/30 text-rose-300 text-xs">
            {errorMessage}
          </div>
        {/if}

        <!-- Provider Selector -->
        <div>
          <span class="block text-slate-400 font-semibold mb-2 uppercase tracking-wider text-[10px]">
            Target Upstream Provider
          </span>
          <div class="grid grid-cols-2 gap-3">
            <button
              type="button"
              onclick={() => handleProviderSelect('gemini')}
              class="flex items-center gap-3 p-3 rounded-xl border transition-all text-left cursor-pointer {provider === 'gemini'
                ? 'bg-blue-950/40 border-blue-500/50 text-blue-200 shadow-md shadow-blue-950/40 ring-1 ring-blue-500/40'
                : 'bg-slate-900/40 border-white/10 text-slate-400 hover:border-white/20'}"
            >
              <div class="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
                </svg>
              </div>
              <div>
                <div class="font-bold text-white text-xs">Google Gemini</div>
                <div class="text-[10px] text-slate-400">15 RPM / 1.5K RPD default</div>
              </div>
            </button>

            <button
              type="button"
              onclick={() => handleProviderSelect('groq')}
              class="flex items-center gap-3 p-3 rounded-xl border transition-all text-left cursor-pointer {provider === 'groq'
                ? 'bg-amber-950/40 border-amber-500/50 text-amber-200 shadow-md shadow-amber-950/40 ring-1 ring-amber-500/40'
                : 'bg-slate-900/40 border-white/10 text-slate-400 hover:border-white/20'}"
            >
              <div class="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <div>
                <div class="font-bold text-white text-xs">Groq Cloud</div>
                <div class="text-[10px] text-slate-400">30 RPM / 14.4K RPD default</div>
              </div>
            </button>
          </div>
        </div>

        <!-- Label Input -->
        <div>
          <label for="key-label" class="block text-slate-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            Key Label
          </label>
          <input
            id="key-label"
            type="text"
            bind:value={label}
            placeholder={provider === 'gemini' ? 'e.g. prod-gemini-15-pro-pool' : 'e.g. groq-llama-eu-shard'}
            class="w-full px-3.5 py-2 rounded-lg bg-slate-950/80 border border-white/10 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-xs"
          />
        </div>

        <!-- API Key Plaintext Input -->
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label for="api-key-input" class="block text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
              API Key Token
            </label>
            <span class="text-[10px] text-slate-500">
              {provider === 'gemini' ? 'Starts with AIza...' : 'Starts with gsk_...'}
            </span>
          </div>
          <div class="relative">
            <input
              id="api-key-input"
              type={showKey ? 'text' : 'password'}
              bind:value={apiKey}
              required
              placeholder={provider === 'gemini' ? 'AIzaSy...' : 'gsk_...'}
              class="w-full pl-3.5 pr-10 py-2 rounded-lg bg-slate-950/80 border border-white/10 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-xs font-mono"
            />
            <button
              type="button"
              onclick={() => (showKey = !showKey)}
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
              title={showKey ? 'Hide key' : 'Show key'}
              aria-label={showKey ? 'Hide key' : 'Show key'}
            >
              {#if showKey}
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
              {:else}
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              {/if}
            </button>
          </div>
          <p class="mt-1 text-[10px] text-slate-500">
            Encrypted with AES-256-GCM via Master Key at rest upon proxy ingestion.
          </p>
        </div>

        <!-- Limits & Priority Grid -->
        <div class="grid grid-cols-3 gap-3">
          <!-- RPM Limit -->
          <div>
            <label for="rpm-limit" class="block text-slate-400 font-semibold mb-1 uppercase tracking-wider text-[10px]">
              RPM Limit
            </label>
            <input
              id="rpm-limit"
              type="number"
              min="1"
              max="10000"
              bind:value={rpmLimit}
              required
              class="w-full px-3 py-1.5 rounded-lg bg-slate-950/80 border border-white/10 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
            />
          </div>

          <!-- RPD Limit -->
          <div>
            <label for="rpd-limit" class="block text-slate-400 font-semibold mb-1 uppercase tracking-wider text-[10px]">
              RPD Limit
            </label>
            <input
              id="rpd-limit"
              type="number"
              min="1"
              max="500000"
              bind:value={rpdLimit}
              required
              class="w-full px-3 py-1.5 rounded-lg bg-slate-950/80 border border-white/10 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
            />
          </div>

          <!-- Priority -->
          <div>
            <label for="priority" class="block text-slate-400 font-semibold mb-1 uppercase tracking-wider text-[10px]" title="0 is highest priority">
              Priority (P0-P5)
            </label>
            <input
              id="priority"
              type="number"
              min="0"
              max="10"
              bind:value={priority}
              required
              class="w-full px-3 py-1.5 rounded-lg bg-slate-950/80 border border-white/10 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
            />
          </div>
        </div>

        <!-- Modal Actions -->
        <div class="pt-3 border-t border-white/[0.08] flex items-center justify-end gap-2.5">
          <button
            type="button"
            onclick={onClose}
            disabled={isSubmitting}
            class="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors disabled:opacity-50 text-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            class="px-5 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold shadow-lg shadow-indigo-900/40 border border-indigo-400/30 transition-all disabled:opacity-50 inline-flex items-center gap-2 text-xs cursor-pointer"
          >
            {#if isSubmitting}
              <svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              Registering Key...
            {:else}
              Save API Key
            {/if}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
