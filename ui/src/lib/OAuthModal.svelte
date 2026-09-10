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

  let isVerifying = $state(false);
  let isDemoLaunching = $state(false);

  function handleGithubAuth() {
    isVerifying = true;
    setTimeout(() => {
      onSimulateLogin('collective-dev', 'builder');
      isVerifying = false;
      onClose();
    }, 800);
  }

  function handleLaunchDemo() {
    isDemoLaunching = true;
    setTimeout(() => {
      onSimulateLogin('ephemeral-guest', 'demo');
      isDemoLaunching = false;
      onClose();
    }, 500);
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <!-- Backdrop -->
    <div
      class="fixed inset-0 bg-[#090B10]/85 backdrop-blur-xl transition-opacity"
      onclick={onClose}
      onkeydown={(e) => e.key === 'Escape' && onClose()}
      role="button"
      tabindex="-1"
      aria-label="Close modal backdrop"
    ></div>

    <!-- Modal Content: Stitch Screen 3 Architecture -->
    <div
      class="relative w-full max-w-lg glass-raised specular-border rounded-2xl shadow-2xl overflow-hidden z-10 flex flex-col font-sans"
    >
      <!-- Modal Header -->
      <div class="p-6 pb-4 border-b border-white/[0.08] flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <h2 class="text-base font-bold text-white tracking-tight">Developer Gateway & Sybil Gate</h2>
            <p class="text-xs text-slate-400 font-mono">Strict 1-Developer 1-Account Quota Provisioning</p>
          </div>
        </div>

        <button
          type="button"
          onclick={onClose}
          class="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
          aria-label="Close modal"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- Modal Body -->
      <div class="p-6 space-y-5 text-xs font-mono">
        <!-- Trust Score Ring Indicator -->
        <div class="p-4 rounded-xl bg-[#090B10]/70 border border-white/[0.06] flex items-center justify-between gap-4">
          <div class="space-y-1">
            <span class="text-[10px] text-slate-400 uppercase tracking-wider">Anti-Sybil Verification Score</span>
            <div class="text-base font-bold text-emerald-400 font-mono flex items-center gap-2">
              <span>98 / 100</span>
              <span class="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-normal">
                Tier 1 Verified
              </span>
            </div>
            <p class="text-[11px] text-slate-400">Allocated Quota: 60 RPM / 10,000 RPD Virtual Headroom</p>
          </div>
          <div class="w-12 h-12 rounded-full border-2 border-emerald-400/40 flex items-center justify-center text-emerald-400 text-xs font-bold">
            98%
          </div>
        </div>

        <!-- 5-Layer Anti-Sybil Verification Matrix -->
        <div class="space-y-2">
          <span class="text-[11px] text-slate-400 uppercase tracking-wider block">5-Layer Anti-Sybil Proofs</span>
          <div class="grid grid-cols-1 gap-1.5">
            <div class="p-2 rounded bg-white/[0.02] border border-white/[0.04] flex items-center justify-between">
              <span class="text-slate-300">1. GitHub Account Age (&gt;90d)</span>
              <span class="text-emerald-400 font-medium">Active: 420d (PASS)</span>
            </div>
            <div class="p-2 rounded bg-white/[0.02] border border-white/[0.04] flex items-center justify-between">
              <span class="text-slate-300">2. Commit Velocity (&gt;15 commits/yr)</span>
              <span class="text-emerald-400 font-medium">84 commits (PASS)</span>
            </div>
            <div class="p-2 rounded bg-white/[0.02] border border-white/[0.04] flex items-center justify-between">
              <span class="text-slate-300">3. Cloudflare Turnstile Challenge</span>
              <span class="text-emerald-400 font-medium">Token Verified (PASS)</span>
            </div>
            <div class="p-2 rounded bg-white/[0.02] border border-white/[0.04] flex items-center justify-between">
              <span class="text-slate-300">4. Disposable Email MX Filter</span>
              <span class="text-emerald-400 font-medium">Clean MX (PASS)</span>
            </div>
            <div class="p-2 rounded bg-white/[0.02] border border-white/[0.04] flex items-center justify-between">
              <span class="text-slate-300">5. Subnet Velocity &amp; ASN Rate</span>
              <span class="text-emerald-400 font-medium">Residential IP (PASS)</span>
            </div>
          </div>
        </div>

        <!-- Primary Actions -->
        <div class="space-y-3 pt-2">
          <button
            type="button"
            onclick={handleGithubAuth}
            disabled={isVerifying}
            class="w-full py-2.5 px-4 rounded-xl bg-[#24292F] hover:bg-[#2F363D] text-white font-mono text-xs font-semibold shadow-lg border border-white/10 transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50"
          >
            {#if isVerifying}
              <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span>Verifying PKCE Challenge...</span>
            {:else}
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              <span>Continue with GitHub (PKCE Challenge)</span>
            {/if}
          </button>

          <button
            type="button"
            onclick={handleLaunchDemo}
            disabled={isDemoLaunching}
            class="w-full py-2.5 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 font-mono text-xs border border-white/[0.08] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {#if isDemoLaunching}
              <svg class="w-3.5 h-3.5 animate-spin text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span>Spawning DemoDO Isolate...</span>
            {:else}
              <span class="text-cyan-400">⚡</span>
              <span>Launch 15-Min Ephemeral Sandbox (No Auth)</span>
            {/if}
          </button>
        </div>

        <p class="text-[10px] text-slate-500 text-center pt-1">
          Protected by Cloudflare Edge Isolates &amp; Web Crypto AES-256-GCM. Zero telemetry leakage.
        </p>
      </div>
    </div>
  </div>
{/if}
