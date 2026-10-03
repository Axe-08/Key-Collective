<script lang="ts">
  import type { UserAccount } from '../../../../src/contracts/v3_types';
  import {
    BUILDER_MIN_ACCOUNT_AGE_DAYS,
    BUILDER_MIN_CONTRIBUTIONS,
    BUILDER_MIN_PUBLIC_REPOS,
  } from '../../../../src/auth/sybil/constants';

  interface Props {
    account?: UserAccount;
    onCreateKeyClick: () => void;
  }

  let { account, onCreateKeyClick }: Props = $props();

  // Everything below comes from GET /api/session via App (QA-02, QA-03): no invented values.
  const identityId = $derived(account?.id ?? '');
  const githubUsername = $derived(account?.githubUsername ?? '');
  const isGitHubLinked = $derived(account?.authProvider === 'github' || Boolean(githubUsername));
  const identityEmail = $derived(account?.primaryEmail ?? '');
  const avatarUrl = $derived(
    account?.avatarUrl || (isGitHubLinked && githubUsername ? `https://avatars.githubusercontent.com/${githubUsername}` : '')
  );
  const authProvider = $derived(isGitHubLinked ? 'github' : account?.authProvider ?? 'google');
  const userTier = $derived(account?.tier ?? 'builder');
  const registrationIp = $derived(account?.registrationIp ?? '');

  // A score exists only once GitHub linking ran the Sybil assessment.
  const sybilTrustScore = $derived(isGitHubLinked && typeof account?.sybilScore === 'number' ? account.sybilScore : null);

  const trustBadge = $derived.by(() => {
    if (sybilTrustScore === null) {
      return {
        label: 'Unverified — link GitHub',
        status: 'Unverified',
        badgeClass: 'bg-surface-container-high border-outline-variant/30 text-outline',
        textClass: 'text-outline',
        strokeColor: '#6b7280',
        glowColor: 'rgba(107, 114, 128, 0.3)',
        icon: 'help',
        dotClass: 'bg-outline',
      };
    }
    if (sybilTrustScore < 25) {
      return {
        label: 'High Risk • Restrained',
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

  const gaugeOffset = $derived(251.2 * (1 - Math.min(100, Math.max(0, sybilTrustScore ?? 0)) / 100));

  // Checks render only from the GitHub profile assessed at link time, with the engine's thresholds.
  const accountAgeDays = $derived.by(() => {
    if (!isGitHubLinked || !account?.githubCreatedAt) return null;
    const created = Date.parse(account.githubCreatedAt);
    if (Number.isNaN(created)) return null;
    return Math.max(0, Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000)));
  });
  const activity = $derived(
    isGitHubLinked && typeof account?.githubPublicRepos === 'number' && typeof account?.githubContributions === 'number'
      ? { repos: account.githubPublicRepos, contributions: account.githubContributions }
      : null
  );
  const agePassed = $derived(accountAgeDays !== null && accountAgeDays >= BUILDER_MIN_ACCOUNT_AGE_DAYS);
  const activityPassed = $derived(
    activity !== null && activity.repos >= BUILDER_MIN_PUBLIC_REPOS && activity.contributions >= BUILDER_MIN_CONTRIBUTIONS
  );
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
              alt={githubUsername || 'User avatar'}
            />
          {:else}
            <div class="w-14 h-14 rounded-xl border border-secondary/40 bg-surface-container-lowest flex items-center justify-center text-primary font-mono text-xl font-bold">
              {(githubUsername || identityEmail || 'KC').slice(0, 2).toUpperCase()}
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
              {githubUsername ? `@${githubUsername}` : (identityEmail || identityId || 'Anonymous User')}
            </h2>
            <span class="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high border border-outline-variant/20 font-label-sm text-label-sm text-on-surface-variant font-mono">
              <span class="material-symbols-outlined text-[12px] text-primary">code</span>
              {authProvider === 'github' ? 'GitHub' : authProvider === 'google' ? 'Google' : authProvider === 'email' ? 'Email' : 'Demo'}
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
      {#if sybilTrustScore === null}
        <div class="w-28 h-28 flex flex-col items-center justify-center text-center">
          <span class="material-symbols-outlined text-[32px] text-outline">help</span>
          <span class="font-label-sm text-label-sm text-outline uppercase font-semibold font-mono mt-1">No trust score</span>
        </div>
      {:else}
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
      {/if}
      <div class="mt-2 text-center">
        <span class="font-label-sm text-label-sm px-2 py-0.5 rounded {trustBadge.badgeClass} border font-mono">
          {trustBadge.label}
        </span>
      </div>
    </div>

    <!-- Trust checks: only what the GitHub link assessment recorded -->
    <div class="lg:col-span-5 space-y-2 border-t lg:border-t-0 lg:border-l border-outline-variant/20 pt-4 lg:pt-0 lg:pl-6 font-mono">
      <div class="font-label-sm text-label-sm uppercase tracking-wider text-outline mb-2">
        Trust Checks
      </div>
      {#if !isGitHubLinked}
        <p class="font-body-sm text-body-sm text-on-surface-variant font-sans" data-testid="trust-unverified">
          Link a GitHub account to run the Sybil checks and get a trust score.
        </p>
      {:else if accountAgeDays === null && activity === null}
        <p class="font-body-sm text-body-sm text-on-surface-variant font-sans">
          No GitHub profile details were recorded for this link.
        </p>
      {:else}
        {#if accountAgeDays !== null}
          <div class="flex items-center justify-between font-code-sm text-code-sm py-1 border-b border-outline-variant/10">
            <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
              <span class="material-symbols-outlined {agePassed ? 'text-secondary' : 'text-outline'} text-[15px]">{agePassed ? 'schedule' : 'history'}</span>
              GitHub Account Age
            </span>
            <span class="{agePassed ? 'text-on-surface' : 'text-outline'} font-medium">{accountAgeDays}d</span>
          </div>
        {/if}
        {#if activity !== null}
          <div class="flex items-center justify-between font-code-sm text-code-sm py-1 border-b border-outline-variant/10">
            <span class="text-on-surface-variant flex items-center gap-1.5 font-sans">
              <span class="material-symbols-outlined {activityPassed ? 'text-secondary' : 'text-outline'} text-[15px]">{activityPassed ? 'emoji_symbols' : 'pending'}</span>
              Public Repositories &amp; Activity
            </span>
            <span class="{activityPassed ? 'text-on-surface' : 'text-outline'} font-medium">{activity.repos} repos • {activity.contributions} contributions</span>
          </div>
        {/if}
      {/if}
    </div>
  </div>
</section>
