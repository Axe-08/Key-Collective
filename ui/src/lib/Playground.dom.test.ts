import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import Playground from './Playground.svelte';

const seen: Array<{ auth: string | null; headers: string[] }> = [];
let tokenCalls = 0;

const server = setupServer(
  http.post('http://localhost/api/playground/token', () => {
    tokenCalls += 1;
    return HttpResponse.json({ token: 'kc_live_playground', expires_at: new Date(Date.now() + 900_000).toISOString() }, { status: 201 });
  }),
  http.get('http://localhost/v1/models', () => HttpResponse.json({ data: [{ id: 'gemini-2.5-flash', owned_by: 'google' }] })),
  http.post('http://localhost/v1/chat/completions', ({ request }) => {
    seen.push({ auth: request.headers.get('authorization'), headers: [...request.headers.keys()].map((h) => h.toLowerCase()).sort() });
    const body = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\nevent: kc.usage\ndata: {"cu": 25}\n\n';
    return new HttpResponse(body, { headers: { 'content-type': 'text/event-stream', 'x-kc-cu': '14' } });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  document.body.innerHTML = '';
});
afterAll(() => server.close());

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await tick();
  }
}

describe('Playground (WP-3.10)', () => {
  it('uses the session playground token, sends no tenant header, and shows the CU from the kc.usage event', async () => {
    const pg = mount(Playground, { target: document.body, props: { proxyEndpoint: 'http://localhost/v1/chat/completions' } });
    await settle();

    expect(tokenCalls).toBe(1);
    (document.querySelector('[data-testid="playground-send"]') as HTMLButtonElement).click();
    await settle();

    expect(seen).toHaveLength(1);
    expect(seen[0].auth).toBe('Bearer kc_live_playground');
    // Only these headers leave the playground: identity comes from the key, never a tenant header.
    expect(seen[0].headers.filter((h) => !['authorization', 'content-type', 'x-pool-fallback'].includes(h))).toEqual([]);
    // The header gives 14 CU; the stream's closing kc.usage event (25) is the final figure.
    expect(document.body.textContent).toContain('25 CU');
    expect(document.body.textContent).not.toContain('kc.usage');
    unmount(pg);
  });
});
