import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import App from './App.svelte';

const server = setupServer(
  http.get('http://localhost/api/session', () =>
    HttpResponse.json({
      success: true,
      user: { id: 'usr_goog_session_user', email: 'session.user@example.com', tier: 'builder', role: 'user' },
      csrfToken: 'csrf-from-session',
      rights: { privatePool: true, communityPool: false },
    })
  ),
  http.all('http://localhost/*', () => HttpResponse.json({}))
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await tick();
  }
}

describe('App identity (WP-3.4)', () => {
  it('purges kc_user / kc_auth_token on load and takes identity from GET /api/session', async () => {
    window.localStorage.setItem('kc_user', JSON.stringify({ id: 'usr_gh_spoofed', tier: 'admin' }));
    window.localStorage.setItem('kc_auth_token', 'kc_builder_stale_token');

    const app = mount(App, { target: document.body });
    await settle();

    expect(window.localStorage.getItem('kc_user')).toBeNull();
    expect(window.localStorage.getItem('kc_auth_token')).toBeNull();
    expect(document.body.textContent).not.toContain('usr_gh_spoofed');
    expect(document.body.innerHTML).toContain('session.user');
    unmount(app);
  });
});
