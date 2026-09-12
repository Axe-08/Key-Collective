<script lang="ts">
  import type { PoolStats } from './types';
  import type { UserAccount, UserTier } from '../../../src/contracts/v3_types';
  import { type Microdollars, formatMicrodollars } from './types';

  let {
    stats,
    activeTab = 'pool',
    onSelectTab,
    userAccount,
    onOpenAddModal,
    onOpenOAuthModal,
    onRefresh,
    isRefreshing = false,
    searchQuery = $bindable(''),
    todaySpendMicrodollars = 42000,
  }: {
    stats?: PoolStats;
    activeTab?: 'pool' | 'workbench' | 'docs' | 'admin' | string;
    onSelectTab?: (tab: string) => void;
    userAccount?: UserAccount;
    onOpenAddModal?: () => void;
    onOpenOAuthModal?: () => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    searchQuery?: string;
    todaySpendMicrodollars?: Microdollars;
  } = $props();

  
  let isNotificationsOpen = $state(false);
  let isSettingsOpen = $state(false);
  let isProfileMenuOpen = $state(false);

  function getTierBadgeColor(tier?: UserTier): string {
    switch (tier) {
      case 'admin':
        return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
      case 'ultra':
        return 'bg-purple-500/10 text-purple-300 border-purple-500/30';
      case 'max':
        return 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30';
      case 'builder':
        return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
      case 'probationary':
        return 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30';
      case 'demo':
        return 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30';
      default:
        return 'bg-slate-500/10 text-slate-300 border-slate-500/30';
    }
  }

  function handleTabClick(tab: string) {
    if (onSelectTab) {
      onSelectTab(tab);
    }
  }
</script>

