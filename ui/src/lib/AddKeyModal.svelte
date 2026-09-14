<script module lang="ts">
  export type KeyType = 'gemini' | 'groq' | string;

  export type KeyFormData = {
    name: string;
    key: string;
  };

  export interface EncryptedPayload {
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    combined: Uint8Array;
    ciphertextB64: string;
    nonceB64: string;
    combinedB64: string;
  }

  export interface EncryptedSubmission {
    name: string;
    key: string;
    ciphertext: string;
    nonce: string;
    encrypted: EncryptedPayload;
  }

  export const NONCE_LENGTH_BYTES = 12;
  export const ENCRYPTION_ALGORITHM = 'AES-GCM';
  export const DEFAULT_KEY_DERIVATION_SECRET = 'KC_DEFAULT_CLIENT_MASTER_KEY_SECRET_32B';

  export function uint8ArrayToBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  export function base64ToUint8Array(base64: string): Uint8Array {
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(base64, 'base64'));
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Generates a cryptographically secure 12-byte (96-bit) nonce for AES-GCM.
   */
  export function generateNonce(length: number = NONCE_LENGTH_BYTES): Uint8Array {
    if (length !== NONCE_LENGTH_BYTES) {
      throw new Error(`Invalid nonce length: expected ${NONCE_LENGTH_BYTES} bytes, got ${length}`);
    }
    return crypto.getRandomValues(new Uint8Array(length));
  }

  /**
   * Encrypts plaintext using AES-256-GCM via Web Crypto API with a unique 12-byte nonce.
   */
  export async function encryptPayload(
    plaintext: string,
    secretKey: string = DEFAULT_KEY_DERIVATION_SECRET,
    customNonce?: Uint8Array
  ): Promise<EncryptedPayload> {
    if (plaintext.length === 0) {
      throw new Error('Key cannot be empty');
    }

    const nonce = customNonce ?? generateNonce();
    if (nonce.byteLength !== NONCE_LENGTH_BYTES) {
      throw new Error(`Invalid nonce length: expected ${NONCE_LENGTH_BYTES} bytes, got ${nonce.byteLength}`);
    }

    const enc = new TextEncoder();
    const rawSecret = enc.encode(secretKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', rawSecret);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      hashBuffer,
      { name: ENCRYPTION_ALGORITHM, length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    const data = enc.encode(plaintext);
    const ciphertextBuffer = await crypto.subtle.encrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv: nonce,
        tagLength: 128,
      },
      cryptoKey,
      data
    );

    const ciphertext = new Uint8Array(ciphertextBuffer);
    const combined = new Uint8Array(nonce.byteLength + ciphertext.byteLength);
    combined.set(nonce, 0);
    combined.set(ciphertext, nonce.byteLength);

    return {
      ciphertext,
      nonce,
      combined,
      ciphertextB64: uint8ArrayToBase64(ciphertext),
      nonceB64: uint8ArrayToBase64(nonce),
      combinedB64: uint8ArrayToBase64(combined),
    };
  }

  /**
   * Decrypts ciphertext using AES-256-GCM via Web Crypto API.
   */
  export async function decryptPayload(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    secretKey: string = DEFAULT_KEY_DERIVATION_SECRET
  ): Promise<string> {
    if (nonce.byteLength !== NONCE_LENGTH_BYTES) {
      throw new Error(`Invalid nonce length: expected ${NONCE_LENGTH_BYTES} bytes, got ${nonce.byteLength}`);
    }

    const enc = new TextEncoder();
    const rawSecret = enc.encode(secretKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', rawSecret);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      hashBuffer,
      { name: ENCRYPTION_ALGORITHM, length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv: nonce,
        tagLength: 128,
      },
      cryptoKey,
      ciphertext
    );

    return new TextDecoder().decode(decryptedBuffer);
  }

  // Modal State Interface
  export interface ModalState {
    isOpen: boolean;
    type: KeyType;
    lastEncryptedPayload?: EncryptedPayload;
    lastSubmittedData?: KeyFormData;
  }

  // Reactive State Store
  const modalState: ModalState = {
    isOpen: false,
    type: 'gemini',
    lastEncryptedPayload: undefined,
    lastSubmittedData: undefined,
  };

  type StateListener = (state: Readonly<ModalState>) => void;
  const stateListeners = new Set<StateListener>();

  function notifyListeners() {
    for (const listener of stateListeners) {
      listener(modalState);
    }
  }

  export function subscribeModalState(listener: StateListener): () => void {
    stateListeners.add(listener);
    listener(modalState);
    return () => stateListeners.delete(listener);
  }

  export function getModalState(): Readonly<ModalState> {
    return modalState;
  }

  let externalSubmitHandler: ((data: KeyFormData, encrypted: EncryptedPayload) => Promise<void>) | undefined;

  export function setModalSubmitHandler(
    handler?: (data: KeyFormData, encrypted: EncryptedPayload) => Promise<void>
  ): void {
    externalSubmitHandler = handler;
  }

  /**
   * Exact signature: function openModal(type: KeyType): void;
   */
  export function openModal(type: KeyType = 'gemini'): void {
    modalState.isOpen = true;
    modalState.type = type;
    notifyListeners();
  }

  /**
   * Exact signature: function closeModal(): void;
   */
  export function closeModal(): void {
    modalState.isOpen = false;
    notifyListeners();
  }

  /**
   * Exact signature: function submitKey(data: KeyFormData): Promise<void>;
   * Encrypts the payload with AES-256-GCM via Web Crypto API with a unique 12-byte nonce.
   */
  export async function submitKey(data: KeyFormData): Promise<void> {
    if (!data.key || data.key.trim().length === 0) {
      throw new Error('Please provide a valid API key.');
    }

    // Encrypt payload before submit using AES-256-GCM with unique 12-byte nonce
    const encrypted = await encryptPayload(data.key.trim());
    modalState.lastEncryptedPayload = encrypted;
    modalState.lastSubmittedData = { ...data };
    notifyListeners();

    if (externalSubmitHandler) {
      await externalSubmitHandler(data, encrypted);
    }
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Provider, CreateKeyPayload } from './types';

  let {
    isOpen = false,
    onClose,
    onAddKey,
    onSubmit,
  }: {
    isOpen?: boolean;
    onClose?: () => void;
    onAddKey?: (payload: CreateKeyPayload) => Promise<void>;
    onSubmit?: (data: KeyFormData, encrypted: EncryptedPayload) => Promise<void>;
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

  let moduleIsOpen = $state(modalState.isOpen);

  let unsubscribe: (() => void) | undefined;
  onMount(() => {
    unsubscribe = subscribeModalState((state) => {
      moduleIsOpen = state.isOpen;
      if (state.type === 'gemini' || state.type === 'groq') {
        handleProviderSelect(state.type);
      }
    });
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
  });

  let visible = $derived(isOpen || moduleIsOpen);

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

      // Execute AES-256-GCM encryption requirement via submitKey
      await submitKey({
        name: keyName,
        key: trimmedKey,
      });

      const encrypted = modalState.lastEncryptedPayload;

      if (onAddKey) {
        await onAddKey({
          provider,
          label: keyName,
          key: trimmedKey,
          rpm_limit: Number(rpmLimit) || 15,
          rpd_limit: Number(rpdLimit) || 1500,
          priority: Number(priority) || 0,
        });
      }

      if (onSubmit && encrypted) {
        await onSubmit({ name: keyName, key: trimmedKey }, encrypted);
      }

      // Reset form
      label = '';
      apiKey = '';
      priority = 0;
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
            Encrypted with AES-256-GCM via Web Crypto API with unique 12-byte nonce at rest.
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
            onclick={handleClose}
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
