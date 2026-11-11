import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchWithCache,
  invalidateCache,
  clearCache,
  DEFAULT_CACHE_TTL_MS,
} from './browser_cache';

describe('browser_cache unit test suite', () => {
  beforeEach(() => {
    clearCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports DEFAULT_CACHE_TTL_MS as 300_000 ms (5 minutes)', () => {
    expect(DEFAULT_CACHE_TTL_MS).toBe(300_000);
  });

  it('fetchWithCache caches initial fetcher output in memory', async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 1, name: 'initial' });
    const res = await fetchWithCache('test-key', fetcher);
    expect(res).toEqual({ id: 1, name: 'initial' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('sequential calls within TTL return cached data without re-executing fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue(['item-1', 'item-2']);
    const res1 = await fetchWithCache('list-key', fetcher);
    const res2 = await fetchWithCache('list-key', fetcher);
    const res3 = await fetchWithCache('list-key', fetcher, { force: false });

    expect(res1).toEqual(['item-1', 'item-2']);
    expect(res2).toEqual(['item-1', 'item-2']);
    expect(res3).toEqual(['item-1', 'item-2']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('correctly caches falsy values (null, false, 0, "") without re-executing fetcher', async () => {
    const nullFetcher = vi.fn().mockResolvedValue(null);
    const zeroFetcher = vi.fn().mockResolvedValue(0);
    const falseFetcher = vi.fn().mockResolvedValue(false);
    const emptyStrFetcher = vi.fn().mockResolvedValue('');

    expect(await fetchWithCache('null-key', nullFetcher)).toBeNull();
    expect(await fetchWithCache('null-key', nullFetcher)).toBeNull();
    expect(nullFetcher).toHaveBeenCalledTimes(1);

    expect(await fetchWithCache('zero-key', zeroFetcher)).toBe(0);
    expect(await fetchWithCache('zero-key', zeroFetcher)).toBe(0);
    expect(zeroFetcher).toHaveBeenCalledTimes(1);

    expect(await fetchWithCache('false-key', falseFetcher)).toBe(false);
    expect(await fetchWithCache('false-key', falseFetcher)).toBe(false);
    expect(falseFetcher).toHaveBeenCalledTimes(1);

    expect(await fetchWithCache('empty-str-key', emptyStrFetcher)).toBe('');
    expect(await fetchWithCache('empty-str-key', emptyStrFetcher)).toBe('');
    expect(emptyStrFetcher).toHaveBeenCalledTimes(1);
  });

  it('invalidateCache("keys") marks matching entries dirty, forcing a re-fetch on the next invocation while unaffected cached entries remain intact', async () => {
    let callCount = 0;
    const keysFetcher = vi.fn().mockImplementation(async () => {
      callCount++;
      return { keys: [`key-${callCount}`] };
    });
    const statsFetcher = vi.fn().mockResolvedValue({ stats: 'ok' });

    await fetchWithCache('keys', keysFetcher);
    await fetchWithCache('keys:detail', keysFetcher);
    await fetchWithCache('stats', statsFetcher);
    expect(keysFetcher).toHaveBeenCalledTimes(2);
    expect(statsFetcher).toHaveBeenCalledTimes(1);

    // Invalidate prefix 'keys'
    invalidateCache('keys');

    // keys and keys:detail should re-fetch
    const refreshedKeys = await fetchWithCache('keys', keysFetcher);
    expect(refreshedKeys).toEqual({ keys: ['key-3'] });
    expect(keysFetcher).toHaveBeenCalledTimes(3);

    const refreshedDetail = await fetchWithCache('keys:detail', keysFetcher);
    expect(refreshedDetail).toEqual({ keys: ['key-4'] });
    expect(keysFetcher).toHaveBeenCalledTimes(4);

    // stats was NOT invalidated, so it should still be cached
    const cachedStats = await fetchWithCache('stats', statsFetcher);
    expect(cachedStats).toEqual({ stats: 'ok' });
    expect(statsFetcher).toHaveBeenCalledTimes(1);

    // Once refreshed, the entry dirty flag should be reset so subsequent calls are cached again
    const cachedKeysAgain = await fetchWithCache('keys', keysFetcher);
    expect(cachedKeysAgain).toEqual({ keys: ['key-3'] });
    expect(keysFetcher).toHaveBeenCalledTimes(4);
  });

  it('invalidateCache() without arguments marks all entries dirty, forcing re-fetch on subsequent calls', async () => {
    const f1 = vi.fn().mockResolvedValue('val1');
    const f2 = vi.fn().mockResolvedValue('val2');

    await fetchWithCache('k1', f1);
    await fetchWithCache('k2', f2);
    expect(f1).toHaveBeenCalledTimes(1);
    expect(f2).toHaveBeenCalledTimes(1);

    invalidateCache();

    await fetchWithCache('k1', f1);
    await fetchWithCache('k2', f2);
    expect(f1).toHaveBeenCalledTimes(2);
    expect(f2).toHaveBeenCalledTimes(2);
  });

  it('force: true bypasses cache and updates stored timestamp', async () => {
    vi.setSystemTime(1000);
    const fetcher = vi.fn()
      .mockResolvedValueOnce('v1')
      .mockResolvedValueOnce('v2');

    const res1 = await fetchWithCache('force-key', fetcher);
    expect(res1).toBe('v1');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Call with force: true at timestamp 5000
    vi.setSystemTime(5000);
    const res2 = await fetchWithCache('force-key', fetcher, { force: true });
    expect(res2).toBe('v2');
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Subsequent call within TTL from new timestamp (5000 + 1000 = 6000) should return v2 without calling fetcher
    vi.setSystemTime(6000);
    const res3 = await fetchWithCache('force-key', fetcher);
    expect(res3).toBe('v2');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('expired TTL triggers a re-fetch using fake timers', async () => {
    vi.setSystemTime(1000);
    const fetcher = vi.fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');

    // Default TTL is 300_000 ms
    await fetchWithCache('expire-key', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance 299_999 ms (still fresh)
    vi.advanceTimersByTime(299_999);
    const resFresh = await fetchWithCache('expire-key', fetcher);
    expect(resFresh).toBe('first');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance another 2 ms (now expired at 300_001 ms)
    vi.advanceTimersByTime(2);
    const resExpired = await fetchWithCache('expire-key', fetcher);
    expect(resExpired).toBe('second');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('custom ttlMs options are respected', async () => {
    vi.setSystemTime(1000);
    const fetcher = vi.fn()
      .mockResolvedValueOnce('custom1')
      .mockResolvedValueOnce('custom2');

    await fetchWithCache('custom-ttl-key', fetcher, { ttlMs: 10_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    const resFresh = await fetchWithCache('custom-ttl-key', fetcher, { ttlMs: 10_000 });
    expect(resFresh).toBe('custom1');
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6_000); // 11_000 ms elapsed total
    const resExpired = await fetchWithCache('custom-ttl-key', fetcher, { ttlMs: 10_000 });
    expect(resExpired).toBe('custom2');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fetcher rejections throw without caching the error, allowing subsequent calls to attempt fetch', async () => {
    const errorFetcher = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(fetchWithCache('error-key', errorFetcher)).rejects.toThrow('Network error');
    expect(errorFetcher).toHaveBeenCalledTimes(1);

    // Next call should attempt to fetch again because error was not cached
    const recoveryFetcher = vi.fn().mockResolvedValue('recovered');
    const res = await fetchWithCache('error-key', recoveryFetcher);
    expect(res).toBe('recovered');
    expect(recoveryFetcher).toHaveBeenCalledTimes(1);
  });

  it('clearCache empties the cache completely', async () => {
    const fetcher1 = vi.fn().mockResolvedValue('value1');
    const fetcher2 = vi.fn().mockResolvedValue('value2');

    await fetchWithCache('cleared-key-1', fetcher1);
    await fetchWithCache('cleared-key-2', fetcher2);
    expect(fetcher1).toHaveBeenCalledTimes(1);
    expect(fetcher2).toHaveBeenCalledTimes(1);

    clearCache();

    await fetchWithCache('cleared-key-1', fetcher1);
    await fetchWithCache('cleared-key-2', fetcher2);
    expect(fetcher1).toHaveBeenCalledTimes(2);
    expect(fetcher2).toHaveBeenCalledTimes(2);
  });

  it('automatically invalidates cache when global fetch changes in test environments', async () => {
    const fetcher = vi.fn().mockResolvedValue('val');
    await fetchWithCache('auto-inval-key', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
    try {
      (globalThis as unknown as { fetch?: unknown }).fetch = () => {};
      await fetchWithCache('auto-inval-key', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
    }
  });

  it('manages independent cache entries across multiple keys without cross-contamination', async () => {
    const k1Fetcher = vi.fn().mockResolvedValue({ service: 'alpha' });
    const k2Fetcher = vi.fn().mockResolvedValue({ service: 'beta' });

    const res1 = await fetchWithCache('srv:alpha', k1Fetcher);
    const res2 = await fetchWithCache('srv:beta', k2Fetcher);

    expect(res1).toEqual({ service: 'alpha' });
    expect(res2).toEqual({ service: 'beta' });
    expect(k1Fetcher).toHaveBeenCalledTimes(1);
    expect(k2Fetcher).toHaveBeenCalledTimes(1);

    // Invalidate only alpha
    invalidateCache('srv:alpha');

    await fetchWithCache('srv:beta', k2Fetcher);
    expect(k2Fetcher).toHaveBeenCalledTimes(1);

    await fetchWithCache('srv:alpha', k1Fetcher);
    expect(k1Fetcher).toHaveBeenCalledTimes(2);
  });
});
