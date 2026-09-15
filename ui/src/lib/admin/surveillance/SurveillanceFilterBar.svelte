<script lang="ts">
  let {
    searchQuery = $bindable(),
    tierFilter = $bindable(),
    quarantineFilter = $bindable(),
    anomalyOnly = $bindable(),
    sortBy = $bindable(),
  }: {
    searchQuery: string;
    tierFilter: string;
    quarantineFilter: 'all' | 'active' | 'quarantined';
    anomalyOnly: boolean;
    sortBy: 'rpm' | 'spend' | 'recent' | 'id';
  } = $props();
</script>

<div class="p-3 rounded-xl bg-surface-container-low/90 backdrop-blur-md border border-outline-variant/30 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
  <!-- Search Input -->
  <div class="relative flex-1 min-w-[240px]">
    <span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-outline text-[16px]">search</span>
    <input
      bind:value={searchQuery}
      type="text"
      placeholder="Filter by Tenant ID, Email, Provider..."
      class="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface placeholder:text-outline focus:outline-none focus:border-primary transition-colors text-[12px]"
    />
  </div>

  <!-- Tier Filter Dropdown -->
  <div class="flex items-center gap-1.5">
    <label for="admin-tier-filter-select" class="text-outline text-[11px]">Tier:</label>
    <select
      id="admin-tier-filter-select"
      bind:value={tierFilter}
      class="px-2.5 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-[12px] focus:outline-none focus:border-primary cursor-pointer"
    >
      <option value="all">All Tiers</option>
      <option value="ultra">Ultra (VIP)</option>
      <option value="admin">Admin</option>
      <option value="max">Max (60 RPM)</option>
      <option value="builder">Builder (20 RPM)</option>
      <option value="probationary">Probationary (2 RPM)</option>
    </select>
  </div>

  <!-- Quarantine Toggle Buttons -->
  <div class="flex items-center rounded-lg bg-surface-container-lowest border border-outline-variant/30 p-0.5">
    <button
      type="button"
      onclick={() => (quarantineFilter = 'all')}
      class="px-2.5 py-1 rounded text-[11px] transition-colors cursor-pointer {quarantineFilter === 'all' ? 'bg-surface-container-high text-primary font-semibold' : 'text-outline hover:text-on-surface'}"
    >
      All
    </button>
    <button
      type="button"
      onclick={() => (quarantineFilter = 'active')}
      class="px-2.5 py-1 rounded text-[11px] transition-colors cursor-pointer {quarantineFilter === 'active' ? 'bg-surface-container-high text-secondary font-semibold' : 'text-outline hover:text-on-surface'}"
    >
      Active
    </button>
    <button
      type="button"
      onclick={() => (quarantineFilter = 'quarantined')}
      class="px-2.5 py-1 rounded text-[11px] transition-colors cursor-pointer {quarantineFilter === 'quarantined' ? 'bg-error/20 text-error font-semibold' : 'text-outline hover:text-on-surface'}"
    >
      Quarantined
    </button>
  </div>

  <!-- Anomaly High Velocity Filter -->
  <button
    type="button"
    onclick={() => (anomalyOnly = !anomalyOnly)}
    class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] transition-colors cursor-pointer {anomalyOnly ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-bold' : 'bg-surface-container-lowest text-outline border-outline-variant/30 hover:text-on-surface'}"
  >
    <span class="material-symbols-outlined text-[14px]">warning</span>
    <span>Spikes Only (&gt;85% Cap)</span>
  </button>

  <!-- Sort By -->
  <div class="flex items-center gap-1.5">
    <label for="admin-sort-by-select" class="text-outline text-[11px]">Sort:</label>
    <select
      id="admin-sort-by-select"
      bind:value={sortBy}
      class="px-2.5 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-[12px] focus:outline-none focus:border-primary cursor-pointer"
    >
      <option value="rpm">RPM Velocity</option>
      <option value="spend">Today's Spend (µ$)</option>
      <option value="recent">Recently Active</option>
      <option value="id">Tenant ID</option>
    </select>
  </div>
</div>
