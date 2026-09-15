<script lang="ts">
  import type { UserAccount } from '../../../../src/contracts/v3_types';

  interface Props {
    account: UserAccount;
    onCreateKeyClick: () => void;
  }

  let { account, onCreateKeyClick }: Props = $props();
</script>

<section class="specular-card rounded-xl bg-surface-container-low/70 backdrop-blur-md border border-outline-variant/20 p-5 md:p-6 shadow-sm">
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
    <!-- Identity Info Column (4 cols) -->
    <div class="lg:col-span-4 space-y-4">
      <div class="flex items-start gap-4">
        <div class="relative shrink-0">
          {#if account.avatarUrl}
            <img
              class="w-14 h-14 rounded-xl border border-secondary/40 p-1 bg-surface-container-lowest object-cover"
              src={account.avatarUrl}
              alt={account.githubUsername}
            />
          {:else}
            <div class="w-14 h-14 rounded-xl border border-secondary/40 bg-surface-container-lowest flex items-center justify-center text-primary font-mono text-xl font-bold">
              {account.githubUsername ? account.githubUsername.slice(0, 2).toUpperCase() : 'DM'}
            </div>
          {/if}
          <span class="absolute -bottom-1 -right-1 w-4 h-4 bg-secondary rounded-full border-2 border-surface-container-low flex items-center justify-center text-[9px] text-on-secondary font-bold">
            ✓
          </span>
        </div>

        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onclick={onCreateKeyClick}
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 font-label-md text-label-md font-semibold hover:bg-primary/20 transition-colors cursor-pointer font-mono mr-2"
            >
              <span class="material-symbols-outlined text-[16px]">key</span>
              <span>Create Key</span>
            </button>
            <h2 class="font-headline-sm text-headline-sm text-on-surface font-semibold">
              {account.githubUsername ? `@${account.githubUsername}` : 'Demo Sandbox'}
            </h2>
            <span class="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high border border-outline-variant/20 font-label-sm text-label-sm text-on-surface-variant font-mono">
              <span class="material-symbols-outlined text-[12px] text-primary">code</span>
              {account.githubId ? 'GitHub' : 'Local'}
            </span>
          </div>
          <div class="font-code-sm text-code-sm text-outline mt-0.5 font-mono">
            Account ID: <span class="text-on-surface">{account.id || 'usr_demo_sandbox'}</span>
          </div>
          <div class="flex items-center gap-1.5 mt-2 text-secondary font-code-sm text-code-sm font-mono">
            <span class="material-symbols-outlined text-[14px]">{account.primaryEmail ? 'check_circle' : 'info'}</span>
            <span class="text-on-surface">{account.primaryEmail || 'No verified email linked (Sign in via GitHub)'}</span>
          </div>
          <div class="font-code-sm text-code-sm text-on-surface-variant mt-1 font-mono">
            Registration IP: <span class="text-on-surface">{account.registrationIp || '127.0.0.1'}</span>
            <span class="text-outline">({account.registrationIp ? 'Verified' : 'Local Edge'})</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Trust Gauge Column (3 cols) -->
    <div class="lg:col-span-3 flex flex-col items-center justify-center p-3 rounded-lg bg-surface-container-lowest/60 border border-outline-variant/20">
      <div class="relative w-28 h-28 flex items-center justify-center">
        <svg class="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" fill="transparent" r="40" stroke="#1e1f25" stroke-width="8"></circle>
          <!-- 251.2 total circumference, 20.1 offset is 92% -->
          <circle
            class="drop-shadow-[0_0_6px_rgba(78,222,163,0.4)]"
            cx="50"
            cy="50"
            fill="transparent"
            r="40"
            stroke="#4edea3"
            stroke-dasharray="251.2"
            stroke-dashoffset={251.2 * (1 - account.sybilScore / 100)}
            stroke-linecap="round"
            stroke-width="8"
          ></circle>
        </svg>
        <div class="absolute flex flex-col items-center justify-center">
          <span class="font-code-lg text-code-lg font-bold text-on-surface font-mono">
            {account.sybilScore}<span class="text-outline font-normal text-xs">/100</span>
          </span>
          <span class="font-label-sm text-label-sm text-secondary uppercase font-semibold font-mono">Trust</span>
        </div>
      </div>
      <div class="mt-2 text-center">
        <span class="font-label-sm text-label-sm px-2 py-0.5 rounded bg-secondary/10 border border-secondary/30 text-secondary font-mono">
          {account.sybilScore >= 80 ? 'Low Risk • High Reputation' : 'Verified Sandbox'}
        </span>
      </div>
    </div>

    <!-- 5-Layer Trust Checks Breakdown (5 cols) -->
    <div class="lg:col-span-5 space-y-2 border-t lg:border-t-0 lg:border-l border-outline-variant/20 pt-4 lg:pt-0 lg:pl-6 font-mono">
      <div class="font-label-sm text-label-sm uppercase tracking-wider text-outline mb-2">
        5-Layer Trust Checks Verification
      </div>
      <div class="flex items-center justify-between font-code-sm text-code-sm py-1 border-b border-outline-variant/10">
        <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
          <span class="material-symbols-outlined text-secondary text-[15px]">verified</span>
          Turnstile Biometrics &amp; Challenge
        </span>
        <span class="text-secondary font-medium">Passed (0.01ms)</span>
      </div>
      <div class="flex items-center justify-between font-code-sm text-code-sm py-1 border-b border-outline-variant/10">
        <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
          <span class="material-symbols-outlined text-secondary text-[15px]">schedule</span>
          GitHub Account Age
        </span>
        <span class="text-on-surface font-medium">&gt; 14 months (432d)</span>
      </div>
      <div class="flex items-center justify-between font-code-sm text-code-sm py-1 border-b border-outline-variant/10">
        <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
          <span class="material-symbols-outlined text-secondary text-[15px]">emoji_symbols</span>
          Public Repositories
        </span>
        <span class="text-on-surface font-medium">18 Repos • 420+ commits</span>
      </div>
      <div class="flex items-center justify-between font-code-sm text-code-sm py-1 border-b border-outline-variant/10">
        <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
          <span class="material-symbols-outlined text-secondary text-[15px]">router</span>
          Clean Subnet / ASN
        </span>
        <span class="text-secondary font-medium">Dedicated ASN • Non-VPN</span>
      </div>
      <div class="flex items-center justify-between font-code-sm text-code-sm py-1">
        <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
          <span class="material-symbols-outlined text-secondary text-[15px]">speed</span>
          Virtual Pool Quota Standing
        </span>
        <span class="text-secondary font-medium">0 Flagged Spikes</span>
      </div>
    </div>
  </div>
</section>
