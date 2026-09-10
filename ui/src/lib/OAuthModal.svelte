<script lang="ts">
  import type { UserAccount, UserTier } from '../../../src/contracts/v3_types';

  let {
    isOpen,
    userAccount,
    onClose,
    onSelectTier,
    onSimulateLogin,
  }: {
    isOpen: boolean;
    userAccount?: UserAccount;
    onClose: () => void;
    onSelectTier: (tier: UserTier) => void;
    onSimulateLogin: (username: string, tier: UserTier) => void;
  } = $props();

  let customUsername = $state('developer-ace');
  let selectedTier = $state<UserTier>('builder');
  let isConnecting = $state(false);

  $effect(() => {
    if (userAccount?.tier) {
      selectedTier = userAccount.tier;
    }
    if (userAccount?.githubUsername) {
      customUsername = userAccount.githubUsername;
    }
  });

  function handleLogin() {
    isConnecting = true;
    setTimeout(() => {
      onSimulateLogin(customUsername, selectedTier);
      isConnecting = false;
      onClose();
    }, 600);
  }

  function handleTierChange(tier: UserTier) {
    selectedTier = tier;
    onSelectTier(tier);
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <!-- Backdrop -->
    <div
      class="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
      onclick={onClose}
      onkeydown={(e) => e.key === 'Escape' && onClose()}
      role="button"
      tabindex="-1"
      aria-label="Close modal backdrop"
    ></div>

    <!-- Modal Content -->
    <div
      class="relative w-full max-w-lg rounded-2xl bg-[#0d111a] border border-white/[0.1] shadow-2xl overflow-hidden z-10 flex flex-col font-sans"
      role="dialog"
      aria-modal="true"
      aria-labelledby="oauth-modal-title"
    >
      <!-- Header with Charcoal Gradient -->
      <div class="p-6 border-b border-white/[0.08] bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center text-white">
              <svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
            </div>
            <div>
              <h2 id="oauth-modal-title" class="text-lg font-bold text-white tracking-tight">GitHub OAuth & Tier Access</h2>
              <p class="text-xs text-slate-400 font-mono">1-Person-1-Account Anti-Sybil Verification</p>
            </div>
          </div>
          <button
            type="button"
            onclick={onClose}
            class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close dialog"
          >
            <svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Body -->
      <div class="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
        <!-- 5-Layer Anti-Sybil Shield Indicators -->
        <div class="rounded-xl bg-slate-900/80 border border-white/[0.08] p-4 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-mono font-semibold uppercase tracking-wider text-indigo-400">🛡️ 5-Layer Anti-Sybil Validation</span>
            <span class="text-xs font-mono text-emerald-400 font-bold">Active Shield</span>
          </div>
          <div class="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-300">
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>1. Cloudflare Turnstile</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>2. IP Subnet Velocity</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>3. Disposable Email Guard</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>4. GitHub Maturity &gt;30d</span>
            </div>
          </div>
          <div class="text-[11px] text-slate-400 border-t border-white/5 pt-2">
            Prevents quota farming by binding 1 root account per human developer.
          </div>
        </div>

        <!-- Tier Switcher for Testing/Demonstration -->
        <div class="space-y-2">
          <span class="block text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
            Authorization Level & Quota Tier
          </span>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {#each ['admin', 'ultra', 'max', 'builder', 'probationary', 'demo'] as tier}
              <button
                type="button"
                onclick={() => handleTierChange(tier as UserTier)}
                class="px-3 py-2 rounded-lg text-xs font-mono font-semibold border transition-all text-left flex flex-col justify-between {selectedTier === tier ? 'bg-indigo-600/30 border-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-900/50 border-white/[0.08] text-slate-400 hover:text-slate-200 hover:border-white/20'}"
              >
                <span class="capitalize">{tier}</span>
                <span class="text-[10px] font-normal text-slate-500 mt-1">
                  {tier === 'admin' ? 'Unlimited / 👑' : tier === 'ultra' ? 'Unlimited / ⚡' : tier === 'max' ? '60 RPM / 10k' : tier === 'builder' ? '20 RPM / 2k' : tier === 'probationary' ? '2 RPM / 50' : 'Shared / 3 RPM'}
                </span>
              </button>
            {/each}
          </div>
        </div>

        <!-- Username Form -->
        <div class="space-y-2">
          <label for="gh-username" class="block text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
            GitHub Username Handle
          </label>
          <div class="relative">
            <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 font-mono text-sm">@</span>
            <input
              id="gh-username"
              type="text"
              bind:value={customUsername}
              class="w-full pl-8 pr-3 py-2 rounded-lg bg-slate-950 border border-white/[0.1] text-white text-sm font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="github-handle"
            />
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="p-6 border-t border-white/[0.08] bg-slate-950/60 flex items-center justify-between gap-3">
        <button
          type="button"
          onclick={onClose}
          class="px-4 py-2 rounded-lg text-xs font-mono text-slate-400 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handleLogin}
          disabled={isConnecting}
          class="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-mono font-bold shadow-lg shadow-indigo-600/30 border border-indigo-400/30 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
        >
          {#if isConnecting}
            <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            <span>Verifying Anti-Sybil...</span>
          {:else}
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            <span>Authorize & Apply Tier</span>
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
