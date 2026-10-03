/**
 * One poller for GET /api/notifications (QA-06). App.svelte starts it; the bell in TopNavBar and
 * NotificationToasts both subscribe to `notificationsFeed`, so the endpoint is asked once per cycle.
 */
import { writable } from 'svelte/store';
import { api } from './api';
import type { NotificationItem } from './types';

export const NOTIFICATION_POLL_MS = 30_000;

const items = writable<NotificationItem[]>([]);

async function refresh(): Promise<void> {
  try {
    items.set((await api.getNotifications(0)).notifications);
  } catch (err) {
    console.error('Failed to load notifications', err);
  }
}

export const notificationsFeed = {
  subscribe: items.subscribe,
  refresh,
  /** Starts polling and returns the stop function. */
  start(intervalMs = NOTIFICATION_POLL_MS): () => void {
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  },
  markReadLocally(id: string): void {
    const now = Date.now();
    items.update((list) => list.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? now } : n)));
  },
};
