<script lang="ts">
  import type { APIKey, Provider, KeyStatus } from './types';

  let {
    keys,
    onDeleteKey,
    onTestKey,
  }: {
    keys: APIKey[];
    onDeleteKey: (id: string) => Promise<void>;
    onTestKey: (id: string) => Promise<void>;
  } = $props();

  let searchQuery = $state('');
  let providerFilter = $state<string>('all');
  let statusFilter = $state<string>('all');

  let testingKeyId = $state<string | null>(null);
  let deletingKeyId = $state<string | null>(null);
  let copiedKeyId = $state<string | null>(null);

  // Dynamic countdown timers
  let currentTime = $state(Date.now());
  $effect(() => {
    const interval = setInterval(() => {
      currentTime = Date.now();
    }, 1000);
    return () => clearInterval(interval);
  });

  function getCooldownSeconds(cooldownUntil?: string | null): number {
    if (!cooldownUntil) return 0;
    const diff = Math.ceil((new Date(cooldownUntil).getTime() - currentTime) / 1000);
    return diff > 0 ? diff : 0;
  }

  const filteredKeys = $derived(
    keys.filter((key) => {
      if (providerFilter !== 'all' && key.provider !== providerFilter) return false;
      if (statusFilter !== 'all' && key.status !== statusFilter) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        return (
          key.label.toLowerCase().includes(q) ||
          key.key_prefix.toLowerCase().includes(q) ||
          key.key_suffix.toLowerCase().includes(q) ||
          key.id.toLowerCase().includes(q)
        );
      }
      return true;
    })
  );

  async function handleTest(id: string) {
    if (testingKeyId) return;
    testingKeyId = id;
    try {
      await onTestKey(id);
    } finally {
      testingKeyId = null;
    }
  }

  async function handleDelete(id: string, label: string) {
    if (!confirm(`Are you sure you want to remove the key "${label}" (${id}) from the pool?`)) {
      return;
    }
    deletingKeyId = id;
    try {
      await onDeleteKey(id);
    } finally {
      deletingKeyId = null;
    }
  }

  function copyKeyMask(key: APIKey) {
    const mask = `${key.key_prefix}...${key.key_suffix}`;
    navigator.clipboard.writeText(mask);
    copiedKeyId = key.id;
    setTimeout(() => {
      if (copiedKeyId === key.id) copiedKeyId = null;
    }, 1800);
  }
</script>

