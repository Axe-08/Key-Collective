<script lang="ts">
  import type { UserAccount } from '../../../../src/contracts/v3_types';
  import type { UserIdentity } from '../../../../src/contracts/v3_5_types';

  interface Props {
    account?: UserAccount;
    userIdentity?: UserIdentity;
    podIdentity?: {
      id?: string;
      name?: string;
      status?: string;
      avatarUrl?: string;
      sybilTrustScore?: number;
    };
    onCreateKeyClick: () => void;
  }

  let {
    account,
    userIdentity: propUserIdentity,
    podIdentity: propPodIdentity,
    onCreateKeyClick,
  }: Props = $props();

  let sessionIdentity = $state<UserIdentity | null>(null);
  let isLoading = $state(false);

  function getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (typeof window !== 'undefined') {
      try {
        const token = localStorage.getItem('kc_auth_token');
        if (token) headers['Authorization'] = `Bearer ${token.trim()}`;
        const raw = localStorage.getItem('kc_user');
        if (raw) {
          const user = JSON.parse(raw);
          if (user?.id) headers['x-tenant-id'] = user.id;
        }
      } catch {}
    }
    return headers;
  }

  async function fetchSession() {
    try {
      isLoading = true;
      const res = await fetch('/api/session', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        sessionIdentity = data.user ?? data.identity ?? data;
      }
    } catch (err) {
      console.error('Failed to fetch /api/session:', err);
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    fetchSession();
  });

  const identityId = $derived(
    sessionIdentity?.id ??
    propUserIdentity?.id ??
    propPodIdentity?.id ??
    account?.id ??
    ''
  );

  const identityName = $derived(
    sessionIdentity?.githubUsername ??
    propUserIdentity?.githubUsername ??
    propPodIdentity?.name ??
    account?.githubUsername ??
    (sessionIdentity?.email ? sessionIdentity.email.split('@')[0] : '')
  );

  const identityEmail = $derived(
    sessionIdentity?.email ??
    propUserIdentity?.email ??
    account?.primaryEmail ??
    ''
  );

  const avatarUrl = $derived(
    propPodIdentity?.avatarUrl ??
    account?.avatarUrl ??
    (identityName ? `https://avatars.githubusercontent.com/${identityName}` : '')
  );

  const authProvider = $derived(
    sessionIdentity?.authProvider ??
    propUserIdentity?.authProvider ??
    (account?.githubId ? 'github' : 'local')
  );

  const isQuarantined = $derived(
    sessionIdentity?.isQuarantined ??
    propUserIdentity?.isQuarantined ??
    false
  );

  const userTier = $derived(
    sessionIdentity?.tier ??
    propUserIdentity?.tier ??
    account?.tier ??
    'builder'
  );

  const sybilTrustScore = $derived(
    sessionIdentity?.sybilTrustScore ??
    propUserIdentity?.sybilTrustScore ??
    propPodIdentity?.sybilTrustScore ??
    account?.sybilScore ??
    0
  );

  const registrationIp = $derived(account?.registrationIp ?? '');

  // Color-coded badge and visual metrics dynamically derived from sybilTrustScore
  const trustBadge = $derived.by(() => {
    if (isQuarantined || sybilTrustScore < 25) {
      return {
        label: isQuarantined ? 'Quarantined • High Risk' : 'High Risk • Restrained',
        status: 'Restricted',
        badgeClass: 'bg-error/10 border-error/30 text-error',
        textClass: 'text-error',
        strokeColor: '#ef4444',
        glowColor: 'rgba(239, 68, 68, 0.4)',
        icon: 'gpp_bad',
        dotClass: 'bg-error',
      };
    }
    if (sybilTrustScore < 50) {
      return {
        label: 'Probationary • In Review',
        status: 'Observation',
        badgeClass: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
        textClass: 'text-amber-400',
        strokeColor: '#f59e0b',
        glowColor: 'rgba(245, 158, 11, 0.4)',
        icon: 'warning',
        dotClass: 'bg-amber-400',
      };
    }
    if (sybilTrustScore < 80) {
      return {
        label: 'Verified • Active Trust',
        status: 'Active',
        badgeClass: 'bg-primary/10 border-primary/30 text-primary',
        textClass: 'text-primary',
        strokeColor: '#60a5fa',
        glowColor: 'rgba(96, 165, 250, 0.4)',
        icon: 'shield',
        dotClass: 'bg-primary',
      };
    }
    return {
      label: 'Low Risk • High Reputation',
      status: 'Trusted',
      badgeClass: 'bg-secondary/10 border-secondary/30 text-secondary',
      textClass: 'text-secondary',
      strokeColor: '#4edea3',
      glowColor: 'rgba(78, 222, 163, 0.4)',
      icon: 'verified',
      dotClass: 'bg-secondary',
    };
  });

  const gaugeOffset = $derived(251.2 * (1 - Math.min(100, Math.max(0, sybilTrustScore)) / 100));

  // Dynamic 5-layer trust check states derived from sybilTrustScore
  const layer1Turnstile = $derived({
    passed: sybilTrustScore >= 20,
    text: sybilTrustScore >= 20 ? 'Passed' : 'Pending Challenge',
  });
  const layer2AccountAge = $derived({
    passed: sybilTrustScore >= 40,
    text: sybilTrustScore >= 40 ? 'Verified (> 30d)' : 'New Account (< 30d)',
  });
  const layer3Activity = $derived({
    passed: sybilTrustScore >= 60,
    text: sybilTrustScore >= 60 ? 'Active Contributor' : 'Low Activity',
  });
  const layer4Subnet = $derived({
    passed: sybilTrustScore >= 30,
    text: sybilTrustScore >= 30 ? 'Clean Subnet • Dedicated' : 'High Velocity / Datacenter',
  });
  const layer5Quota = $derived({
    passed: !isQuarantined && sybilTrustScore >= 25,
    text: isQuarantined ? 'Quota Suspended' : sybilTrustScore >= 25 ? 'Pristine Standing' : 'Under Review',
  });
