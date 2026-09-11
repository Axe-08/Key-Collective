<script lang="ts">
  import type { APIKey, Provider, KeyStatus } from './types';

  let {
    keys,
    onDeleteKey,
    onTestKey,
    onOpenAddModal,
  }: {
    keys: APIKey[];
    onDeleteKey: (id: string) => Promise<void>;
    onTestKey: (id: string) => Promise<void>;
    onOpenAddModal?: () => void;
  } = $props();

  let searchQuery = $state('');
  let activeFilter = $state<'all' | 'gemini' | 'groq' | 'cooling'>('all');

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

  const geminiCount = $derived(keys.filter((k) => k.provider === 'gemini').length);
  const groqCount = $derived(keys.filter((k) => k.provider === 'groq').length);
  const coolingCount = $derived(keys.filter((k) => k.status === 'rate_limited').length);

  const filteredKeys = $derived(
    keys.filter((key) => {
      if (activeFilter === 'gemini' && key.provider !== 'gemini') return false;
      if (activeFilter === 'groq' && key.provider !== 'groq') return false;
      if (activeFilter === 'cooling' && key.status !== 'rate_limited') return false;

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
    if (!confirm(`Are you sure you want to revoke key "${label}" (${id}) from the pool?`)) {
      return;
    }
    deletingKeyId = id;
    try {
      await onDeleteKey(id);
    } finally {
      deletingKeyId = null;
    }
  }

  function copyKey(key: APIKey) {
    const mask = `${key.key_prefix}...${key.key_suffix}`;
    navigator.clipboard.writeText(mask);
    copiedKeyId = key.id;
    setTimeout(() => {
      if (copiedKeyId === key.id) copiedKeyId = null;
    }, 1500);
  }
</script>

<div class="specular-border bg-surface-container-low/80 backdrop-blur-xl rounded-xl border border-outline-variant/30 p-4">
  <!-- Table Toolbar & Filters -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-outline-variant/20">
    <!-- Filter Pills -->
    <div class="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onclick={() => (activeFilter = 'all')}
        class="px-3 py-1 rounded-lg text-label-md font-label-md font-medium transition-colors cursor-pointer {activeFilter === 'all' ? 'bg-surface-container-high border border-outline-variant/40 text-primary' : 'bg-surface-container-lowest/60 hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface'}"
      >
        All ({keys.length})
      </button>

      <button
        type="button"
        onclick={() => (activeFilter = 'gemini')}
        class="px-3 py-1 rounded-lg text-label-md font-label-md font-medium transition-colors cursor-pointer {activeFilter === 'gemini' ? 'bg-surface-container-high border border-outline-variant/40 text-primary' : 'bg-surface-container-lowest/60 hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface'}"
      >
        Gemini ({geminiCount})
      </button>

      <button
        type="button"
        onclick={() => (activeFilter = 'groq')}
        class="px-3 py-1 rounded-lg text-label-md font-label-md font-medium transition-colors cursor-pointer {activeFilter === 'groq' ? 'bg-surface-container-high border border-outline-variant/40 text-primary' : 'bg-surface-container-lowest/60 hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface'}"
      >
        Groq ({groqCount})
      </button>

      <button
        type="button"
        onclick={() => (activeFilter = 'cooling')}
        class="px-3 py-1 rounded-lg text-label-md font-label-md font-medium transition-colors cursor-pointer flex items-center gap-1.5 {activeFilter === 'cooling' ? 'bg-surface-container-high border border-outline-variant/40 text-tertiary' : 'bg-surface-container-lowest/60 hover:bg-surface-container-high text-tertiary'}"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-tertiary status-pulse"></span>
        Cooling Down ({coolingCount})
      </button>
    </div>

    <!-- Right Controls: Search & Primary Action -->
    <div class="flex items-center gap-2.5">
      <!-- Search Input -->
      <div class="relative w-48 sm:w-56">
        <span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-outline text-[14px]">search</span>
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Filter keys..."
          class="w-full pl-8 pr-3 py-1 bg-surface-container-lowest/80 border border-outline-variant/30 rounded-lg text-code-sm font-code-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      <!-- Add Provider Key Button -->
      {#if onOpenAddModal}
        <button
          type="button"
          onclick={onOpenAddModal}
          class="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary-container text-on-primary font-medium text-label-md font-label-md hover:bg-primary-container/90 transition-all active:scale-[0.98] shadow-[0_0_16px_rgba(128,131,255,0.3)] cursor-pointer whitespace-nowrap"
        >
          <span class="material-symbols-outlined text-[16px]" data-icon="add">add</span>
          <span>+ Add Provider Key</span>
        </button>
      {/if}
    </div>
  </div>

  <!-- Developer Data Table -->
  <div class="overflow-x-auto mt-3">
    <table class="w-full text-left border-collapse">
      <thead>
        <tr class="border-b border-outline-variant/20 text-label-sm font-label-sm text-outline uppercase tracking-wider font-mono">
          <th class="py-2.5 px-3 font-medium">Provider &amp; Label</th>
          <th class="py-2.5 px-3 font-medium">Masked API Key</th>
          <th class="py-2.5 px-3 font-medium">RPM Gauge</th>
          <th class="py-2.5 px-3 font-medium">Daily Quota</th>
          <th class="py-2.5 px-3 font-medium">Status</th>
          <th class="py-2.5 px-3 font-medium text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/10 text-code-sm font-code-sm">
        {#if filteredKeys.length === 0}
          <tr>
            <td colspan="6" class="py-8 text-center text-outline font-mono">
              No API keys matching the current selection.
            </td>
          </tr>
        {:else}
          {#each filteredKeys as key (key.id)}
            {@const rpmUsed = key.requests_this_min || 0}
            {@const rpmLimit = key.rpm_limit || 60}
            {@const rpmPct = Math.min(100, Math.round((rpmUsed / rpmLimit) * 100))}
            {@const rpdUsed = key.requests_today || 0}
            {@const rpdLimit = key.rpd_limit || 10000}
            {@const rpdPct = Math.min(100, Math.round((rpdUsed / rpdLimit) * 100))}
            {@const cooldownSec = getCooldownSeconds(key.cooldown_until)}

            <tr class="hover:bg-surface-container-high/30 transition-colors group {key.status === 'rate_limited' ? 'bg-tertiary/5' : ''}">
              <!-- Provider & Label -->
              <td class="py-3 px-3">
                <div class="flex items-center gap-2.5">
                  <div class="w-7 h-7 rounded {key.provider === 'gemini' ? 'bg-primary/10 border border-primary/20 text-primary' : 'bg-tertiary/10 border border-tertiary/20 text-tertiary'} flex items-center justify-center shrink-0">
                    <span class="material-symbols-outlined text-[16px]" data-icon={key.provider === 'gemini' ? 'token' : 'bolt'}>
                      {key.provider === 'gemini' ? 'token' : 'bolt'}
                    </span>
                  </div>
                  <div>
                    <div class="text-on-surface font-body-md text-body-md font-medium leading-tight">
                      {key.label}
                    </div>
                    <div class="text-label-sm font-label-sm text-outline font-mono mt-0.5">
                      Weight: {key.priority === 0 ? '40' : key.priority === 1 ? '35' : '25'} • {key.provider === 'gemini' ? 'Google AI' : 'Groq Cloud'}
                    </div>
                  </div>
                </div>
              </td>

              <!-- Masked API Key with copy interaction -->
              <td class="py-3 px-3">
                <div class="flex items-center gap-2 font-mono">
                  <span class="text-on-surface font-code-sm text-code-sm bg-surface-container-lowest px-2 py-0.5 rounded border border-outline-variant/20">
                    {key.key_prefix}...{key.key_suffix}
                  </span>
                  <button
                    type="button"
                    onclick={() => copyKey(key)}
                    class="copy-btn text-outline hover:text-on-surface p-1 rounded hover:bg-surface-container transition-colors cursor-pointer"
                    title="Copy Key Mask"
                  >
                    <span class="material-symbols-outlined text-[14px] {copiedKeyId === key.id ? 'text-secondary' : ''}" data-icon={copiedKeyId === key.id ? 'check' : 'content_copy'}>
                      {copiedKeyId === key.id ? 'check' : 'content_copy'}
                    </span>
                  </button>
                </div>
              </td>

              <!-- RPM Gauge -->
              <td class="py-3 px-3">
                <div class="flex items-center gap-2 font-mono">
                  <span class="{key.status === 'rate_limited' ? 'text-tertiary font-medium' : 'text-on-surface font-medium'}">
                    {rpmUsed} / {rpmLimit}
                  </span>
                  <div class="w-12 bg-surface-container-highest h-1 rounded-full overflow-hidden">
                    <div
                      class="{key.status === 'rate_limited' ? 'bg-tertiary' : rpmPct >= 80 ? 'bg-primary' : 'bg-secondary'} h-full transition-all duration-300"
                      style="width: {rpmPct}%;"
                    ></div>
                  </div>
                </div>
              </td>

              <!-- Daily Quota -->
              <td class="py-3 px-3">
                <div class="w-24 font-mono">
                  <div class="flex justify-between text-label-sm font-label-sm {key.status === 'rate_limited' ? 'text-tertiary' : 'text-outline'} mb-1">
                    <span>{rpdUsed >= 1000 ? (rpdUsed / 1000).toFixed(1) + 'k' : rpdUsed}</span>
                    <span>{rpdPct}%</span>
                  </div>
                  <div class="w-full bg-surface-container-highest h-1 rounded-full overflow-hidden">
                    <div
                      class="{key.status === 'rate_limited' ? 'bg-tertiary' : 'bg-secondary'} h-full transition-all duration-300"
                      style="width: {rpdPct}%;"
                    ></div>
                  </div>
                </div>
              </td>

              <!-- Status Badge -->
              <td class="py-3 px-3 font-mono">
                {#if key.status === 'healthy'}
                  <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-secondary/10 border border-secondary/30 text-secondary text-label-sm font-label-sm font-medium">
                    <span class="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                    Healthy
                  </span>
                {:else if key.status === 'rate_limited'}
                  <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-tertiary/10 border border-tertiary/30 text-tertiary text-label-sm font-label-sm font-medium">
                    <span class="w-1.5 h-1.5 rounded-full bg-tertiary status-pulse"></span>
                    429 Cooling [{cooldownSec > 0 ? cooldownSec + 's' : '00:28s'}]
                  </span>
                {:else if key.status === 'invalid'}
                  <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-error-container/40 border border-error/30 text-error text-label-sm font-label-sm font-medium">
                    <span class="w-1.5 h-1.5 rounded-full bg-error"></span>
                    Invalid
                  </span>
                {:else}
                  <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-container-high border border-outline-variant/30 text-on-surface-variant text-label-sm font-label-sm font-medium">
                    {key.status}
                  </span>
                {/if}
              </td>

              <!-- Actions -->
              <td class="py-3 px-3 text-right">
                <div class="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onclick={() => handleTest(key.id)}
                    disabled={testingKeyId === key.id}
                    class="p-1 rounded text-outline hover:text-primary hover:bg-surface-container transition-colors cursor-pointer disabled:opacity-50"
                    title="Ping Test"
                  >
                    <span class="material-symbols-outlined text-[16px] {testingKeyId === key.id ? 'animate-spin text-primary' : ''}" data-icon="network_ping">network_ping</span>
                  </button>
                  <button
                    type="button"
                    onclick={() => handleDelete(key.id, key.label)}
                    disabled={deletingKeyId === key.id}
                    class="p-1 rounded text-outline hover:text-error hover:bg-surface-container transition-colors cursor-pointer disabled:opacity-50"
                    title="Revoke Key"
                  >
                    <span class="material-symbols-outlined text-[16px]" data-icon="do_not_disturb_on">do_not_disturb_on</span>
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
