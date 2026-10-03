import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

const privateKey = {
  id: 'key_private_1',
  key_prefix: 'AIzaSy',
  key_suffix: 'wxyz',
  provider: 'gemini',
  label: 'my private key',
  rpm_limit: 15,
  rpd_limit: 1500,
  priority: 0,
  status: 'healthy',
  pool_type: 'PRIVATE',
  is_owner: true,
};

function useSession(user: Record<string, unknown>, rights: { privatePool: boolean; communityPool: boolean }) {
  server.use(
    http.get('http://localhost/api/session', () =>
      HttpResponse.json({ success: true, user, csrfToken: 'csrf-from-session', rights })
    ),
    http.get('http://localhost/api/keys', () => HttpResponse.json([privateKey]))
  );
}

function clickButton(text: string): void {
  const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!button) throw new Error(`no button "${text}"`);
  button.click();
}

describe('App identity mapping (WP-F.5, QA-03, QA-09)', () => {
  afterEach(() => {
    server.resetHandlers();
    document.body.innerHTML = '';
  });

  it('a Google-only user never shows the email prefix as a GitHub handle and cannot pick the community pool', async () => {
    useSession(
      {
        id: 'usr_goog_only',
        email: 'jane.doe@example.com',
        tier: 'builder',
        role: 'user',
        providers: ['google'],
        github_id: null,
        github_username: null,
        sybil_score: null,
      },
      { privatePool: true, communityPool: false }
    );

    const app = mount(App, { target: document.body });
    await settle();

    expect(document.body.innerHTML).not.toContain('@jane.doe');
    expect(document.body.textContent).not.toContain('Switch to Community');
    clickButton('Add Provider Key');
    await settle();
    expect(document.body.textContent).toContain('GitHub Authentication Required');
    unmount(app);
  });

  it('a GitHub-linked user with community rights shows the GitHub handle and may pick the community pool', async () => {
    useSession(
      {
        id: 'usr_goog_linked',
        email: 'jane.doe@example.com',
        tier: 'builder',
        role: 'user',
        providers: ['github', 'google'],
        github_id: '136698185',
        github_username: 'Axe-08',
        sybil_score: 100,
      },
      { privatePool: true, communityPool: true }
    );

    const app = mount(App, { target: document.body });
    await settle();

    expect(document.body.innerHTML).toContain('@Axe-08');
    expect(document.body.innerHTML).not.toContain('@jane.doe');
    expect(document.body.textContent).toContain('Switch to Community');
    clickButton('Add Provider Key');
    await settle();
    expect(document.body.textContent).not.toContain('GitHub Authentication Required');
    unmount(app);
  });
});