<header class="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 h-14 w-full bg-surface-container-lowest/80 backdrop-blur-md border-b border-outline-variant/30 shadow-sm">
  <!-- Left Section: Brand & Search bar on left -->
  <div class="flex items-center gap-6">
    <div class="flex items-center gap-2.5">
      <div class="w-8 h-8 rounded-lg bg-surface-container-high border border-outline-variant/50 flex items-center justify-center text-primary shadow-inner">
        <span class="material-symbols-outlined text-primary text-[19px]" data-icon="shield">shield</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-headline-sm font-headline-sm font-semibold tracking-tight text-on-surface">Key Collective</span>
        <span class="text-label-sm font-label-sm px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant border border-outline-variant/30 font-mono">v3.5 Edge</span>
      </div>
    </div>

    <!-- Edge status badge -->
    <div class="hidden lg:flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface-container border border-outline-variant/40">
      <span class="w-2 h-2 rounded-full bg-secondary status-pulse shadow-[0_0_8px_#4edea3]"></span>
      <span class="text-label-sm font-label-sm text-secondary font-mono">Edge Network Active • Latency Nominal</span>
    </div>

    <!-- Search on left -->
    <div class="relative hidden xl:block w-64">
      <span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-outline text-[16px]" data-icon="search">search</span>
      <input
        bind:value={searchQuery}
        class="w-full pl-8 pr-12 py-1.5 bg-surface-container-low border border-outline-variant/30 rounded-lg text-code-sm font-code-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary transition-colors"
        placeholder="Search keys, models, routes..."
        type="text"
      />
      <kbd class="absolute right-2 top-1/2 -translate-y-1/2 text-label-sm font-label-sm text-outline-variant bg-surface-container-high px-1.5 py-0.5 rounded border border-outline-variant/20">⌘K</kbd>
    </div>
  </div>

  <!-- Trailing Section (Actions + Icons + Avatar) -->
  <div class="flex items-center gap-3">
    <!-- Trailing Icon Actions -->
    <div class="flex items-center gap-1 border-l border-outline-variant/30 pl-2 text-on-surface-variant">
      <button
        type="button"
        onclick={() => { handleTabClick('pool'); setTimeout(() => document.getElementById('telemetry-logs')?.scrollIntoView({ behavior: 'smooth' }), 50); }}
        class="p-1.5 rounded hover:bg-surface-container-high/60 transition-colors cursor-pointer"
        title="Logs Terminal"
      >
        <span class="material-symbols-outlined text-[18px]" data-icon="terminal">terminal</span>
      </button>
      <button
        type="button"
        class="p-1.5 rounded hover:bg-surface-container-high/60 transition-colors relative cursor-pointer"
        title="Notifications"
        onclick={() => isNotificationsOpen = !isNotificationsOpen}
      >
        <span class="material-symbols-outlined text-[18px]" data-icon="notifications">notifications</span>
        <span class="w-1.5 h-1.5 rounded-full bg-tertiary absolute top-1.5 right-1.5"></span>
      
        {#if isNotificationsOpen}
          <div class="absolute right-0 top-10 w-64 bg-surface-container-high border border-outline-variant/30 rounded-lg shadow-lg p-3 z-50">
            <h3 class="text-label-md font-bold mb-2">Notifications</h3>
            <p class="text-body-sm text-on-surface-variant">No new notifications.</p>
          </div>
        {/if}

      </button>
      <button
        type="button"
        onclick={() => isSettingsOpen = true}
        class="p-1.5 rounded hover:bg-surface-container-high/60 transition-colors cursor-pointer"
        title="Settings & Docs"
      >
        <span class="material-symbols-outlined text-[18px]" data-icon="settings">settings</span>
      </button>
    </div>

    <!-- Profile Avatar with Sybil trust verification ring from Stitch -->
    <button
      type="button"
      onclick={() => isProfileMenuOpen = !isProfileMenuOpen}
      class="flex items-center gap-2.5 pl-1 rounded-lg hover:bg-surface-container-high/40 transition-all cursor-pointer text-left relative"
    >
      <div class="relative">
        <div
          class="w-8 h-8 rounded-full p-0.5 bg-gradient-to-tr from-secondary to-primary flex items-center justify-center shadow-sm"
          title="Sybil Trust Score: {userAccount?.sybilScore ?? 92}/100 ({userAccount?.tier?.toUpperCase() || 'BUILDER'})"
        >
          {#if userAccount?.avatarUrl}
            <img src={userAccount.avatarUrl} alt="Avatar" class="w-full h-full rounded-full object-cover" />
          {:else}
            <div class="w-full h-full rounded-full bg-surface-container-lowest flex items-center justify-center text-primary font-code-sm text-code-sm font-semibold">
              {userAccount?.githubUsername ? userAccount.githubUsername.substring(0, 2).toUpperCase() : 'KC'}
            </div>
          {/if}
        </div>
        <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-secondary rounded-full border-2 border-surface-container-lowest"></span>
      </div>
      <div class="hidden xl:flex flex-col">
        <div class="flex items-center gap-1.5">
          <span class="font-code-sm text-code-sm text-on-surface font-semibold leading-tight">
            @{userAccount?.githubUsername || 'collective-dev'}
          </span>
          <span class="font-label-sm text-[9px] px-1 rounded bg-primary/10 text-primary border border-primary/20 uppercase font-mono">
            {userAccount?.tier || 'builder'}
          </span>
        </div>
        <span class="font-label-sm text-[10px] text-on-surface-variant font-mono leading-tight">
          Trust: {userAccount?.sybilScore ?? 92}/100
        </span>
      </div>
    </button>
  </div>

{#if isProfileMenuOpen}
  <div class="absolute right-6 top-14 w-48 bg-surface-container-high border border-outline-variant/30 rounded-lg shadow-lg py-2 z-50">
    <button onclick={onOpenOAuthModal} class="w-full text-left px-4 py-2 hover:bg-surface-container-highest">Login</button>
    <button onclick={onOpenOAuthModal} class="w-full text-left px-4 py-2 hover:bg-surface-container-highest">Register</button>
    <button onclick={() => document.dispatchEvent(new CustomEvent('logout'))} class="w-full text-left px-4 py-2 hover:bg-surface-container-highest text-error">Logout</button>
  </div>
{/if}

</header>

{#if isSettingsOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onclick={() => (isSettingsOpen = false)}>
    <div class="bg-surface-container-low p-6 rounded-2xl border border-outline-variant/30 max-w-md w-full shadow-2xl space-y-4" onclick={e => e.stopPropagation()}>
      <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary">settings</span>
          <h2 class="text-headline-sm font-semibold text-on-surface">Developer Preferences</h2>
        </div>
        <button type="button" onclick={() => (isSettingsOpen = false)} class="text-outline hover:text-on-surface cursor-pointer">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="space-y-3 font-sans text-xs text-on-surface-variant">
        <div>
          <label class="block font-mono text-[11px] text-outline mb-1" for="pref-endpoint">Edge Proxy Gateway</label>
          <input id="pref-endpoint" type="text" readonly value="https://key-col.axe08.tech/v1/chat/completions" class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/20 font-mono text-xs text-on-surface select-all" />
        </div>
        <div>
          <label class="block font-mono text-[11px] text-outline mb-1" for="pref-telemetry">Telemetry Poll Frequency</label>
          <input id="pref-telemetry" type="text" readonly value="3,000ms (High-Frequency Adaptive Edge)" class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/20 font-mono text-xs text-on-surface" />
        </div>
        <div class="p-2.5 rounded-lg bg-surface-container border border-outline-variant/15 flex items-center justify-between font-mono text-[11px]">
          <span>Security Isolates</span>
          <span class="text-secondary font-medium">AES-256-GCM / Web Crypto</span>
        </div>
      </div>
      <div class="flex justify-end pt-3 border-t border-outline-variant/20">
        <button type="button" onclick={() => (isSettingsOpen = false)} class="px-4 py-2 bg-primary text-on-primary rounded-lg font-mono text-xs font-semibold hover:opacity-90 cursor-pointer">Close</button>
      </div>
    </div>
  </div>
{/if}

