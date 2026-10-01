import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ApiError, setCsrfToken } from './client';

function respond(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('typed client: projects and API keys (WP-3.9)', () => {
  it('rotateToken POSTs /api/tokens/:id/rotate with the CSRF header and returns the new secret', async () => {
    setCsrfToken('csrf-1');
    const fetchFn = respond(200, { id: 'tok_1', token: 'kc_proj_live_new', project_id: 'prj_1' });

    const issued = await api.rotateToken('tok_1');

    expect(issued.token).toBe('kc_proj_live_new');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/tokens/tok_1/rotate');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-kc-csrf']).toBe('csrf-1');
  });

  it('updateProject surfaces a 400 as ApiError with the server message (pessimistic edits)', async () => {
    respond(400, { error: { message: 'RPM sub-cap exceeds your tier maximum of 20', code: 'SUB_CAP_ABOVE_TIER' } });

    const err = await api.updateProject('prj_1', { rpm_sub_cap: 999 }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('SUB_CAP_ABOVE_TIER');
    expect(err.message).toBe('RPM sub-cap exceeds your tier maximum of 20');
  });

  it('getProjects returns rpm_sub_cap and is_archived', async () => {
    respond(200, [{ id: 'prj_1', name: 'p', rpm_sub_cap: 5, is_archived: 1 }]);

    expect(await api.getProjects()).toEqual([expect.objectContaining({ rpm_sub_cap: 5, is_archived: 1 })]);
  });

  it('setKeyPoolMode PATCHes pool-mode with the CSRF header', async () => {
    setCsrfToken('csrf-2');
    const fetchFn = respond(200, { pool_type: 'PRIVATE', community_routing_status: null, observation_until: null });

    await api.setKeyPoolMode('key_1', 'PRIVATE');

    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['x-kc-csrf']).toBe('csrf-2');
  });
});
