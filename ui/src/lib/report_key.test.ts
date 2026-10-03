import { describe, expect, it } from 'vitest';
import * as reportKey from './report_key';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function respond(status: number, body: unknown): { fetchImpl: FetchLike; calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  const fetchImpl: FetchLike = async (_input, init) => {
    calls.push(init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}

describe('submitKeyReport (T-F.9.4)', () => {
  it('returns ok on 200 and sends the Turnstile token', async () => {
    const { fetchImpl, calls } = respond(200, { message: 'Report received.' });
    const result = await reportKey.submitKeyReport('AIza-leaked', 'ts-token', fetchImpl);
    expect(result).toEqual({ ok: true });
    expect(JSON.parse(String(calls[0].body))).toEqual({ leaked_key: 'AIza-leaked', turnstile_token: 'ts-token' });
  });

  it('surfaces the server error code and message from a structured error', async () => {
    const { fetchImpl } = respond(403, {
      error: { message: 'Turnstile validation failed', type: 'permission_error', code: 'turnstile_failed' },
    });
    const result = await reportKey.submitKeyReport('k', 't', fetchImpl);
    expect(result).toEqual({ ok: false, code: 'turnstile_failed', message: 'Turnstile validation failed' });
    expect(reportKey.describeReportError(result)).toContain('turnstile_failed');
  });

  it('surfaces a bare string error code such as csrf_required instead of blaming Turnstile', async () => {
    const { fetchImpl } = respond(403, { error: 'csrf_required' });
    const result = await reportKey.submitKeyReport('k', 't', fetchImpl);
    expect(result).toMatchObject({ ok: false, code: 'csrf_required' });
    const text = reportKey.describeReportError(result);
    expect(text).toContain('csrf_required');
    expect(text).not.toMatch(/turnstile/i);
  });

  it('falls back to the HTTP status when the body is not JSON', async () => {
    const fetchImpl: FetchLike = async () => new Response('Bad gateway', { status: 502 });
    const result = await reportKey.submitKeyReport('k', 't', fetchImpl);
    expect(result).toMatchObject({ ok: false, code: 'http_502' });
  });
});
