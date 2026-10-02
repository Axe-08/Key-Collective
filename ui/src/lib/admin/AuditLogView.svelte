<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';

  interface AuditEvent {
    id: string;
    admin_user_id: string | null;
    admin_email: string;
    action: string;
    target: string;
    details_json: string;
    ip_address: string;
    created_at: number;
  }

  let events = $state<AuditEvent[]>([]);
  let total = $state(0);
  let limit = $state(25);
  let offset = $state(0);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function loadAuditLogs() {
    loading = true;
    error = null;
    try {
      const res = await api.getAdminAuditLogs(limit, offset);
      events = res.events;
      total = res.total;
    } catch (err) {
      error = (err as Error).message || 'Failed to fetch audit logs';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadAuditLogs();
  });

  function nextPage() {
    if (offset + limit < total) {
      offset += limit;
      loadAuditLogs();
    }
  }

  function prevPage() {
    if (offset >= limit) {
      offset -= limit;
      loadAuditLogs();
    }
  }
</script>

<div class="space-y-4 font-mono text-xs" data-testid="admin-audit-log-view">
  <div class="flex items-center justify-between">
    <div class="text-xs text-outline">
      Showing {events.length > 0 ? offset + 1 : 0} to {Math.min(offset + events.length, total)} of {total} audit records
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={loadAuditLogs}
        class="p-1 rounded bg-surface-container hover:bg-surface-container-high text-outline hover:text-on-surface cursor-pointer"
        title="Refresh"
      >
        <span class="material-symbols-outlined text-[16px] {loading ? 'animate-spin' : ''}">refresh</span>
      </button>
      <button
        type="button"
        onclick={prevPage}
        disabled={offset === 0 || loading}
        class="px-2 py-1 rounded bg-surface-container hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-xs"
      >
        Previous
      </button>
      <button
        type="button"
        onclick={nextPage}
        disabled={offset + limit >= total || loading}
        class="px-2 py-1 rounded bg-surface-container hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-xs"
      >
        Next
      </button>
    </div>
  </div>

  {#if error}
    <div class="p-3 rounded bg-error/10 border border-error/30 text-error">
      {error}
    </div>
  {/if}

  <div class="rounded-xl border border-outline-variant/30 overflow-hidden bg-surface-container-low/70">
    <table class="w-full text-left font-mono text-xs">
      <thead class="bg-surface-container-highest/40 text-outline border-b border-outline-variant/20">
        <tr>
          <th class="py-2.5 px-3 font-medium">Timestamp</th>
          <th class="py-2.5 px-3 font-medium">Actor</th>
          <th class="py-2.5 px-3 font-medium">Action</th>
          <th class="py-2.5 px-3 font-medium">Target</th>
          <th class="py-2.5 px-3 font-medium">Details</th>
          <th class="py-2.5 px-3 font-medium">IP</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/10">
        {#if loading && events.length === 0}
          <tr>
            <td colspan="6" class="py-8 text-center text-outline">
              Loading audit logs...
            </td>
          </tr>
        {:else if events.length === 0}
          <tr>
            <td colspan="6" class="py-8 text-center text-outline">
              No audit logs recorded yet.
            </td>
          </tr>
        {:else}
          {#each events as e (e.id)}
            <tr class="hover:bg-surface-container-highest/30 transition-colors">
              <td class="py-2.5 px-3 text-outline whitespace-nowrap">
                {new Date(e.created_at).toLocaleString()}
              </td>
              <td class="py-2.5 px-3 text-on-surface font-semibold truncate max-w-[140px]">
                {e.admin_email}
              </td>
              <td class="py-2.5 px-3">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/15 text-primary border border-primary/20">
                  {e.action}
                </span>
              </td>
              <td class="py-2.5 px-3 text-on-surface truncate max-w-[140px]">
                {e.target}
              </td>
              <td class="py-2.5 px-3 text-outline truncate max-w-[220px]" title={e.details_json}>
                {e.details_json}
              </td>
              <td class="py-2.5 px-3 text-outline text-[11px]">
                {e.ip_address}
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>
