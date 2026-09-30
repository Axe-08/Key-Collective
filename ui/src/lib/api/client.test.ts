import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { request, ApiError } from './client';

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
});
