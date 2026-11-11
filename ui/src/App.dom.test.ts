import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import App from './App.svelte';
import TelemetryLogs from './lib/TelemetryLogs.svelte';

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

  it('displays session notice cleanly and opens LinkGithubModal on click', async () => {
    server.use(
      http.get('http://localhost/api/session', () =>
        HttpResponse.json({
          success: true,
          user: { id: 'usr_goog_only', email: 'user@example.com', tier: 'builder', role: 'user' },
          csrfToken: 'csrf-from-session',
          rights: { privatePool: true, communityPool: false },
          notices: ['Link GitHub to keep sharing your key with the community pool'],
        })
      ),
      http.get('http://localhost/api/keys', () => HttpResponse.json([]))
    );

    const app = mount(App, { target: document.body });
    await settle();

    const noticeEl = document.querySelector('[data-testid="session-notice"]');
    expect(noticeEl).not.toBeNull();
    expect(noticeEl?.textContent).toContain('Link GitHub to keep sharing your key with the community pool');

    // Link GitHub modal is not open initially
    expect(document.querySelector('[data-testid="link-github-modal"]')).toBeNull();

    // Click "Link GitHub" button on notice
    const noticeBtn = document.querySelector('[data-testid="link-github-notice-btn"]') as HTMLButtonElement | null;
    expect(noticeBtn).not.toBeNull();
    noticeBtn?.click();
    await settle();

    // Link GitHub modal is now open
    const modalEl = document.querySelector('[data-testid="link-github-modal"]');
    expect(modalEl).not.toBeNull();
    expect(modalEl?.textContent).toContain('Link GitHub Account');
    expect(modalEl?.querySelector('[data-testid="link-github"]')).not.toBeNull();

    unmount(app);
  });
});

describe('App background polling (WP-1.1)', () => {
  afterEach(() => {
    server.resetHandlers();
    document.body.innerHTML = '';
  });

  it('mounts App.svelte in JSDOM, advances fake timers by 60s, and verifies fetch is called 0 times while idle', async () => {
    useSession(
      {
        id: 'usr_idle_tester',
        email: 'idle@example.com',
        tier: 'builder',
        role: 'user',
      },
      { privatePool: true, communityPool: false }
    );

    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const app = mount(App, { target: document.body });

    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10);
      await tick();
    }

    fetchSpy.mockClear();

    try {
      vi.advanceTimersByTime(60_000);
      await tick();
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      vi.useRealTimers();
      fetchSpy.mockRestore();
      unmount(app);
    }
  });
});

