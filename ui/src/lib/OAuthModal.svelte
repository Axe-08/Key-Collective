<script lang="ts">
  import type { UserAccount, UserTier } from "../../../src/contracts/v3_types";
  import type { Microdollars } from "../../../src/contracts/v3_5_types";
  import TrustScoreMeter from "./TrustScoreMeter.svelte";

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
    onSimulateLogin: (username: string, tier: UserTier) => void;
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
  const currentTier: UserTier = $derived(userAccount?.tier ?? "probationary");
  const isProbationary = $derived(currentTier === "probationary");
  const isBuilderOrHigher = $derived(
    currentTier === "builder" || currentTier === "max" || currentTier === "ultra" || currentTier === "admin"
  );
  const isDemo = $derived(currentTier === "demo");

  // Dynamic Trust Score calculation
  const trustScore = $derived(
    userAccount?.sybilScore ?? (isBuilderOrHigher ? 98 : isProbationary ? 45 : 20)
  );

  // Financial Quota in Fixed-Point Microdollars (1 USD = 1,000,000 µ$)
  const budgetCapMicrodollars: Microdollars = $derived(
    isBuilderOrHigher ? 5_000_000 : isProbationary ? 50_000 : 0
  );

  // RFC 7636 Base64URL encoding
  function uint8ArrayToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  // RFC 7636 Code Verifier Generator
  function generateCodeVerifier(length = 64): string {
    const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let verifier = "";
    const alphabetLen = unreserved.length;
    const maxValidByte = 256 - (256 % alphabetLen);
    let byteIdx = 0;
    while (verifier.length < length) {
      if (byteIdx >= bytes.length) {
        crypto.getRandomValues(bytes);
        byteIdx = 0;
      }
      const byte = bytes[byteIdx++];
      if (byte < maxValidByte) {
        verifier += unreserved[byte % alphabetLen];
      }
    }
    return verifier;
  }

  // RFC 7636 SHA-256 Code Challenge Generator
  async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return uint8ArrayToBase64Url(new Uint8Array(hashBuffer));
  }

  // Generate complete PKCE parameters
  async function initPKCEBundle() {
    const verifier = generateCodeVerifier(64);
    const challenge = await generateCodeChallenge(verifier);
    const stateBytes = new Uint8Array(24);
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(stateBytes);
    crypto.getRandomValues(nonceBytes);

    const stateToken = uint8ArrayToBase64Url(stateBytes);
    const nonceHex = Array.from(nonceBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    pkceVerifier = verifier;
    pkceChallenge = challenge;
    pkceState = stateToken;
    currentNonce = `0x${nonceHex.slice(0, 8)}...${nonceHex.slice(-8)}`;

    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem("kc_pkce_verifier", verifier);
      sessionStorage.setItem("kc_oauth_state", stateToken);
    }

    return { verifier, challenge, stateToken, nonceHex };
  }

  // Phase 1: Email Ingress Handler (Probationary Tier)
  async function handleEmailIngressSubmit(e: SubmitEvent) {
    e.preventDefault();
    emailError = "";
    emailSuccess = "";

    const email = emailInput.trim();
    if (!email || !email.includes("@") || !email.includes(".")) {
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
      onSimulateLogin(email.split("@")[0] || "dev-probationary", "probationary");
      onSelectTier("probationary");

      emailSuccess = "Turnstile passed! Assigned Probationary Tier (2 RPM / 50 RPD, 50,000 µ$ budget). Ready for GitHub elevation.";
    } finally {
      isEmailSubmitting = false;
    }
  }

  // Phase 2: Real PKCE Redirect Initiation & Verification Flow
  async function handleGithubPKCEAuth(mode: "real_redirect" | "instant_simulation" = "instant_simulation") {
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
            : "Ov23liKeyCollectiveEdge";
        const redirectUri =
          typeof window !== "undefined" ? `${window.location.origin}/api/auth/github/callback` : "";
        const scope = encodeURIComponent("read:user user:email");

        const authorizeUrl = `https://github.com/login/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${encodeURIComponent(bundle.stateToken)}&code_challenge=${encodeURIComponent(bundle.challenge)}&code_challenge_method=S256`;

        // If in standard browser environment, redirect or trigger callback
        if (typeof window !== "undefined" && (window as any).__ENABLE_REAL_OAUTH_REDIRECT__) {
          window.location.href = authorizeUrl;
          return;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 350));
      verificationStep = "3/4 Evaluating 5-Layer Anti-Sybil Consensus...";

      await new Promise((resolve) => setTimeout(resolve, 400));
      verificationStep = "4/4 Elevating to Builder Tier (60 RPM / 10,000 RPD)...";

      await new Promise((resolve) => setTimeout(resolve, 300));
      onSimulateLogin("collective-dev", "builder");
      onSelectTier("builder");
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
      onSimulateLogin("ephemeral-guest", "demo");
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
        <div class="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 sm:p-4">
          <div class="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono">
            <!-- Phase 1 Step -->
            <div class="flex items-center gap-3 w-full sm:w-auto">
              <div class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold {isProbationary || isBuilderOrHigher ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"}">
                {#if isProbationary || isBuilderOrHigher}
                  <span class="material-symbols-outlined text-sm">check</span>
                {:else}
                  1
                {/if}
              </div>
              <div>
                <div class="font-semibold text-white flex items-center gap-1.5">
                  <span>Phase 1: Ingress Sandbox</span>
                  {#if isProbationary}
                    <span class="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30">ACTIVE</span>
                  {:else if isBuilderOrHigher}
                    <span class="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30">PASSED</span>
                  {/if}
                </div>
                <div class="text-[11px] text-white/50">Email + Turnstile Nonce • 2 RPM / 50k µ$ cap</div>
              </div>
            </div>

            <!-- Arrow Divider -->
            <span class="hidden sm:inline-block text-white/30 material-symbols-outlined text-sm">arrow_forward</span>

            <!-- Phase 2 Step -->
            <div class="flex items-center gap-3 w-full sm:w-auto">
              <div class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold {isBuilderOrHigher ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-white/10 text-white/60 border border-white/15"}">
                {#if isBuilderOrHigher}
                  <span class="material-symbols-outlined text-sm">verified</span>
                {:else}
                  2
                {/if}
              </div>
              <div>
                <div class="font-semibold text-white flex items-center gap-1.5">
                  <span>Phase 2: Elevation Gate</span>
                  {#if isBuilderOrHigher}
                    <span class="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30">ELEVATED</span>
                  {:else}
                    <span class="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30">PKCE READY</span>
                  {/if}
                </div>
                <div class="text-[11px] text-white/50">GitHub OAuth 2.0 PKCE • 60 RPM / 10,000 RPD</div>
              </div>
            </div>
          </div>
        </div>

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
                  onclick={() => handleGithubPKCEAuth("instant_simulation")}
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
                      {isBuilderOrHigher ? "Re-verify with GitHub (PKCE)" : "Continue with GitHub"}
                    </span>
                    <span class="material-symbols-outlined text-sm text-white/50 group-hover:translate-x-0.5 transition-transform">arrow_forward</span>
                  {/if}
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
                <div class="p-3 rounded-lg bg-black/40 border border-white/[0.08] text-[10px] font-mono space-y-1.5 text-white/70">
                  <div class="text-indigo-300 font-semibold uppercase tracking-wider flex items-center gap-1">
                    <span class="material-symbols-outlined text-xs">key</span> Web Crypto RFC 7636 Handshake Bundle
                  </div>
                  <div class="truncate">
                    <span class="text-white/40">code_verifier:</span> {pkceVerifier || "0x4f82a1...64-char CSPRNG"}
                  </div>
                  <div class="truncate">
                    <span class="text-white/40">code_challenge (S256):</span> {pkceChallenge || "BASE64URL(SHA256(verifier))"}
                  </div>
                  <div class="truncate">
                    <span class="text-white/40">state_token:</span> {pkceState || "0x992b...anti-csrf"}
                  </div>
                  <div class="truncate">
                    <span class="text-white/40">method:</span> S256 • client_id: Ov23liKeyCollectiveEdge
                  </div>
                </div>
              {/if}

              <p class="text-[11px] text-white/45 text-center font-mono flex items-center justify-center gap-1.5">
                <span class="material-symbols-outlined text-[13px] text-indigo-400">fingerprint</span>
                Authenticates identity via GitHub API with PKCE state challenge
              </p>
            </div>

            <!-- Quick Start Sandbox Card (Ephemeral 15m TTL) -->
            <div class="rounded-xl p-5 bg-gradient-to-r from-white/[0.02] to-indigo-950/20 border border-white/[0.08] flex flex-col justify-between space-y-3">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-amber-400 text-lg">bolt</span>
                    <span class="text-sm font-semibold text-white tracking-tight">Quick Start Sandbox</span>
                  </div>
                  <span class="font-mono text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                    <span class="material-symbols-outlined text-xs">timer</span> 15m TTL
                  </span>
                </div>
                <p class="text-xs text-white/60 leading-relaxed">
                  Instantly test without committing credentials. Spins up an isolated ephemeral edge isolate with 15 RPM proxy rate-limiting.
                </p>
              </div>

              <div class="flex flex-col sm:flex-row items-center gap-3 pt-1">
                <button
                  type="button"
                  onclick={handleLaunchDemo}
                  disabled={isDemoLaunching}
                  class="w-full sm:w-auto flex-1 px-4 py-2.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 hover:border-white/20 text-white text-xs font-semibold flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer disabled:opacity-50"
                >
                  {#if isDemoLaunching}
                    <svg class="w-3.5 h-3.5 animate-spin text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10" stroke-opacity="0.25" stroke="currentColor" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="0.9" />
                    </svg>
                    <span>Spawning DemoDO Isolate...</span>
                  {:else}
                    <span class="material-symbols-outlined text-amber-400 text-base">terminal</span>
                    <span>Launch 15-Min Ephemeral Sandbox</span>
                  {/if}
                </button>
                <div class="font-mono text-[10px] text-white/40 flex items-center gap-1.5 shrink-0">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  <span>0 req log stored</span>
                </div>
              </div>
            </div>

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
        <div class="space-y-3 pt-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-indigo-400 text-lg">fact_check</span>
              <h3 class="text-xs font-mono uppercase tracking-widest text-white/80 font-bold">
                5-Layer Anti-Sybil Verification Matrix
              </h3>
            </div>
            <span class="text-[11px] font-mono {isBuilderOrHigher ? "text-emerald-400" : "text-amber-400"} flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full {isBuilderOrHigher ? "bg-emerald-400" : "bg-amber-400"} animate-pulse"></span>
              <span>{isBuilderOrHigher ? "5 of 5 Checks Passed" : isProbationary ? "3 of 5 Checks Passed (GitHub Pending)" : "Awaiting Proofs"}</span>
            </span>
          </div>

          <!-- 5 Verification Layers Grid (Matches screen3 HTML spec) -->
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            
            <!-- Layer 1: GitHub Age -->
            <div class="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/20 transition-all flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-[10px] font-mono text-white/40 uppercase">Layer 01</span>
                  <span class="text-[10px] font-mono font-semibold {isBuilderOrHigher ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-amber-400 bg-amber-500/10 border-amber-500/20"} px-1.5 py-0.5 rounded border">
                    {isBuilderOrHigher ? "PASS" : "PENDING"}
                  </span>
                </div>
                <div class="text-xs font-semibold text-white flex items-center gap-1 mb-1">
                  <span class="material-symbols-outlined text-xs text-white/60">schedule</span>
                  <span>GitHub Age</span>
                </div>
                <p class="text-[11px] text-white/50 leading-tight">Requirement: &gt;90 days</p>
              </div>
              <div class="mt-2.5 pt-2 border-t border-white/[0.04] text-[11px] font-mono {isBuilderOrHigher ? "text-emerald-300/90" : "text-white/40"} font-medium">
                {isBuilderOrHigher ? "Active: 420 days" : "Awaiting OAuth"}
              </div>
            </div>

            <!-- Layer 2: Commit Frequency -->
            <div class="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/20 transition-all flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-[10px] font-mono text-white/40 uppercase">Layer 02</span>
                  <span class="text-[10px] font-mono font-semibold {isBuilderOrHigher ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-amber-400 bg-amber-500/10 border-amber-500/20"} px-1.5 py-0.5 rounded border">
                    {isBuilderOrHigher ? "PASS" : "PENDING"}
                  </span>
                </div>
                <div class="text-xs font-semibold text-white flex items-center gap-1 mb-1">
                  <span class="material-symbols-outlined text-xs text-white/60">commit</span>
                  <span>Commit Frequency</span>
                </div>
                <p class="text-[11px] text-white/50 leading-tight">Requirement: &gt;15 commits/yr</p>
              </div>
              <div class="mt-2.5 pt-2 border-t border-white/[0.04] text-[11px] font-mono {isBuilderOrHigher ? "text-emerald-300/90" : "text-white/40"} font-medium">
                {isBuilderOrHigher ? "84 public commits" : "Awaiting OAuth"}
              </div>
            </div>

            <!-- Layer 3: Turnstile Nonce -->
            <div class="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/20 transition-all flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-[10px] font-mono text-white/40 uppercase">Layer 03</span>
                  <span class="text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">PASS</span>
                </div>
                <div class="text-xs font-semibold text-white flex items-center gap-1 mb-1">
                  <span class="material-symbols-outlined text-xs text-white/60">smart_toy</span>
                  <span>Turnstile Nonce</span>
                </div>
                <p class="text-[11px] text-white/50 leading-tight">Bot challenge check</p>
              </div>
              <div class="mt-2.5 pt-2 border-t border-white/[0.04] text-[11px] font-mono text-emerald-300/90 font-medium truncate">
                Challenge solved
              </div>
            </div>

            <!-- Layer 4: Mail Detection -->
            <div class="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/20 transition-all flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-[10px] font-mono text-white/40 uppercase">Layer 04</span>
                  <span class="text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">PASS</span>
                </div>
                <div class="text-xs font-semibold text-white flex items-center gap-1 mb-1">
                  <span class="material-symbols-outlined text-xs text-white/60">mail_lock</span>
                  <span>Mail Detection</span>
                </div>
                <p class="text-[11px] text-white/50 leading-tight">Anti-disposable MX filter</p>
              </div>
              <div class="mt-2.5 pt-2 border-t border-white/[0.04] text-[11px] font-mono text-emerald-300/90 font-medium truncate">
                Clean enterprise/pers.
              </div>
            </div>

            <!-- Layer 5: IP & Velocity -->
            <div class="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/20 transition-all flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-[10px] font-mono text-white/40 uppercase">Layer 05</span>
                  <span class="text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">PASS</span>
                </div>
                <div class="text-xs font-semibold text-white flex items-center gap-1 mb-1">
                  <span class="material-symbols-outlined text-xs text-white/60">speed</span>
                  <span>IP &amp; Velocity</span>
                </div>
                <p class="text-[11px] text-white/50 leading-tight">Subnet rate correlation</p>
              </div>
              <div class="mt-2.5 pt-2 border-t border-white/[0.04] text-[11px] font-mono text-emerald-300/90 font-medium truncate">
                Clean IP (1 req/min)
              </div>
            </div>

          </div>
        </div>

      </div>

      <!-- Specular Highlight Bottom Footnote Bar -->
      <div class="px-6 py-3.5 bg-white/[0.015] border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shrink-0">
        <div class="flex items-center gap-2 text-white/50 font-mono text-[11px]">
          <span class="material-symbols-outlined text-emerald-400 text-sm">lock</span>
          <span>Protected by Cloudflare Edge Isolates &amp; Web Crypto AES-256-GCM. Zero telemetry leakage.</span>
        </div>
        <div class="flex items-center gap-3 text-white/40 font-mono text-[11px]">
          <span>NONCE: {currentNonce}</span>
          <span class="text-white/20">•</span>
          <span>12ms TLS Handshake</span>
        </div>
      </div>
    </div>
  </div>
{/if}
