import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { request, ApiError, setCsrfToken } from './client';

const StatsSchema = z.object({
  total_keys: z.number(),
  healthy_keys: z.number(),
});

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('request()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrfToken(null);
  });

  it('throws ApiError with status/message from the body on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(403, { code: 'forbidden', error: 'You are not allowed to do that' })
    );

    await expect(request(StatsSchema, '/api/stats')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
      message: 'You are not allowed to do that',
    });
    await expect(request(StatsSchema, '/api/stats')).rejects.toBeInstanceOf(ApiError);
  });

  it('falls back to a generic message when the error body has no error/message field', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(500, {}));

    await expect(request(StatsSchema, '/api/stats')).rejects.toMatchObject({
      status: 500,
      code: 'unknown_error',
      message: 'Request failed (HTTP 500)',
    });
  });

  it('throws ApiError (invalid_response) instead of returning a malformed 2xx payload', async () => {
    // total_keys is a string instead of a number: violates StatsSchema.
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(200, { total_keys: 'oops', healthy_keys: 3 })
    );

    let caught: unknown;
    try {
      await request(StatsSchema, '/api/stats');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('invalid_response');
  });

  it('returns the parsed data on a valid 2xx response', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(200, { total_keys: 10, healthy_keys: 8 }));

    const result = await request(StatsSchema, '/api/stats');
    expect(result).toEqual({ total_keys: 10, healthy_keys: 8 });
  });

  it('merges a custom auth transport headers into the request', async () => {
    const fetchMock = mockFetchOnce(200, { total_keys: 1, healthy_keys: 1 });
    vi.stubGlobal('fetch', fetchMock);

    await request(StatsSchema, '/api/stats', undefined, {
      getHeaders: () => ({ 'X-Test': 'yes' }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stats',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Test': 'yes' }),
      })
    );
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s carries x-kc-csrf and the session cookie, never an Authorization header',
    async (method) => {
      const fetchMock = mockFetchOnce(200, { total_keys: 1, healthy_keys: 1 });
      vi.stubGlobal('fetch', fetchMock);
      setCsrfToken('csrf-123');

      await request(StatsSchema, '/api/stats', { method });

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(init.credentials).toBe('same-origin');
      expect(headers['x-kc-csrf']).toBe('csrf-123');
      expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    }
  );

  it('GET sends the session cookie without a CSRF header', async () => {
    const fetchMock = mockFetchOnce(200, { total_keys: 1, healthy_keys: 1 });
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('csrf-123');

    await request(StatsSchema, '/api/stats');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['x-kc-csrf']).toBeUndefined();
  });
});