</script>

<section class="specular-card rounded-xl bg-surface-container-low/70 backdrop-blur-md border border-outline-variant/20 p-5 md:p-6 shadow-sm">
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
    <!-- Identity Info Column (4 cols) -->
    <div class="lg:col-span-4 space-y-4">
      <div class="flex items-start gap-4">
        <div class="relative shrink-0">
          {#if avatarUrl}
            <img
              class="w-14 h-14 rounded-xl border border-secondary/40 p-1 bg-surface-container-lowest object-cover"
              src={avatarUrl}
              alt={identityName || 'User avatar'}
            />
          {:else}
            <div class="w-14 h-14 rounded-xl border border-secondary/40 bg-surface-container-lowest flex items-center justify-center text-primary font-mono text-xl font-bold">
              {identityName ? identityName.slice(0, 2).toUpperCase() : 'KC'}
            </div>
          {/if}
          <span class="absolute -bottom-1 -right-1 w-4 h-4 {trustBadge.dotClass} rounded-full border-2 border-surface-container-low flex items-center justify-center text-[9px] text-on-secondary font-bold" title="Status: {trustBadge.status}">
            <span class="material-symbols-outlined text-[10px]">{trustBadge.icon}</span>
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
              {identityName ? `@${identityName}` : (identityId ? identityId : 'Anonymous User')}
            </h2>
            <span class="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high border border-outline-variant/20 font-label-sm text-label-sm text-on-surface-variant font-mono">
              <span class="material-symbols-outlined text-[12px] text-primary">code</span>
              {authProvider === 'github' ? 'GitHub' : authProvider === 'google' ? 'Google' : 'Local'}
            </span>
          </div>
          <div class="font-code-sm text-code-sm text-outline mt-0.5 font-mono">
            Account ID: <span class="text-on-surface">{identityId || 'Unauthenticated'}</span>
          </div>
          <div class="flex items-center gap-1.5 mt-2 {trustBadge.textClass} font-code-sm text-code-sm font-mono">
            <span class="material-symbols-outlined text-[14px]">{identityEmail ? 'check_circle' : 'info'}</span>
            <span class="text-on-surface">{identityEmail || 'No verified email linked'}</span>
          </div>
          <div class="font-code-sm text-code-sm text-on-surface-variant mt-1 font-mono">
            {#if registrationIp}
              Registration IP: <span class="text-on-surface">{registrationIp}</span>
              <span class="text-outline">(Verified)</span>
            {:else}
              Tier Status: <span class="text-on-surface font-semibold">{userTier.toUpperCase()}</span>
              <span class="text-outline">({trustBadge.status})</span>
            {/if}
          </div>
        </div>
      </div>
    </div>

    <!-- Trust Gauge Column (3 cols) -->
    <div class="lg:col-span-3 flex flex-col items-center justify-center p-3 rounded-lg bg-surface-container-lowest/60 border border-outline-variant/20">
      <div class="relative w-28 h-28 flex items-center justify-center">
        <svg class="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" fill="transparent" r="40" stroke="#1e1f25" stroke-width="8"></circle>
          <!-- 251.2 total circumference -->
          <circle
            style="filter: drop-shadow(0 0 6px {trustBadge.glowColor})"
            cx="50"
            cy="50"
            fill="transparent"
            r="40"
            stroke={trustBadge.strokeColor}
            stroke-dasharray="251.2"
            stroke-dashoffset={gaugeOffset}
            stroke-linecap="round"
            stroke-width="8"
          ></circle>
        </svg>
        <div class="absolute flex flex-col items-center justify-center">
          <span class="font-code-lg text-code-lg font-bold text-on-surface font-mono">
            {sybilTrustScore}<span class="text-outline font-normal text-xs">/100</span>
          </span>
          <span class="font-label-sm text-label-sm {trustBadge.textClass} uppercase font-semibold font-mono">Trust</span>
        </div>
      </div>
      <div class="mt-2 text-center">
        <span class="font-label-sm text-label-sm px-2 py-0.5 rounded {trustBadge.badgeClass} border font-mono">
          {trustBadge.label}
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
          <span class="material-symbols-outlined {layer1Turnstile.passed ? 'text-secondary' : 'text-outline'} text-[15px]">{layer1Turnstile.passed ? 'verified' : 'cancel'}</span>
          Turnstile Biometrics &amp; Challenge
        </span>
        <span class="{layer1Turnstile.passed ? 'text-secondary' : 'text-outline'} font-medium">{layer1Turnstile.text}</span>
      </div>
      <div class="flex items-center justify-between font-code-sm text-code-sm py-1 border-b border-outline-variant/10">
        <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
          <span class="material-symbols-outlined {layer2AccountAge.passed ? 'text-secondary' : 'text-outline'} text-[15px]">{layer2AccountAge.passed ? 'schedule' : 'history'}</span>
          GitHub Account Age
        </span>
        <span class="{layer2AccountAge.passed ? 'text-on-surface' : 'text-outline'} font-medium">{layer2AccountAge.text}</span>
      </div>
      <div class="flex items-center justify-between font-code-sm text-code-sm py-1 border-b border-outline-variant/10">
        <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
          <span class="material-symbols-outlined {layer3Activity.passed ? 'text-secondary' : 'text-outline'} text-[15px]">{layer3Activity.passed ? 'emoji_symbols' : 'pending'}</span>
          Public Repositories &amp; Activity
        </span>
        <span class="{layer3Activity.passed ? 'text-on-surface' : 'text-outline'} font-medium">{layer3Activity.text}</span>
      </div>
      <div class="flex items-center justify-between font-code-sm text-code-sm py-1 border-b border-outline-variant/10">
        <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
          <span class="material-symbols-outlined {layer4Subnet.passed ? 'text-secondary' : 'text-outline'} text-[15px]">{layer4Subnet.passed ? 'router' : 'dns'}</span>
          Clean Subnet / ASN
        </span>
        <span class="{layer4Subnet.passed ? 'text-secondary' : 'text-outline'} font-medium">{layer4Subnet.text}</span>
      </div>
      <div class="flex items-center justify-between font-code-sm text-code-sm py-1">
        <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
          <span class="material-symbols-outlined {layer5Quota.passed ? 'text-secondary' : 'text-error'} text-[15px]">{layer5Quota.passed ? 'speed' : 'error'}</span>
          Virtual Pool Quota Standing
        </span>
        <span class="{layer5Quota.passed ? 'text-secondary' : 'text-error'} font-medium">{layer5Quota.text}</span>
      </div>
    </div>
  </div>
</section>
