<script lang="ts">
  import { api } from './api';
  import { notificationsFeed } from './notifications_feed';

  // Reads the shared feed; App.svelte owns the polling (QA-06).
  const activeNotifications = $derived($notificationsFeed.filter((n) => !n.read_at));

  async function handleDismiss(id: string) {
    notificationsFeed.markReadLocally(id);
    const ok = await api.markNotificationRead(id);
    if (!ok) console.error('Failed to mark notification read', id);
  }
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
