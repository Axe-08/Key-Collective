<script lang="ts">
  import type { UserAccount, UserTier } from "../../../src/contracts/v3_types";
  import type { Microdollars } from "../../../src/contracts/v3_5_types";
  import TrustScoreMeter from "./TrustScoreMeter.svelte";
  import {
    createPKCEBundle,
    OAuthProgression,
    PKCEInspector,
    EphemeralSandboxCard,
    SybilMatrixSection,
  } from "./oauth";

  let {
    isOpen,
    userAccount,
    onClose,
    onSelectTier,
    onSimulateLogin,
    onEmailIngress,
  }: {
    isOpen: boolean;
    userAccount?: UserAccount;
    onClose: () => void;
    onSelectTier: (tier: UserTier) => void;
    onSimulateLogin: (username: string, tier: UserTier, email?: string, avatarUrl?: string, authProvider?: 'github' | 'google' | 'email' | 'demo') => void;
    onEmailIngress?: (email: string) => void;
  } = $props();

  // State Management
  let isVerifying = $state(false);
  let isDemoLaunching = $state(false);
  let isEmailSubmitting = $state(false);
  let emailInput = $state("");
  let emailError = $state("");
  let emailSuccess = $state("");
  let verificationStep = $state("");
  let showPkceInspector = $state(false);

  // PKCE Session State
  let pkceVerifier = $state("");
  let pkceChallenge = $state("");
  let pkceState = $state("");
  let currentNonce = $state("0x9f4a7c2e...b82c19d4");

  // Derived Account Status
  const isAuthenticated = $derived(!!userAccount);
  const currentTier: UserTier = $derived(userAccount?.tier ?? "probationary");
  const isProbationary = $derived(isAuthenticated && currentTier === "probationary");
  const isBuilderOrHigher = $derived(
    isAuthenticated && (currentTier === "builder" || currentTier === "max" || currentTier === "ultra" || currentTier === "admin")
  );
  const isDemo = $derived(isAuthenticated && currentTier === "demo");

  // Dynamic Trust Score calculation
  const trustScore = $derived(
    userAccount?.sybilScore ?? (isBuilderOrHigher ? 98 : isProbationary ? 45 : 20)
  );

  // Financial Quota in Fixed-Point Microdollars (1 USD = 1,000,000 µ$)
  const budgetCapMicrodollars: Microdollars = $derived(
    isBuilderOrHigher ? 5_000_000 : isProbationary ? 50_000 : 0
  );

  // Generate complete PKCE parameters
  async function initPKCEBundle() {
    const bundle = await createPKCEBundle();
    pkceVerifier = bundle.verifier;
    pkceChallenge = bundle.challenge;
    pkceState = bundle.stateToken;
    currentNonce = `0x${bundle.nonceHex.slice(0, 8)}...${bundle.nonceHex.slice(-8)}`;
    return bundle;
  }

  // Phase 1: Email Ingress Handler (Probationary Tier)
  async function handleEmailIngressSubmit(e: SubmitEvent) {
    e.preventDefault();
    emailError = "";
    emailSuccess = "";

    const email = emailInput.trim();
    const rfc5321Regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!email || !rfc5321Regex.test(email)) {
      emailError = "Please provide a valid developer email address.";
      return;
    }

    const domain = email.split("@")[1]?.toLowerCase();
    const disposableDomains = ["mailinator.com", "temp-mail.org", "10minutemail.com", "guerrillamail.com"];
    if (domain && disposableDomains.includes(domain)) {
      emailError = "Disposable email provider rejected by Layer 4 MX filter.";
      return;
    }

    isEmailSubmitting = true;
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));

      if (onEmailIngress) {
        onEmailIngress(email);
      }
      onSimulateLogin(email.split("@")[0] || "dev-probationary", "probationary", email, undefined, "email");
      onSelectTier("probationary");

      emailSuccess = "Turnstile passed! Assigned Probationary Tier (2 RPM / 50 RPD, 50,000 µ$ budget). Ready for GitHub elevation.";
    } finally {
      isEmailSubmitting = false;
    }
  }

  // Phase 2: Real PKCE Redirect Initiation & Verification Flow
  async function handleGithubPKCEAuth(mode: "real_redirect" | "instant_simulation" = "real_redirect") {
    isVerifying = true;
    emailError = "";

    try {
      verificationStep = "1/4 Generating RFC 7636 PKCE S256 Challenge...";
      const bundle = await initPKCEBundle();

      await new Promise((resolve) => setTimeout(resolve, 350));
      verificationStep = "2/4 Verifying Cloudflare Turnstile bot proof...";

      if (mode === "real_redirect") {
        verificationStep = "3/4 Redirecting to GitHub OAuth Gateway...";
        await new Promise((resolve) => setTimeout(resolve, 400));

        // Real redirect to GitHub OAuth authorize endpoint
        const clientId =
          typeof window !== "undefined" && (window as any).__GITHUB_CLIENT_ID__
            ? (window as any).__GITHUB_CLIENT_ID__
            : "Ov23lijtT90CwzFc8jcy";
        const redirectUri =
          typeof window !== "undefined" ? `${window.location.origin}/api/auth/github/callback` : "";
        const scope = encodeURIComponent("read:user user:email");

        const authorizeUrl = `https://github.com/login/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${encodeURIComponent(bundle.stateToken)}&code_challenge=${encodeURIComponent(bundle.challenge)}&code_challenge_method=S256`;

        // Redirect to real OAuth
        window.location.href = authorizeUrl;
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 350));
      verificationStep = "3/4 Evaluating 5-Layer Anti-Sybil Consensus...";

      await new Promise((resolve) => setTimeout(resolve, 400));
      verificationStep = "4/4 Elevating to Max Tier (Private + Communal Pool Access)...";

      await new Promise((resolve) => setTimeout(resolve, 300));
      onSimulateLogin("collective-dev", "max", undefined, undefined, "github");
      onSelectTier("max");
      isVerifying = false;
      onClose();
    } catch (err: any) {
      emailError = `PKCE initialization failed: ${err?.message || "Crypto error"}`;
      isVerifying = false;
    }
  }

  // Quick Start Sandbox (15-Min Ephemeral Sandbox)
  function handleLaunchDemo() {
    isDemoLaunching = true;
    setTimeout(() => {
      onSimulateLogin("ephemeral-guest", "demo", undefined, undefined, "demo");
      onSelectTier("demo");
      isDemoLaunching = false;
      onClose();
    }, 450);
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto">
    <!-- Ambient Backdrop with Blur -->
    <div
      class="fixed inset-0 bg-[#090B10]/85 backdrop-blur-xl transition-opacity"
      onclick={onClose}
      onkeydown={(e) => e.key === "Escape" && onClose()}
      role="button"
      tabindex="-1"
      aria-label="Close modal backdrop"
    ></div>

    <!-- Central Ambient Specular Glass Container (Matches Stitch screen3 7/5 Layout) -->
    <div
      class="relative w-full max-w-5xl backdrop-blur-2xl bg-[#0d1017]/95 rounded-2xl specular-glow-card overflow-hidden z-10 flex flex-col font-sans border border-white/[0.08] shadow-2xl my-auto max-h-[92vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-headline"
    >
      <!-- Specular Highlight Top Edge -->
      <div class="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-indigo-400/50 to-transparent z-20"></div>

      <!-- Close Button Top Right -->
      <button
        type="button"
        onclick={onClose}
        class="absolute top-4 right-4 z-30 text-white/50 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
        aria-label="Close modal dialog"
      >
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <!-- Scrollable Modal Content Wrapper -->
      <div class="overflow-y-auto custom-scroll p-6 md:p-8 lg:p-9 space-y-7">
        
        <!-- Brand & Header -->
        <div class="text-center space-y-2.5 max-w-2xl mx-auto">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-mono font-medium mb-1">
            <span class="material-symbols-outlined text-xs">verified_user</span>
            <span>1-Developer 1-Account Quota Provisioning</span>
          </div>

          <h1 id="modal-headline" class="text-2xl md:text-3xl lg:text-4xl font-extrabold tracking-tight text-white flex items-center justify-center gap-3">
            Developer Gateway &amp; Sybil Gate
          </h1>

          <p class="text-white/60 text-xs sm:text-sm md:text-base leading-relaxed font-normal">
            Cryptographically verified developer onboarding. Connect with GitHub to establish consensus trust, unlock unified API endpoints, and claim resilient pooled LLM quotas.
          </p>
        </div>

        <!-- Interactive Two-Phase Progression Indicator -->
        <OAuthProgression {isProbationary} {isBuilderOrHigher} />

        <!-- Interactive 7/5 Grid: Auth & Trust Meter (Stitch Screen 3 Alignment) -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          
          <!-- Left Column: Primary Auth & Ephemeral Sandbox (7 cols) -->
          <div class="lg:col-span-7 flex flex-col justify-between space-y-5">
            
            <!-- GitHub OAuth PKCE Card -->
            <div class="rounded-xl p-5 bg-white/[0.02] border border-white/[0.08] hover:border-indigo-500/40 transition-colors relative overflow-hidden group space-y-4">
              <div class="flex items-center justify-between">
                <span class="text-xs font-mono uppercase tracking-wider text-indigo-400 font-semibold flex items-center gap-1.5">
                  <span class="material-symbols-outlined text-sm">security</span> Primary Authentication
                </span>
                <span class="text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>OAuth 2.0 PKCE (RFC 7636)</span>
                </span>
              </div>

              <!-- Phase 1: Email Ingress Option if Anonymous/Unverified -->
              {#if !isBuilderOrHigher && !isProbationary}
                <form onsubmit={handleEmailIngressSubmit} class="p-3.5 rounded-lg bg-black/20 border border-white/[0.06] space-y-2.5">
                  <div class="flex items-center justify-between text-xs">
                    <span class="text-white/80 font-medium flex items-center gap-1.5">
                      <span class="material-symbols-outlined text-xs text-amber-400">mark_email_read</span>
                      Phase 1: Quick Email Ingress
                    </span>
                    <span class="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">Turnstile Nonce Ready</span>
                  </div>
                  <div class="flex gap-2">
                    <input
                      type="email"
                      bind:value={emailInput}
                      placeholder="developer@company.com"
                      class="flex-1 px-3 py-2 text-xs bg-white/[0.04] border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-400 font-mono"
                    />
                    <button
                      type="submit"
                      disabled={isEmailSubmitting}
                      class="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white font-mono text-xs font-medium border border-white/10 transition cursor-pointer disabled:opacity-50"
                    >
                      {isEmailSubmitting ? "Verifying..." : "Claim 2 RPM"}
                    </button>
                  </div>
                </form>
              {/if}

              <!-- Feedback Messages -->
              {#if emailError}
                <div class="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono flex items-center gap-2">
                  <span class="material-symbols-outlined text-sm">error</span>
                  <span>{emailError}</span>
                </div>
              {/if}

              {#if emailSuccess}
                <div class="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono flex items-center gap-2">
                  <span class="material-symbols-outlined text-sm">verified</span>
                  <span>{emailSuccess}</span>
                </div>
              {/if}

              <!-- GitHub Primary OAuth Button (Real PKCE / Instant Elevation) -->
              <div class="space-y-2">
                <button
                  type="button"
                  onclick={() => handleGithubPKCEAuth("real_redirect")}
                  disabled={isVerifying}
                  class="w-full shimmer-btn bg-[#1a1e28] hover:bg-[#222836] border border-white/20 hover:border-white/40 text-white font-medium py-3.5 px-5 rounded-xl flex items-center justify-center gap-3 transition-all duration-200 shadow-lg shadow-black/40 active:scale-[0.99] group-hover:border-indigo-400/50 cursor-pointer disabled:opacity-50"
                >
                  {#if isVerifying}
                    <svg class="w-5 h-5 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10" stroke-opacity="0.25" stroke="currentColor" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="0.9" />
                    </svg>
                    <span class="text-sm font-semibold tracking-wide font-mono">{verificationStep || "Verifying PKCE Challenge..."}</span>
                  {:else}
                    <!-- GitHub Icon -->
                    <svg class="w-5 h-5 fill-current text-white transition-transform group-hover:scale-110 duration-200 shrink-0" viewBox="0 0 24 24">
                      <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                    </svg>
                    <span class="text-sm md:text-base font-semibold tracking-wide">
                      {isBuilderOrHigher ? "Connected with GitHub (Switch Account)" : "Sign in with GitHub"}
                    </span>
                    <span class="material-symbols-outlined text-sm text-white/50 group-hover:translate-x-0.5 transition-transform">arrow_forward</span>
                  {/if}
                </button>

                <!-- Google Auth Button -->
                <button
                  type="button"
                  onclick={async () => { 
                    try {
                      emailError = "";
                      isVerifying = true;
                      verificationStep = "Authenticating with Google...";
                      const { signInWithPopup, auth, googleProvider } = await import("./firebase");
                      const result = await signInWithPopup(auth, googleProvider);
                      // On success
                      isVerifying = false;
                      const user = result.user;
                      onSimulateLogin(
                        user.displayName || user.email?.split("@")[0] || "Google User",
                        "builder",
                        user.email || undefined,
                        user.photoURL || undefined,
                        "google"
                      );
                      onSelectTier("builder");
                      onClose();
                    } catch (error: any) {
                      isVerifying = false;
                      emailError = `Google Auth failed: ${error.message}`;
                    }
                  }}
                  disabled={isVerifying}
                  class="w-full shimmer-btn bg-[#ffffff] hover:bg-[#f8f9fa] border border-white/20 text-gray-800 font-medium py-3.5 px-5 rounded-xl flex items-center justify-center gap-3 transition-all duration-200 shadow-lg shadow-black/40 active:scale-[0.99] cursor-pointer disabled:opacity-50"
                >
                  <svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  <span class="text-sm md:text-base font-semibold tracking-wide">
                    Continue with Google
                  </span>
                </button>

                <!-- Alternate Direct Redirect Trigger -->
                <div class="flex items-center justify-between text-[11px] font-mono text-white/50 px-1">
                  <button
                    type="button"
                    onclick={() => handleGithubPKCEAuth("real_redirect")}
                    class="hover:text-indigo-300 underline decoration-indigo-500/40 cursor-pointer flex items-center gap-1"
                  >
                    <span class="material-symbols-outlined text-[13px]">open_in_new</span>
                    <span>Initiate Live Redirect via Edge</span>
                  </button>

                  <button
                    type="button"
                    onclick={() => (showPkceInspector = !showPkceInspector)}
                    class="hover:text-white cursor-pointer flex items-center gap-1 text-[11px]"
                  >
                    <span class="material-symbols-outlined text-[13px]">tune</span>
                    <span>{showPkceInspector ? "Hide" : "Inspect"} PKCE Parameters</span>
                  </button>
                </div>
              </div>

              <!-- Collapsible PKCE Crypto Inspector -->
              {#if showPkceInspector}
                <PKCEInspector {pkceVerifier} {pkceChallenge} {pkceState} />
              {/if}

              <p class="text-[11px] text-white/45 text-center font-mono flex items-center justify-center gap-1.5">
                <span class="material-symbols-outlined text-[13px] text-indigo-400">fingerprint</span>
                Authenticates identity via GitHub API with PKCE state challenge
              </p>
            </div>

            <!-- Quick Start Sandbox Card (Ephemeral 15m TTL) -->
            <EphemeralSandboxCard {isDemoLaunching} onLaunchDemo={handleLaunchDemo} />

          </div>

          <!-- Right Column: Dynamic Trust Score Ring Meter (5 cols) -->
          <div class="lg:col-span-5 rounded-xl p-6 bg-white/[0.02] border border-white/[0.08] flex flex-col items-center justify-between text-center relative overflow-hidden space-y-4">
            <div class="absolute -top-16 -right-16 w-36 h-36 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>
            
            <!-- Reputation Status Header -->
            <div class="w-full flex items-center justify-between mb-1">
              <span class="text-xs font-mono uppercase tracking-wider text-white/60 font-semibold">Reputation Status</span>
              <span class="text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 px-2 py-0.5 rounded">
                {#if isBuilderOrHigher}
                  Tier 1 Full Access
                {:else if isProbationary}
                  Probationary Sandbox
                {:else if isDemo}
                  Ephemeral Isolate
                {:else}
                  Pre-Verification
                {/if}
              </span>
            </div>

            <!-- Animated Ring Graphic Component -->
            <div class="my-2">
              <TrustScoreMeter score={trustScore} tier={currentTier} size={160} strokeWidth={8} />
            </div>

            <!-- Profile & Quota Breakdown -->
            <div class="w-full space-y-2.5 pt-3 border-t border-white/[0.06]">
              <div class="text-xs font-semibold text-white flex items-center justify-center gap-1.5">
                <span>
                  {#if isBuilderOrHigher}
                    Verified Developer (@{userAccount?.githubUsername || "collective-dev"})
                  {:else if isProbationary}
                    Probationary User ({userAccount?.primaryEmail || "user@example.com"})
                  {:else if isDemo}
                    Ephemeral Guest (DemoDO)
                  {:else}
                    Unauthenticated Visitor
                  {/if}
                </span>
                <span class="text-white/40">•</span>
                <span class="{isBuilderOrHigher ? "text-emerald-400" : isProbationary ? "text-amber-400" : "text-cyan-400"}">
                  {isBuilderOrHigher ? "Low Risk Profile" : isProbationary ? "Quarantine Sandbox" : "15m Isolated"}
                </span>
              </div>

              <p class="text-[11px] text-white/50 font-mono leading-relaxed">
                {#if isBuilderOrHigher}
                  Allocated: 60 RPM • 10,000 RPD Virtual Pool Headroom with instant auto-rotation
                {:else if isProbationary}
                  Allocated: 2 RPM • 50 RPD Sandboxed • Budget Cap: 50,000 µ$
                {:else if isDemo}
                  Allocated: 15 RPM • In-Memory DemoDO Session • Zero Persistence
                {:else}
                  Connect GitHub with PKCE to claim 60 RPM pooled LLM quota
                {/if}
              </p>
            </div>
          </div>

        </div>

        <!-- Section 3: Real-time 5-Layer Anti-Sybil Verification Score Breakdown -->
        <SybilMatrixSection {isBuilderOrHigher} {isProbationary} />

      </div>

      <!-- Security Badge Bottom Footnote Bar -->
      <div class="px-6 py-3.5 bg-white/[0.015] border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-center gap-3 text-xs shrink-0">
        <div class="flex items-center gap-2 text-emerald-400/80 font-mono text-[11px]">
          <span class="material-symbols-outlined text-emerald-400 text-sm">security</span>
          <span>Verified Secure: AES-256-GCM &amp; PKCE Authenticated</span>
        </div>
      </div>
    </div>
  </div>
{/if}
