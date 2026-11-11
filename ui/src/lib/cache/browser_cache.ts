export const DEFAULT_CACHE_TTL_MS = 300_000; // 5 minutes

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  dirty: boolean;
}

const cache = new Map<string, CacheEntry<unknown>>();

let lastFetch: unknown = typeof globalThis !== 'undefined' ? (globalThis as unknown as { fetch?: unknown }).fetch : undefined;

export function invalidateCache(keyPrefix?: string): void {
  if (keyPrefix) {
    for (const [k, entry] of cache.entries()) {
      if (k === keyPrefix || k.startsWith(keyPrefix)) {
        entry.dirty = true;
      }
    }
  } else {
    for (const entry of cache.values()) {
      entry.dirty = true;
    }
  }
}

export function clearCache(): void {
  cache.clear();
}

export async function fetchWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: { ttlMs?: number; force?: boolean }
): Promise<T> {
  if (typeof globalThis !== 'undefined') {
    const currentFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
    if (currentFetch !== lastFetch) {
      lastFetch = currentFetch;
      invalidateCache();
    }
  }

  const now = Date.now();
  const ttl = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS;

  if (!options?.force) {
    const entry = cache.get(key) as CacheEntry<T> | undefined;
    if (entry && !entry.dirty && now - entry.timestamp < ttl) {
      return entry.data;
    }
  }

  const data = await fetcher();
  cache.set(key, {
    data,
    timestamp: Date.now(),
    dirty: false,
  });
  return data;
}
