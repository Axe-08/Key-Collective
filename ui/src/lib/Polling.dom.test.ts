import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import App from '../App.svelte';
import Workbench from './Workbench.svelte';

// T-F.7.5 (QA-06): each resource has one poller.
const hits = new Map<string, number>();
const count = (path: string) => hits.set(path, (hits.get(path) ?? 0) + 1);

const server = setupServer(
  http.get('http://localhost/api/session', () =>
    HttpResponse.json({
      success: true,
      user: { id: 'usr_poll', email: 'poll@example.test', tier: 'builder', role: 'user' },
      csrfToken: 'csrf',
      rights: { privatePool: true, communityPool: false },
    })
  ),
  http.get('http://localhost/api/notifications', () => {
    count('/api/notifications');
    return HttpResponse.json({
      notifications: [
        { id: 'n1', tenant_id: 'usr_poll', type: 'key_invalid', key_id: null, message: 'Key k1 was rejected', created_at: 1, read_at: null },
      ],
    });
  }),
  http.get('http://localhost/api/keys', () => {
    count('/api/keys');
    return HttpResponse.json([]);
  }),
  http.all('http://localhost/*', () => HttpResponse.json({}))
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  hits.clear();
  document.body.innerHTML = '';
});
afterAll(() => server.close());

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await tick();
  }
}

describe('T-F.7.5 no duplicate polling (QA-06)', () => {
  it('the Workbench uses the provider keys it is given, even an empty list, and does not fetch /api/keys', async () => {
    const wb = mount(Workbench, { target: document.body, props: { providerKeys: [] } });
    await settle();
    expect(hits.get('/api/keys') ?? 0).toBe(0);
    unmount(wb);
  });

  it('the app asks for notifications once per cycle, and both the bell and the toast show the result', async () => {
    const app = mount(App, { target: document.body });
    await settle();

    expect(hits.get('/api/notifications')).toBe(1);
    expect(document.querySelector('[data-testid="notification-toasts"]')?.textContent).toContain('Key k1 was rejected');
    unmount(app);
  });
});
