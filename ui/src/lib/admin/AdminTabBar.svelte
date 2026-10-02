<script lang="ts">
  let {
    adminTab = $bindable(),
    tenantsCount,
    trippedCircuitsCount,
  }: {
    adminTab: 'all' | 'surveillance' | 'tenants' | 'keys' | 'providers' | 'audit' | 'velocity' | 'circuits';
    tenantsCount: number;
    trippedCircuitsCount: number;
  } = $props();
</script>

<div class="flex items-center justify-between border-b border-outline-variant/30 pb-2 overflow-x-auto">
  <div class="flex items-center gap-1.5 flex-nowrap">
    <!-- Tab: Overview / Surveillance -->
    <button
      type="button"
      onclick={() => (adminTab = 'surveillance')}
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs transition-all cursor-pointer whitespace-nowrap {adminTab === 'surveillance' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span class="material-symbols-outlined text-[16px]">overview</span>
      <span>Overview</span>
    </button>

    <!-- Tab: Tenants -->
    <button
      type="button"
      onclick={() => (adminTab = 'tenants')}
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs transition-all cursor-pointer whitespace-nowrap {adminTab === 'tenants' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span class="material-symbols-outlined text-[16px]">groups</span>
      <span>Tenants</span>
      <span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-surface-container text-on-surface-variant">
        {tenantsCount}
      </span>
    </button>

    <!-- Tab: Keys -->
    <button
      type="button"
      onclick={() => (adminTab = 'keys')}
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs transition-all cursor-pointer whitespace-nowrap {adminTab === 'keys' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span class="material-symbols-outlined text-[16px]">vpn_key</span>
      <span>Keys</span>
    </button>

    <!-- Tab: Providers -->
    <button
      type="button"
      onclick={() => (adminTab = 'providers')}
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs transition-all cursor-pointer whitespace-nowrap {adminTab === 'providers' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span class="material-symbols-outlined text-[16px]">dns</span>
      <span>Providers</span>
    </button>

    <!-- Tab: Audit Log -->
    <button
      type="button"
      onclick={() => (adminTab = 'audit')}
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs transition-all cursor-pointer whitespace-nowrap {adminTab === 'audit' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span class="material-symbols-outlined text-[16px]">history</span>
      <span>Audit Log</span>
    </button>

    <!-- Tab: Velocity Dials -->
    <button
      type="button"
      onclick={() => (adminTab = 'velocity')}
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs transition-all cursor-pointer whitespace-nowrap {adminTab === 'velocity' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span class="material-symbols-outlined text-[16px]">speed</span>
      <span>Velocity</span>
    </button>

    <!-- Tab: Circuit Breakers -->
    <button
      type="button"
      onclick={() => (adminTab = 'circuits')}
      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs transition-all cursor-pointer whitespace-nowrap {adminTab === 'circuits' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span class="material-symbols-outlined text-[16px]">flash_on</span>
      <span>Circuits</span>
      {#if trippedCircuitsCount > 0}
        <span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-error/20 text-error border border-error/40 animate-pulse">
          {trippedCircuitsCount}
        </span>
      {/if}
    </button>
  </div>

  <div class="hidden sm:flex items-center gap-2 text-xs font-mono text-outline">
    <span class="material-symbols-outlined text-[15px] text-secondary">verified_user</span>
    <span>AES-256-GCM Credential Vault Verified</span>
  </div>
</div>