describe('Telemetry and cache refresh controls (WP-1.3, WP-4.1)', () => {
  afterEach(() => {
    server.resetHandlers();
    document.body.innerHTML = '';
  });

  it('clicking data-testid="refresh-logs-btn" dispatches fetch to /api/logs and updates telemetry', async () => {
    let logsFetched = false;
    let telemetryUpdated = false;
    server.use(
      http.get('http://localhost/api/logs', () => {
        logsFetched = true;
        return HttpResponse.json([]);
      })
    );

    const comp = mount(TelemetryLogs, {
      target: document.body,
      props: {
        logs: [],
        autoRefresh: false,
        onRefresh: async () => {
          await fetch('http://localhost/api/logs');
          telemetryUpdated = true;
        },
      },
    });
    await settle();

    const refreshBtn = document.querySelector('[data-testid="refresh-logs-btn"]') as HTMLButtonElement | null;
    expect(refreshBtn).not.toBeNull();
    refreshBtn?.click();
    await settle();

    expect(logsFetched).toBe(true);
    expect(telemetryUpdated).toBe(true);
    unmount(comp);
  });

  it('clicking data-testid="refresh-logs-btn" without onRefresh dispatches api.getLogs with force: true', async () => {
    let apiLogsFetched = false;
    server.use(
      http.get('http://localhost/api/logs', () => {
        apiLogsFetched = true;
        return HttpResponse.json([]);
      })
    );

    const comp = mount(TelemetryLogs, {
      target: document.body,
      props: {
        logs: [],
        autoRefresh: false,
      },
    });
    await settle();

    const refreshBtn = document.querySelector('[data-testid="refresh-logs-btn"]') as HTMLButtonElement | null;
    expect(refreshBtn).not.toBeNull();
    refreshBtn?.click();
    await settle();

    expect(apiLogsFetched).toBe(true);
    unmount(comp);
  });

  it('dispatching window.dispatchEvent(new Event("focus")) when cache is older than 5 minutes triggers loadData', async () => {
    let loadCount = 0;
    server.use(
      http.get('http://localhost/api/session', () =>
        HttpResponse.json({
          success: true,
          user: { id: 'usr_focus_test', email: 'focus@example.com', tier: 'builder', role: 'user' },
          csrfToken: 'csrf-from-session',
          rights: { privatePool: true, communityPool: false },
        })
      ),
      http.get('http://localhost/api/keys', () => {
        loadCount++;
        return HttpResponse.json([privateKey]);
      }),
      http.get('http://localhost/api/logs', () => HttpResponse.json([])),
      http.get('http://localhost/api/stats', () =>
        HttpResponse.json({
          total_keys: 1,
          healthy_keys: 1,
          rate_limited_keys: 0,
          invalid_keys: 0,
          total_rpm_headroom: 100,
          total_rpm_limit: 100,
          current_rpm_used: 0,
          avg_upstream_latency_ms: 10,
          daily_quota_used: 0,
          daily_quota_limit: 1000,
          proxy_status: 'healthy',
          cu_used_today: 0,
          cu_allowance_today: 10000,
        })
      ),
      http.get('http://localhost/api/pool/contribution', () =>
        HttpResponse.json({
          personal_requests_today: 0,
          requests_served_for_community_today: 0,
          cu_contributed_24h: 0,
          cu_borrowed_24h: 0,
        })
      ),
      http.get('http://localhost/api/projects', () => HttpResponse.json([])),
      http.get('http://localhost/api/projects/*/keys', () => HttpResponse.json([])),
      http.get('http://localhost/api/tokens', () => HttpResponse.json([]))
    );

    vi.useFakeTimers();
    const app = mount(App, { target: document.body });

    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10);
      await tick();
    }

    const initialLoads = loadCount;
    expect(initialLoads).toBeGreaterThan(0);

    try {
      // Advance by > 5 minutes (300_001 ms)
      await vi.advanceTimersByTimeAsync(300_001);
      window.dispatchEvent(new Event('focus'));

      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(10);
        await tick();
      }

      expect(loadCount).toBeGreaterThan(initialLoads);
    } finally {
      vi.useRealTimers();
      unmount(app);
    }
  });

  it('dispatching window.dispatchEvent(new Event("focus")) when cache is fresh (< 5 minutes) triggers 0 network calls', async () => {
    let loadCount = 0;
    server.use(
      http.get('http://localhost/api/session', () =>
        HttpResponse.json({
          success: true,
          user: { id: 'usr_focus_test2', email: 'focus2@example.com', tier: 'builder', role: 'user' },
          csrfToken: 'csrf-from-session',
          rights: { privatePool: true, communityPool: false },
        })
      ),
      http.get('http://localhost/api/keys', () => {
        loadCount++;
        return HttpResponse.json([privateKey]);
      }),
      http.get('http://localhost/api/logs', () => HttpResponse.json([])),
      http.get('http://localhost/api/stats', () =>
        HttpResponse.json({
          total_keys: 1,
          healthy_keys: 1,
          rate_limited_keys: 0,
          invalid_keys: 0,
          total_rpm_headroom: 100,
          total_rpm_limit: 100,
          current_rpm_used: 0,
          avg_upstream_latency_ms: 10,
          daily_quota_used: 0,
          daily_quota_limit: 1000,
          proxy_status: 'healthy',
          cu_used_today: 0,
          cu_allowance_today: 10000,
        })
      ),
      http.get('http://localhost/api/pool/contribution', () =>
        HttpResponse.json({
          personal_requests_today: 0,
          requests_served_for_community_today: 0,
          cu_contributed_24h: 0,
          cu_borrowed_24h: 0,
        })
      ),
      http.get('http://localhost/api/projects', () => HttpResponse.json([])),
      http.get('http://localhost/api/projects/*/keys', () => HttpResponse.json([])),
      http.get('http://localhost/api/tokens', () => HttpResponse.json([]))
    );

    vi.useFakeTimers();
    const app = mount(App, { target: document.body });

    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10);
      await tick();
    }

    const baselineCount = loadCount;

    try {
      // Advance by only 1 minute (< 5 minutes)
      await vi.advanceTimersByTimeAsync(60_000);
      window.dispatchEvent(new Event('focus'));

      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(10);
        await tick();
      }

      expect(loadCount).toBe(baselineCount);
    } finally {
      vi.useRealTimers();
      unmount(app);
    }
  });
});



