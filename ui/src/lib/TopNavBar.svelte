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
    onOpenOAuthModal?: (mode: 'login' | 'register') => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    searchQuery?: string;
    todaySpendMicrodollars?: Microdollars;
  } = $props();

  import { onMount } from 'svelte';
  
  let isNotificationsOpen = $state(false);
  let isSettingsOpen = $state(false);
  let isProfileMenuOpen = $state(false);
  let devDisplayName = $state('');
  let devAvatarUrl = $state('');
  let telemetryPollFreq = $state('3s');

  let editDisplayName = $state('');
  let editAvatarUrl = $state('');

  onMount(() => {
    devDisplayName = localStorage.getItem('devDisplayName') || '';
    devAvatarUrl = localStorage.getItem('devAvatarUrl') || '';
    telemetryPollFreq = localStorage.getItem('telemetryPollFreq') || '3s';
  });

  let displayUsername = $derived(devDisplayName || userAccount?.githubUsername || 'collective-dev');
  let displayAvatarUrl = $derived(devAvatarUrl || userAccount?.avatarUrl || '');
  let isLoggedIn = $derived(
    Boolean(userAccount?.id && userAccount.tier !== 'demo' && (userAccount.githubUsername || userAccount.primaryEmail))
  );

  function openSettings() {
    editDisplayName = devDisplayName;
    editAvatarUrl = devAvatarUrl;
    isSettingsOpen = true;
  }

  function saveSettings() {
    localStorage.setItem('devDisplayName', editDisplayName);
    localStorage.setItem('devAvatarUrl', editAvatarUrl);
    localStorage.setItem('telemetryPollFreq', telemetryPollFreq);
    devDisplayName = editDisplayName;
    devAvatarUrl = editAvatarUrl;
    window.dispatchEvent(new Event('settings-updated'));
    isSettingsOpen = false;
  }

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
    <button class="flex items-center gap-2.5 cursor-pointer text-left hover:opacity-80 transition-opacity" onclick={() => handleTabClick('pool')}>
      <div class="w-8 h-8 rounded-lg bg-surface-container-high border border-outline-variant/50 flex items-center justify-center text-primary shadow-inner">
        <span class="material-symbols-outlined text-primary text-[19px]" data-icon="shield">shield</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-headline-sm font-headline-sm font-semibold tracking-tight text-on-surface">Key Collective</span>
        <span class="text-label-sm font-label-sm px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-mono">v4.0 Commons</span>
      </div>
    </button>

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
        onclick={() => { handleTabClick('pool'); setTimeout(() => document.getElementById('telemetry-logs')?.scrollIntoView({ behavior: 'smooth' }), 250); }}
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
        onclick={() => openSettings()}
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
          {#if displayAvatarUrl}
            <img src={displayAvatarUrl} alt="Avatar" class="w-full h-full rounded-full object-cover" />
          {:else}
            <div class="w-full h-full rounded-full bg-surface-container-lowest flex items-center justify-center text-primary font-code-sm text-code-sm font-semibold">
              {displayUsername ? displayUsername.substring(0, 2).toUpperCase() : 'KC'}
            </div>
          {/if}
        </div>
        <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-secondary rounded-full border-2 border-surface-container-lowest"></span>
      </div>
      <div class="hidden xl:flex flex-col">
        <div class="flex items-center gap-1.5">
          <span class="font-code-sm text-code-sm text-on-surface font-semibold leading-tight">
            @{displayUsername}
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
  <div class="absolute right-6 top-14 w-56 bg-surface-container-high border border-outline-variant/30 rounded-xl shadow-2xl py-2 z-50 overflow-hidden backdrop-blur-md">
    {#if isLoggedIn}
      <div class="px-4 py-2 border-b border-outline-variant/20 mb-1">
        <p class="text-label-sm font-semibold text-on-surface truncate">{displayUsername}</p>
        <p class="text-[11px] text-outline truncate font-mono">{userAccount?.primaryEmail || 'builder@keycollective.io'}</p>
        <div class="mt-1 flex items-center gap-1.5">
          <span class="px-1.5 py-0.2 text-[9px] rounded bg-primary/20 text-primary uppercase font-mono font-semibold">
            {userAccount?.tier || 'builder'}
          </span>
          <span class="text-[10px] text-outline-variant font-mono">Trust {userAccount?.sybilScore ?? 92}/100</span>
        </div>
      </div>
      {#if userAccount?.tier === 'admin'}
        <a
          href="https://admin.key-col.axe08.tech/"
          target="_blank"
          rel="noopener noreferrer"
          class="w-full text-left px-4 py-2 hover:bg-amber-500/10 text-amber-300 flex items-center justify-between cursor-pointer transition-colors border-b border-outline-variant/20"
        >
          <span class="flex items-center gap-2">
            <span class="material-symbols-outlined text-[16px]">admin_panel_settings</span>
            <span class="font-medium text-[13px]">Admin Console</span>
          </span>
          <span class="material-symbols-outlined text-[14px]">open_in_new</span>
        </a>
      {/if}
      <button
        onclick={() => { isProfileMenuOpen = false; openSettings(); }}
        class="w-full text-left px-4 py-2 hover:bg-surface-container-highest text-on-surface flex items-center gap-2 cursor-pointer transition-colors"
      >
        <span class="material-symbols-outlined text-[16px] text-primary">settings</span>
        <span>Developer Settings</span>
      </button>
      <button
        onclick={() => { isProfileMenuOpen = false; document.dispatchEvent(new CustomEvent('logout')); }}
        class="w-full text-left px-4 py-2 hover:bg-surface-container-highest text-error flex items-center gap-2 cursor-pointer transition-colors"
      >
        <span class="material-symbols-outlined text-[16px]">logout</span>
        <span>Log Out</span>
      </button>
    {:else}
      <div class="px-4 py-1.5 border-b border-outline-variant/20 mb-1">
        <p class="text-[11px] text-outline font-mono">Not Authenticated</p>
      </div>
      <button
        onclick={() => { isProfileMenuOpen = false; onOpenOAuthModal?.('login'); }}
        class="w-full text-left px-4 py-2 hover:bg-surface-container-highest text-on-surface flex items-center gap-2 cursor-pointer transition-colors"
      >
        <span class="material-symbols-outlined text-[16px] text-secondary">login</span>
        <span>Log In</span>
      </button>
      <button
        onclick={() => { isProfileMenuOpen = false; onOpenOAuthModal?.('register'); }}
        class="w-full text-left px-4 py-2 hover:bg-surface-container-highest text-on-surface flex items-center gap-2 cursor-pointer transition-colors"
      >
        <span class="material-symbols-outlined text-[16px] text-primary">person_add</span>
        <span>Register Account</span>
      </button>
    {/if}
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
        <!-- Authorized Accounts & Identity Switching -->
        <div class="p-3 rounded-xl bg-surface-container border border-outline-variant/20 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-mono text-[11px] text-outline">Authorized Account</span>
            <span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded {isLoggedIn ? 'bg-secondary/20 text-secondary border border-secondary/30' : 'bg-outline-variant/20 text-outline'}">
              {isLoggedIn ? (userAccount?.tier?.toUpperCase() || 'CONNECTED') : 'GUEST'}
            </span>
          </div>
          {#if isLoggedIn}
            <div class="flex items-center gap-2 text-on-surface">
              {#if displayAvatarUrl}
                <img src={displayAvatarUrl} alt="Avatar" class="w-7 h-7 rounded-full object-cover border border-outline-variant/40" />
              {:else}
                <div class="w-7 h-7 rounded-full bg-surface-container-high flex items-center justify-center text-primary font-mono text-xs font-bold">
                  {displayUsername.slice(0, 2).toUpperCase()}
                </div>
              {/if}
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-xs text-on-surface truncate">@{displayUsername}</p>
                <p class="font-mono text-[10px] text-outline truncate">{userAccount?.primaryEmail || 'Authenticated'}</p>
              </div>
            </div>
          {:else}
            <p class="text-outline text-[11px]">No active authorized session. Connect an identity provider below.</p>
          {/if}
          <div class="pt-2 border-t border-outline-variant/10 flex items-center gap-2">
            <button
              type="button"
              onclick={() => { isSettingsOpen = false; onOpenOAuthModal?.('login'); }}
              class="flex-1 py-1.5 px-2.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface border border-outline-variant/30 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <span class="material-symbols-outlined text-[14px]">sync_alt</span>
              <span>{isLoggedIn ? 'Switch / Re-auth Account' : 'Connect Account'}</span>
            </button>
            {#if isLoggedIn}
              <button
                type="button"
                onclick={() => { isSettingsOpen = false; document.dispatchEvent(new CustomEvent('logout')); }}
                class="py-1.5 px-2.5 rounded-lg bg-error/10 hover:bg-error/20 text-error border border-error/30 text-[11px] font-medium transition-colors cursor-pointer"
                title="Log Out"
              >
                Log Out
              </button>
            {/if}
          </div>
        </div>

        <div>
          <label class="block font-mono text-[11px] text-outline mb-1" for="pref-endpoint">Edge Proxy Gateway</label>
          <div class="flex items-center gap-2">
            <span class="px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/20 font-mono text-xs text-on-surface flex-1 truncate select-all">
              https://key-col.axe08.tech/v1/chat/completions
            </span>
            <button
              type="button"
              class="p-2 rounded-lg bg-surface-container border border-outline-variant/30 hover:bg-surface-container-high text-on-surface transition-colors cursor-pointer"
              onclick={() => navigator.clipboard.writeText('https://key-col.axe08.tech/v1/chat/completions')}
              title="Copy endpoint"
            >
              <span class="material-symbols-outlined text-[16px]">content_copy</span>
            </button>
          </div>
        </div>
        <div>
          <label class="block font-mono text-[11px] text-outline mb-1" for="pref-telemetry">Telemetry Poll Frequency</label>
          <select
            id="pref-telemetry"
            bind:value={telemetryPollFreq}
            class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/20 font-mono text-xs text-on-surface focus:outline-none focus:border-primary"
          >
            <option value="5s">5s</option>
            <option value="10s">10s</option>
            <option value="30s">30s</option>
            <option value="60s">60s</option>
          </select>
        </div>
        <div class="pt-2 border-t border-outline-variant/10">
          <h3 class="text-[12px] font-semibold text-on-surface mb-2">Developer Profile Customization</h3>
          <div class="space-y-3">
            <div>
              <label class="block font-mono text-[11px] text-outline mb-1" for="pref-display-name">Display Name Override</label>
              <input id="pref-display-name" type="text" bind:value={editDisplayName} class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/20 font-sans text-xs text-on-surface focus:outline-none focus:border-primary" placeholder="Enter display name..." />
            </div>
            <div>
              <label class="block font-mono text-[11px] text-outline mb-1" for="pref-avatar">Avatar Image URL Override</label>
              <input id="pref-avatar" type="text" bind:value={editAvatarUrl} class="w-full px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/20 font-mono text-xs text-on-surface focus:outline-none focus:border-primary" placeholder="https://example.com/avatar.png" />
            </div>
          </div>
        </div>
      </div>
      <div class="flex justify-end gap-2 pt-3 border-t border-outline-variant/20">
        <button type="button" onclick={() => (isSettingsOpen = false)} class="px-4 py-2 bg-transparent text-on-surface rounded-lg font-mono text-xs hover:bg-surface-container hover:opacity-90 cursor-pointer">Cancel</button>
        <button type="button" onclick={saveSettings} class="px-4 py-2 bg-primary text-on-primary rounded-lg font-mono text-xs font-semibold hover:opacity-90 cursor-pointer">Save Changes</button>
      </div>
    </div>
  </div>
{/if}