<div class="glass-surface specular-border rounded-xl shadow-xl overflow-hidden">
  <!-- Table Controls Header -->
  <div class="p-4 border-b border-white/[0.08] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#0C0F17]/60">
    <div class="flex items-center gap-2">
      <h2 class="text-sm font-semibold font-mono uppercase tracking-wider text-slate-200">
        Managed Keys Pool
      </h2>
      <span class="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-slate-800 text-slate-300 border border-white/10">
        {filteredKeys.length} of {keys.length}
      </span>
    </div>

    <!-- Filters and Search -->
    <div class="flex flex-wrap items-center gap-2">
      <!-- Search -->
      <div class="relative min-w-[180px] flex-1 sm:flex-initial">
        <svg class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd" />
        </svg>
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Filter label or key..."
          class="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950/70 border border-white/10 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />
      </div>

      <!-- Provider Filter -->
      <select
        bind:value={providerFilter}
        class="py-1.5 px-2.5 rounded-lg bg-slate-950/70 border border-white/10 text-xs font-mono text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
        aria-label="Filter keys by provider"
      >
        <option value="all">All Providers</option>
        <option value="gemini">Gemini</option>
        <option value="groq">Groq</option>
      </select>

      <!-- Status Filter -->
      <select
        bind:value={statusFilter}
        class="py-1.5 px-2.5 rounded-lg bg-slate-950/70 border border-white/10 text-xs font-mono text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
        aria-label="Filter keys by status"
      >
        <option value="all">All Statuses</option>
        <option value="healthy">Healthy</option>
        <option value="rate_limited">Rate Limited</option>
        <option value="invalid">Invalid</option>
      </select>
    </div>
  </div>

  <!-- Keys Data Table -->
  <div class="overflow-x-auto">
    <table class="w-full text-left text-xs font-mono border-collapse">
      <thead>
        <tr class="border-b border-white/[0.08] bg-slate-950/40 text-slate-400 uppercase tracking-wider text-[11px]">
          <th class="py-3 px-4 font-semibold">Provider</th>
          <th class="py-3 px-4 font-semibold">Label</th>
          <th class="py-3 px-4 font-semibold">Key Token</th>
          <th class="py-3 px-4 font-semibold">Status</th>
          <th class="py-3 px-4 font-semibold">Priority</th>
          <th class="py-3 px-4 font-semibold min-w-[160px]">RPM Usage</th>
          <th class="py-3 px-4 font-semibold">RPD Usage</th>
          <th class="py-3 px-4 font-semibold text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-white/[0.05]">
        {#if filteredKeys.length === 0}
          <tr>
            <td colspan="8" class="py-10 text-center text-slate-500 font-mono">
              No API keys matching the current filters.
            </td>
          </tr>
        {:else}
          {#each filteredKeys as key (key.id)}
            {@const rpmUsed = key.requests_this_min || 0}
            {@const rpmPct = Math.min(100, Math.round((rpmUsed / key.rpm_limit) * 100))}
            {@const rpdUsed = key.requests_today || 0}
            {@const rpdPct = Math.min(100, Math.round((rpdUsed / key.rpd_limit) * 100))}
            {@const cooldownSec = getCooldownSeconds(key.cooldown_until)}

            <tr class="hover:bg-slate-800/30 transition-colors group">
              <!-- Provider Badge -->
              <td class="py-3 px-4">
                {#if key.provider === 'gemini'}
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/25">
                    <svg class="w-3 h-3 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
                    </svg>
                    Gemini
                  </span>
                {:else}
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/25">
                    <svg class="w-3 h-3 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                    Groq
                  </span>
                {/if}
              </td>

              <!-- Label -->
              <td class="py-3 px-4">
                <div class="flex items-center gap-1.5 font-medium text-slate-200">
                  <span class="truncate max-w-[170px]" title={key.label}>{key.label}</span>
                </div>
                <span class="text-[10px] text-slate-500 font-mono">{key.id}</span>
              </td>

              <!-- Masked Key -->
              <td class="py-3 px-4">
                <button
                  type="button"
                  onclick={() => copyKeyMask(key)}
                  class="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-950/60 border border-white/10 text-slate-300 hover:text-white hover:border-white/20 transition-all active:scale-95 group/btn cursor-pointer"
                  title="Click to copy masked key"
                >
                  <span class="font-mono text-[11px] tracking-wider text-slate-400 group-hover/btn:text-slate-200">
                    {key.key_prefix}...{key.key_suffix}
                  </span>
                  {#if copiedKeyId === key.id}
                    <svg class="w-3 h-3 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                    </svg>
                  {:else}
                    <svg class="w-3 h-3 text-slate-500 group-hover/btn:text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  {/if}
                </button>
              </td>

              <!-- Status -->
              <td class="py-3 px-4">
                {#if key.status === 'healthy'}
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Healthy
                  </span>
                {:else if key.status === 'rate_limited'}
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25" title="Rate limit cooldown">
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    Rate Limited
                    {#if cooldownSec > 0}
                      <span class="font-mono text-[10px] text-amber-300 font-bold bg-amber-500/20 px-1 rounded">{cooldownSec}s</span>
                    {/if}
                  </span>
                {:else if key.status === 'invalid'}
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/25">
                    <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                    Invalid Key
                  </span>
                {:else}
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                    <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                    {key.status}
                  </span>
                {/if}
              </td>

              <!-- Priority -->
              <td class="py-3 px-4">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold {key.priority === 0 ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' : key.priority === 1 ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30' : 'bg-slate-800 text-slate-400 border border-white/10'}">
                  P{key.priority}
                </span>
              </td>

              <!-- RPM Usage Bar -->
              <td class="py-3 px-4">
                <div class="flex flex-col gap-1">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-semibold text-slate-300">{rpmUsed} <span class="text-slate-500 font-normal">/ {key.rpm_limit}</span></span>
                    <span class="text-[10px] {rpmPct >= 90 ? 'text-rose-400 font-bold' : rpmPct >= 70 ? 'text-amber-400' : 'text-slate-400'}">
                      {rpmPct}%
                    </span>
                  </div>
                  <div class="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-white/5">
                    <div
                      class="h-full rounded-full transition-all duration-300 {rpmPct >= 90 ? 'bg-rose-500' : rpmPct >= 70 ? 'bg-amber-500' : 'bg-emerald-400'}"
                      style="width: {rpmPct}%"
                    ></div>
                  </div>
                </div>
              </td>

              <!-- RPD Usage -->
              <td class="py-3 px-4">
                <div class="flex flex-col">
                  <span class="text-slate-300 font-medium">{rpdUsed.toLocaleString()} <span class="text-slate-500 text-[10px]">/ {key.rpd_limit.toLocaleString()}</span></span>
                  <span class="text-[10px] text-slate-500">{rpdPct}% day used</span>
                </div>
              </td>

              <!-- Actions -->
              <td class="py-3 px-4 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <!-- Test Button -->
                  <button
                    type="button"
                    onclick={() => handleTest(key.id)}
                    disabled={testingKeyId === key.id}
                    class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-white/10 transition-all active:scale-95 disabled:opacity-50 text-[11px] cursor-pointer"
                    title="Run live latency and authorization test"
                  >
                    {#if testingKeyId === key.id}
                      <span class="inline-flex items-center gap-1 text-indigo-400">
                        <svg class="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                        </svg>
                        Testing
                      </span>
                    {:else}
                      Test
                    {/if}
                  </button>

                  <!-- Delete Button -->
                  <button
                    type="button"
                    onclick={() => handleDelete(key.id, key.label)}
                    disabled={deletingKeyId === key.id}
                    class="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-800/40 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                    title="Delete key"
                    aria-label="Delete key"
                  >
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>
