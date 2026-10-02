<script lang="ts">
  import { onMount } from 'svelte';
  import type { APIKey } from './types';
  import RotateKeyModal from './RotateKeyModal.svelte';
  import PoolToggleModal from './PoolToggleModal.svelte';

  interface Props {
    keys?: APIKey[];
    onDeleteKey?: (id: string) => Promise<void>;
    onTestKey?: (id: string) => Promise<void>;
    onOpenAddModal?: () => void;
    onRefresh?: () => void;
  }

  let {
    keys = [],
    onDeleteKey,
    onTestKey,
    onOpenAddModal,
    onRefresh,
  }: Props = $props();

  let subTab = $state<'all' | 'private' | 'observation'>('all');
  let expandedKeyId = $state<string | null>(null);
  let rotateModalKey = $state<APIKey | null>(null);
  let poolToggleKey = $state<APIKey | null>(null);
  let nowMs = $state(Date.now());

  onMount(() => {
    const timer = setInterval(() => {
      nowMs = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });

  let filteredKeys = $derived.by(() => {
    if (subTab === 'private') {
      return keys.filter((k) => (k.pool_type ?? 'COMMUNITY') === 'PRIVATE');
    }
    if (subTab === 'observation') {
      return keys.filter((k) => k.community_routing_status === 'OBSERVATION');
    }
    return keys;
  });

  let privateCount = $derived(keys.filter((k) => (k.pool_type ?? 'COMMUNITY') === 'PRIVATE').length);
  let observationCount = $derived(keys.filter((k) => k.community_routing_status === 'OBSERVATION').length);

  function formatCountdown(obsUntil?: string | number | null): string {
    if (!obsUntil) return 'Graduated';
    const target = typeof obsUntil === 'number' ? obsUntil : Date.parse(String(obsUntil));
    if (Number.isNaN(target)) return 'Graduated';
    const diff = target - nowMs;
    if (diff <= 0) return 'Graduated (Ready)';
    const hours = Math.floor(diff / 3_600_000);
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    const secs = Math.floor((diff % 60_000) / 1000);
    return `${hours}h ${mins}m ${secs}s`;
  }

  function getCommunalSharePct(k: APIKey): number {
    if (typeof k.communal_share_pct === 'number') return k.communal_share_pct;
    const total = k.dispatched_today ?? k.requests_today ?? 0;
    const comm = k.dispatched_communal ?? 0;
    if (total <= 0) return 0;
    return Math.round((comm / total) * 100);
  }

  function toggleExpand(id: string) {
    expandedKeyId = expandedKeyId === id ? null : id;
  }
</script>

<div class="space-y-5 font-mono" data-testid="keys-view">
  <!-- Header & Add Key CTA -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-4">
    <div>
      <h1 class="text-headline-md font-semibold text-on-surface flex items-center gap-2.5">
        <span class="material-symbols-outlined text-primary text-[24px]">vpn_key</span>
        <span>Provider Key Vault</span>
      </h1>
      <p class="text-xs text-outline mt-1">
        Manage AES-256-GCM encrypted provider keys, monitor observation graduation, and inspect 24h dispatch shares.
      </p>
    </div>

    <div class="flex items-center gap-2">
      {#if onOpenAddModal}
        <button
          type="button"
          onclick={onOpenAddModal}
          class="px-3.5 py-2 rounded-lg bg-primary text-on-primary text-xs font-semibold flex items-center gap-1.5 hover:bg-primary/90 transition-colors cursor-pointer"
        >
          <span class="material-symbols-outlined text-[16px]">add_circle</span>
          <span>Add Provider Key</span>
        </button>
      {/if}
    </div>
  </div>

  <!-- Sub-Tabs Bar: My Keys / Private / Observation -->
  <div class="flex items-center gap-2 border-b border-outline-variant/20 pb-2" role="tablist">
    <button
      type="button"
      role="tab"
      aria-selected={subTab === 'all'}
      onclick={() => (subTab = 'all')}
      class="px-3.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-2 {subTab === 'all' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span>My Keys</span>
      <span class="px-1.5 py-0.2 rounded text-[10px] bg-surface-container text-on-surface-variant">{keys.length}</span>
    </button>

    <button
      type="button"
      role="tab"
      aria-selected={subTab === 'private'}
      onclick={() => (subTab = 'private')}
      class="px-3.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-2 {subTab === 'private' ? 'bg-primary/15 text-primary border border-primary/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span>Private</span>
      <span class="px-1.5 py-0.2 rounded text-[10px] bg-surface-container text-on-surface-variant">{privateCount}</span>
    </button>

    <button
      type="button"
      role="tab"
      aria-selected={subTab === 'observation'}
      onclick={() => (subTab = 'observation')}
      class="px-3.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-2 {subTab === 'observation' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold' : 'text-outline hover:text-on-surface hover:bg-surface-container/40'}"
    >
      <span>Observation</span>
      <span class="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/20 text-amber-300">{observationCount}</span>
    </button>
  </div>

  <!-- Keys Table -->
  <div class="rounded-xl border border-outline-variant/30 overflow-hidden bg-surface-container-low/70">
    <table class="w-full text-left text-xs">
      <thead class="bg-surface-container-highest/40 text-outline border-b border-outline-variant/20">
        <tr>
          <th class="py-2.5 px-3 font-medium">Key Label / Secret</th>
          <th class="py-2.5 px-3 font-medium">Provider</th>
          <th class="py-2.5 px-3 font-medium">Pool Mode</th>
          <th class="py-2.5 px-3 font-medium">Status</th>
          <th class="py-2.5 px-3 font-medium">24h Dispatch</th>
          {#if subTab === 'observation'}
            <th class="py-2.5 px-3 font-medium">Graduation Countdown</th>
          {/if}
          <th class="py-2.5 px-3 font-medium text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/10">
        {#if filteredKeys.length === 0}
          <tr>
            <td colspan={subTab === 'observation' ? 7 : 6} class="py-8 text-center text-outline">
              No keys in this view.
            </td>
          </tr>
        {:else}
          {#each filteredKeys as k (k.id)}
            <tr class="hover:bg-surface-container-highest/30 transition-colors">
              <td class="py-2.5 px-3">
                <button
                  type="button"
                  onclick={() => toggleExpand(k.id)}
                  class="flex items-center gap-2 text-on-surface font-semibold hover:text-primary cursor-pointer text-left"
                >
                  <span class="material-symbols-outlined text-[16px] text-outline">
                    {expandedKeyId === k.id ? 'expand_less' : 'expand_more'}
                  </span>
                  <div>
                    <div>{k.label || k.id}</div>
                    <div class="text-[10px] text-outline">{k.key_prefix ?? '••••'}...{k.key_suffix ?? '••••'}</div>
                  </div>
                </button>
              </td>
              <td class="py-2.5 px-3 uppercase text-outline">{k.provider}</td>
              <td class="py-2.5 px-3">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase {k.pool_type === 'PRIVATE' ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-secondary/15 text-secondary border border-secondary/30'}">
                  {k.pool_type ?? 'COMMUNITY'}
                </span>
              </td>
              <td class="py-2.5 px-3">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase {k.community_routing_status === 'OBSERVATION' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : k.status === 'healthy' ? 'bg-secondary/15 text-secondary border border-secondary/30' : 'bg-error/15 text-error border border-error/30'}">
                  {k.community_routing_status === 'OBSERVATION' ? 'OBSERVATION' : k.status}
                </span>
              </td>
              <td class="py-2.5 px-3 text-on-surface">
                {k.dispatched_today ?? k.requests_today ?? 0} / {k.rpd_limit ?? '—'}
              </td>
              {#if subTab === 'observation'}
                <td class="py-2.5 px-3 text-amber-300 font-semibold" data-testid="observation-countdown">
                  {formatCountdown(k.observation_until)}
                </td>
              {/if}
              <td class="py-2.5 px-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onclick={() => (rotateModalKey = k)}
                    class="px-2 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface border border-outline-variant/30 text-[10px] cursor-pointer"
                    title="Rotate Key Secret (Flow D)"
                  >
                    Rotate
                  </button>
                  <button
                    type="button"
                    onclick={() => (poolToggleKey = k)}
                    class="px-2 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface border border-outline-variant/30 text-[10px] cursor-pointer"
                    title="Switch Pool Mode (Flow E)"
                  >
                    {k.pool_type === 'PRIVATE' ? 'To Community' : 'To Private'}
                  </button>
                  {#if onTestKey}
                    <button
                      type="button"
                      onclick={() => onTestKey(k.id)}
                      class="px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 text-[10px] cursor-pointer"
                    >
                      Test
                    </button>
                  {/if}
                  {#if onDeleteKey}
                    <button
                      type="button"
                      onclick={() => onDeleteKey(k.id)}
                      class="px-2 py-1 rounded bg-error/15 hover:bg-error/25 text-error border border-error/30 text-[10px] cursor-pointer"
                    >
                      Delete
                    </button>
                  {/if}
                </div>
              </td>
            </tr>

            <!-- Expandable Row Details -->
            {#if expandedKeyId === k.id}
              <tr class="bg-surface-container-lowest/60" data-testid="key-expanded-detail">
                <td colspan={subTab === 'observation' ? 7 : 6} class="p-4">
                  <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-[11px]">
                    <div class="p-2.5 rounded bg-surface-container-high/40 border border-outline-variant/20">
                      <span class="text-[10px] text-outline uppercase block">Vesting Tier</span>
                      <span class="font-semibold text-on-surface mt-0.5 block">
                        Tier {k.vesting_tier ?? 0}
                      </span>
                    </div>

                    <div class="p-2.5 rounded bg-surface-container-high/40 border border-outline-variant/20">
                      <span class="text-[10px] text-outline uppercase block">Drain State</span>
                      <span class="font-semibold {k.drain_state && k.drain_state !== 'ACTIVE' ? 'text-amber-300' : 'text-secondary'} mt-0.5 block">
                        {k.drain_state ?? 'ACTIVE (Counts toward multiplier)'}
                      </span>
                    </div>

                    <div class="p-2.5 rounded bg-surface-container-high/40 border border-outline-variant/20">
                      <span class="text-[10px] text-outline uppercase block">Communal Share</span>
                      <span class="font-semibold text-on-surface mt-0.5 block">
                        {getCommunalSharePct(k)}% ({k.dispatched_communal ?? 0} reqs)
                      </span>
                    </div>

                    <div class="p-2.5 rounded bg-surface-container-high/40 border border-outline-variant/20">
                      <span class="text-[10px] text-outline uppercase block">Observation Status</span>
                      <span class="font-semibold text-on-surface mt-0.5 block">
                        {formatCountdown(k.observation_until)}
                      </span>
                    </div>

                    <div class="p-2.5 rounded bg-surface-container-high/40 border border-outline-variant/20">
                      <span class="text-[10px] text-outline uppercase block">RPM Cap</span>
                      <span class="font-semibold text-on-surface mt-0.5 block">
                        {k.rpm_limit ?? '—'} RPM
                      </span>
                    </div>

                    <div class="p-2.5 rounded bg-surface-container-high/40 border border-outline-variant/20">
                      <span class="text-[10px] text-outline uppercase block">Added Date</span>
                      <span class="font-semibold text-on-surface mt-0.5 block">
                        {k.created_at ? new Date(k.created_at).toLocaleDateString() : '—'}
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <!-- Rotate Key Modal -->
  {#if rotateModalKey}
    <RotateKeyModal
      isOpen={Boolean(rotateModalKey)}
      keyId={rotateModalKey.id}
      provider={rotateModalKey.provider === 'gemini' ? 'google' : rotateModalKey.provider}
      onClose={() => (rotateModalKey = null)}
      onRotated={() => onRefresh?.()}
    />
  {/if}

  <!-- Pool Toggle Modal -->
  {#if poolToggleKey}
    <PoolToggleModal
      isOpen={Boolean(poolToggleKey)}
      keyId={poolToggleKey.id}
      currentPoolType={poolToggleKey.pool_type ?? 'COMMUNITY'}
      onClose={() => (poolToggleKey = null)}
      onToggled={() => onRefresh?.()}
    />
  {/if}
</div>
