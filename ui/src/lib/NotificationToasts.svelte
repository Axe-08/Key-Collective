<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './api';

  interface NotificationItem {
    id: string;
    tenant_id: string;
    type: string;
    key_id: string | null;
    message: string;
    created_at: number;
    read_at: number | null;
  }

  let {
    pollIntervalMs = 30000,
  }: {
    pollIntervalMs?: number;
  } = $props();

  let activeNotifications = $state<NotificationItem[]>([]);
  let lastSince = $state(0);
  let dismissedIds = new Set<string>();

  async function pollNotifications() {
    try {
      const res = await api.getNotifications(lastSince);
      const incoming = res.notifications || [];
      let maxCreated = lastSince;

      for (const n of incoming) {
        if (n.created_at > maxCreated) {
          maxCreated = n.created_at;
        }
        if (!n.read_at && !dismissedIds.has(n.id) && !activeNotifications.some((a) => a.id === n.id)) {
          activeNotifications = [...activeNotifications, n];
        }
      }
      lastSince = maxCreated;
    } catch {
      // Non-blocking fallback
    }
  }

  async function handleDismiss(id: string) {
    dismissedIds.add(id);
    activeNotifications = activeNotifications.filter((n) => n.id !== id);
    await api.markNotificationRead(id);
  }

  onMount(() => {
    void pollNotifications();
    const timer = setInterval(pollNotifications, pollIntervalMs);
    return () => clearInterval(timer);
  });
</script>

{#if activeNotifications.length > 0}
  <div class="fixed bottom-5 left-5 z-50 flex flex-col gap-2.5 max-w-sm w-full font-mono text-xs" data-testid="notification-toasts">
    {#each activeNotifications as notif (notif.id)}
      <div class="p-3.5 rounded-xl bg-surface-container-high/95 backdrop-blur-md border border-amber-500/40 shadow-2xl flex items-start justify-between gap-3">
        <div class="flex items-start gap-2.5">
          <span class="material-symbols-outlined text-[18px] text-amber-400 shrink-0 mt-0.5">
            notifications_active
          </span>
          <div>
            <div class="font-semibold text-on-surface">{notif.message}</div>
            <div class="text-[10px] text-outline mt-1">
              {new Date(notif.created_at).toLocaleTimeString()}
            </div>
          </div>
        </div>
        <button
          type="button"
          onclick={() => handleDismiss(notif.id)}
          class="text-outline hover:text-on-surface p-1 rounded cursor-pointer"
          title="Dismiss and mark as read"
          aria-label="Dismiss notification"
        >
          <span class="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
    {/each}
  </div>
{/if}
