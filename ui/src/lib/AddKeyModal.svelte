<script module lang="ts">
  export * from './add_key';
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Provider, CreateKeyPayload, PoolType } from './types';
  import {
    closeModal,
    submitKey,
    subscribeModalState,
    getModalState,
    ProviderSelector,
    PoolModeSelector,
    LimitsPriorityGrid,
    LegalAttestations,
    type KeyFormData,
  } from './add_key';

  let {
    isOpen = false,
    onClose,
    onAddKey,
    onSubmit,
    isGitHubAuth = false,
  }: {
    isOpen?: boolean;
    onClose?: () => void;
    onAddKey?: (payload: CreateKeyPayload) => Promise<void>;
    onSubmit?: (data: KeyFormData) => Promise<void>;
    isGitHubAuth?: boolean;
  } = $props();

  let _isGitHubAuth = $derived(isGitHubAuth ?? false);

  let provider = $state<Provider>('gemini');
  let label = $state('');
  let apiKey = $state('');
  let rpmLimit = $state(15);
  let rpdLimit = $state(1500);
  let priority = $state(0);
  let selectedPoolType = $state<PoolType>('COMMUNITY');
  let attestK1 = $state<boolean>(false);
  let attestK2 = $state<boolean>(false);

  $effect(() => {
    if (!_isGitHubAuth) {
      selectedPoolType = 'PRIVATE';
    }
  });
  let turnstileToken = $state<string>('');

  let isSubmitting = $state(false);
  let errorMessage = $state<string | null>(null);
  let showKey = $state(false);

  let moduleIsOpen = $state(getModalState().isOpen);

  let unsubscribe: (() => void) | undefined;
  onMount(() => {
    unsubscribe = subscribeModalState((state) => {
      moduleIsOpen = state.isOpen;
      if (state.type === 'gemini' || state.type === 'groq') {
        handleProviderSelect(state.type);
      }
    });

    window.addEventListener('message', handleTurnstileMessage);
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
    window.removeEventListener('message', handleTurnstileMessage);
  });

  function handleTurnstileMessage(event: MessageEvent) {
    if (event.data && event.data.type === 'turnstile_token') {
      turnstileToken = event.data.token;
    }
  }

  let visible = $derived(isOpen || moduleIsOpen);
  let canSubmit = $derived(!isSubmitting && apiKey.trim().length > 0 && label.trim().length > 0 && attestK1 && attestK2);

  // When provider changes, update default RPM/RPD limits
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

  function handleClose() {
    closeModal();
    if (onClose) onClose();
  }

  // Handle escape key
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && visible && !isSubmitting) {
      handleClose();
    }
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    errorMessage = null;

    if (!canSubmit) {
       errorMessage = 'Please complete all required fields and attestations.';
       return;
    }

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
      const keyName = label.trim() || `${provider}-key-${Date.now().toString(36).slice(-4)}`;

      await submitKey({
        name: keyName,
        key: trimmedKey,
      });

      if (onAddKey) {
        await onAddKey({
          provider,
          label: keyName,
          key: trimmedKey,
          rpm_limit: Number(rpmLimit) || 15,
          rpd_limit: Number(rpdLimit) || 1500,
          priority: Number(priority) || 0,
          pool_type: selectedPoolType,
          k1: attestK1,
          k2: attestK2,
          turnstile_token: turnstileToken,
        });
      }

      if (onSubmit) {
        await onSubmit({ name: keyName, key: trimmedKey });
      }

      // Reset form
      label = '';
      apiKey = '';
      priority = 0;
      attestK1 = false;
      attestK2 = false;
      turnstileToken = '';
      handleProviderSelect('gemini');
      handleClose();
    } catch (err: any) {
      errorMessage = err?.message || 'Failed to register API key with proxy backend.';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if visible}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => {
      if (e.target === e.currentTarget && !isSubmitting) handleClose();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape' && !isSubmitting) handleClose();
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
          onclick={handleClose}
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
        <ProviderSelector bind:provider onSelect={handleProviderSelect} />

        <!-- Pool Mode Selector -->
        <PoolModeSelector bind:selectedPoolType isGitHubAuth={_isGitHubAuth} />

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
            Encrypted with HTTPS server-side encryption at rest.
          </p>
        </div>

        <!-- Limits & Priority Grid -->
        <LimitsPriorityGrid bind:rpmLimit bind:rpdLimit bind:priority />

        <!-- Legal Attestations -->
        <LegalAttestations bind:attestK1 bind:attestK2 />

        <!-- Modal Actions -->
        <div class="pt-3 border-t border-white/[0.08] flex items-center justify-end gap-2.5 mt-4">
          <button
            type="button"
            onclick={handleClose}
            disabled={isSubmitting}
            class="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors disabled:opacity-50 text-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            class="px-5 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold shadow-lg shadow-indigo-900/40 border border-indigo-400/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 text-xs cursor-pointer"
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
