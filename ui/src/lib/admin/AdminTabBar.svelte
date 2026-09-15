<script lang="ts">
  let {
    adminTab = $bindable(),
    tenantsCount,
    trippedCircuitsCount,
  }: {
    adminTab: 'all' | 'surveillance' | 'velocity' | 'circuits';
    tenantsCount: number;
    trippedCircuitsCount: number;
  } = $props();
</script>

<div class="flex items-center justify-between border-b border-outline-variant/30 pb-2">
  <div class="flex items-center gap-2">
    <!-- Tab 1: Tenant Surveillance -->
    <button
      type="button"
      onclick={() => (adminTab = 'surveillance')}
      class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-mono text-label-md transition-all cursor-pointer {adminTab === 'surveillance' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span class="material-symbols-outlined text-[16px]">surveillance</span>
      <span>Tenant Surveillance</span>
      <span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-surface-container text-on-surface-variant">
        {tenantsCount}
      </span>
    </button>

    <!-- Tab 2: Velocity Dials -->
    <button
      type="button"
      onclick={() => (adminTab = 'velocity')}
      class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-mono text-label-md transition-all cursor-pointer {adminTab === 'velocity' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span class="material-symbols-outlined text-[16px]">speed</span>
      <span>Velocity Dials</span>
    </button>

    <!-- Tab 3: Circuit Breakers -->
    <button
      type="button"
      onclick={() => (adminTab = 'circuits')}
      class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-mono text-label-md transition-all cursor-pointer {adminTab === 'circuits' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span class="material-symbols-outlined text-[16px]">flash_on</span>
      <span>Circuit Breakers</span>
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
