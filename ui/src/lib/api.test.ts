import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from './api';
import { ApiError } from './api/client';

function mockFetchOnce(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('api (typed client, no mock fallbacks)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deleteKey rejects with ApiError on a 500 instead of resolving true', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(500, { error: 'boom' }));

    await expect(api.deleteKey('key-1')).rejects.toBeInstanceOf(ApiError);
    await expect(api.deleteKey('key-1')).rejects.toMatchObject({ status: 500 });
  });

  it('getKeys rejects with ApiError on a 500 instead of resolving to []', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(500, { error: 'boom' }));

    await expect(api.getKeys()).rejects.toBeInstanceOf(ApiError);
  });

  it('getLogs rejects with ApiError on a 500 instead of resolving to []', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(500, { error: 'boom' }));

    await expect(api.getLogs()).rejects.toBeInstanceOf(ApiError);
  });

  it('testKey rejects with ApiError on a 500 instead of resolving a fake failure object', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(500, { error: 'boom' }));

    await expect(api.testKey('key-1')).rejects.toBeInstanceOf(ApiError);
  });

  it('getStats returns the server response as-is, with no client-side recomputation', async () => {
    const serverStats = {
      total_keys: 5,
      healthy_keys: 3,
      rate_limited_keys: 1,
      invalid_keys: 1,
      total_rpm_headroom: 100,
      total_rpm_limit: 500,
      current_rpm_used: 400,
      avg_upstream_latency_ms: 120,
      daily_quota_used: 1000,
      daily_quota_limit: 5000,
      proxy_status: 'healthy' as const,
    };
    vi.stubGlobal('fetch', mockFetchOnce(200, serverStats));

    const result = await api.getStats();
    expect(result).toEqual(serverStats);
  });

  it('getStats rejects with ApiError on a 500', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(500, { error: 'boom' }));

    await expect(api.getStats()).rejects.toBeInstanceOf(ApiError);
  });

  it('getKeys resolves with the parsed array on success', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(200, []));

    await expect(api.getKeys()).resolves.toEqual([]);
  });
});
