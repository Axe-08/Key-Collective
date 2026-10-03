<script lang="ts">
  import { onMount } from 'svelte';
  import StandingCard from './standing/StandingCard.svelte';
  import type { ContributorStandingData } from './standing/types';
  import type { PoolStats, APIKey, CU } from './types';
  import type { UserAccount, Project, ProjectKey } from '../../../src/contracts/v3_types';
  import Workbench from './Workbench.svelte';

  interface Props {
    standing?: ContributorStandingData | null;
    stats: PoolStats;
    keys: APIKey[];
    cuUsedToday?: CU;
    proxyEndpoint: string;
    isEndpointCopied?: boolean;
    onCopyEndpoint?: () => void;
    onOpenAddModal?: () => void;
    onRefresh?: () => void;
    userAccount: UserAccount;
    projects: Project[];
    projectKeys: ProjectKey[];
    /** Session rights: may this account lend to the community pool (D-21). */
    communityPool?: boolean;
  }

  let {
    standing = null,
    stats,
    keys = [],
    cuUsedToday = 0,
    proxyEndpoint,
    isEndpointCopied = false,
    onCopyEndpoint,
    onOpenAddModal,
    onRefresh,
    userAccount,
    projects = [],
    projectKeys = [],
    communityPool = false,
  }: Props = $props();

  let contributionData = $state<{
    personal_requests_today: number;
    requests_served_for_community_today: number;
    cu_contributed_24h: number;
    cu_borrowed_24h: number;
  }>({
    personal_requests_today: 0,
    requests_served_for_community_today: 0,
    cu_contributed_24h: 0,
    cu_borrowed_24h: 0,
  });

  onMount(async () => {
    try {
      const res = await fetch('/api/pool/contribution', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        contributionData = {
          personal_requests_today: data.personal_requests_today ?? 0,
          requests_served_for_community_today: data.requests_served_for_community_today ?? 0,
          cu_contributed_24h: data.cu_contributed_24h ?? 0,
          cu_borrowed_24h: data.cu_borrowed_24h ?? 0,
        };
      }
    } catch {
      // Non-blocking fallback
    }
  });
</script>

<div class="space-y-6 font-mono" data-testid="dashboard-view">
  <!-- Top Header -->
  <div class="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/20">
    <div>
      <div class="flex items-center gap-2 mb-1">
        <span class="text-xs uppercase tracking-wider text-primary">Developer Console</span>
        <span class="px-1.5 py-0.5 rounded text-[10px] bg-secondary/10 border border-secondary/30 text-secondary">
          {stats.proxy_status === 'healthy' ? 'Proxy Online' : 'Degraded'}
        </span>
      </div>
      <h1 class="text-headline-md text-on-surface font-semibold tracking-tight">
        Dashboard &amp; Standing Overview
      </h1>
    </div>

    <div class="flex items-center gap-2">
      {#if onOpenAddModal}
        <button
          type="button"
          onclick={onOpenAddModal}
          class="px-3.5 py-2 rounded-lg bg-primary text-on-primary text-xs font-semibold flex items-center gap-1.5 hover:bg-primary/90 cursor-pointer"
        >
          <span class="material-symbols-outlined text-[16px]">add_circle</span>
          <span>Add Provider Key</span>
        </button>
      {/if}
    </div>
  </div>

  <!-- Grid: StandingCard (Left 6 cols) + Today's Activity & Quick Endpoint (Right 6 cols) -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
    <div class="lg:col-span-6">
      <StandingCard {standing} />
    </div>

    <div class="lg:col-span-6 space-y-4">
      <!-- Today's Activity Card -->
      <div class="rounded-xl border border-outline-variant/30 bg-surface-container-low/90 p-5 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-on-surface flex items-center gap-2">
            <span class="material-symbols-outlined text-primary text-[18px]">monitoring</span>
            <span>Today's Activity</span>
          </h2>
          <span class="text-[11px] text-outline">{keys.length} Active Keys</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div class="p-3 rounded-lg bg-surface-container-highest/40 border border-outline-variant/20">
            <span class="text-[10px] text-outline uppercase block">Personal Reqs</span>
            <span class="text-base font-bold text-on-surface mt-1 block">
              {contributionData.personal_requests_today.toLocaleString()}
            </span>
          </div>

          <div class="p-3 rounded-lg bg-surface-container-highest/40 border border-outline-variant/20">
            <span class="text-[10px] text-outline uppercase block">Burst Borrowed</span>
            <span class="text-base font-bold text-amber-300 mt-1 block">
              {contributionData.cu_borrowed_24h.toLocaleString()} CU
            </span>
          </div>

          <div class="p-3 rounded-lg bg-surface-container-highest/40 border border-outline-variant/20">
            <span class="text-[10px] text-outline uppercase block">Communal Served</span>
            <span class="text-base font-bold text-secondary mt-1 block">
              {contributionData.requests_served_for_community_today.toLocaleString()}
            </span>
          </div>

          <div class="p-3 rounded-lg bg-surface-container-highest/40 border border-outline-variant/20">
            <span class="text-[10px] text-outline uppercase block">CU Used Today</span>
            <span class="text-base font-bold text-primary mt-1 block">
              {Number(cuUsedToday || stats.cu_used_today || 0).toLocaleString()} CU
            </span>
          </div>
        </div>

        <!-- OpenAI-Compatible Proxy Endpoint Bar -->
        <div class="pt-2 border-t border-outline-variant/20 space-y-1.5">
          <div class="text-[11px] text-outline flex items-center justify-between">
            <span>OpenAI-Compatible Gateway Endpoint</span>
            <span class="text-secondary text-[10px]">Sub-15ms Edge Routing</span>
          </div>
          <div class="flex items-center gap-2">
            <code class="flex-1 px-3 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-xs text-on-surface truncate">
              {proxyEndpoint}
            </code>
            {#if onCopyEndpoint}
              <button
                type="button"
                onclick={onCopyEndpoint}
                class="px-3 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-xs text-on-surface border border-outline-variant/30 cursor-pointer flex items-center gap-1"
              >
                <span class="material-symbols-outlined text-[15px]">
                  {isEndpointCopied ? 'check' : 'content_copy'}
                </span>
                <span>{isEndpointCopied ? 'Copied' : 'Copy'}</span>
              </button>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Credentials & Projects Section (Workbench) -->
  <div class="pt-2">
    <Workbench
      {userAccount}
      {projects}
      keys={projectKeys}
      providerKeys={keys}
      {communityPool}
      onRefreshProviderKeys={onRefresh}
    />
  </div>
</div>
