import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import App from './App.svelte';

// QA-01: the standing and contribution cards must not fetch before sign-in, and must load
// once the session resolves to a user, without a reload or Retry.
const poolRequests: string[] = [];
let releaseSession: (() => void) | null = null;
const sessionReady = new Promise<void>((resolve) => {
  releaseSession = resolve;
});

const standing = {
  multiplier: 3.25,
  multiplier_pct: 325,
  multiplier_ceiling: 4.5,
  community_debt_cu: 0,
  contributed_cu_24h: 0,
  net_cu_balance: 0,
  trusted_contributor: false,
  jail_status: 'PRISTINE',
  consecutive_debt_free_days: 0,
  caps: { vesting: 450, debt: 450, band: 450 },
  recovery: { debt_decay: '20% per day at 00:00 UTC', estimated_days: 0 },
};

const server = setupServer(
  http.get('http://localhost/api/session', async () => {
    await sessionReady;
    return HttpResponse.json({
      success: true,
      user: { id: 'usr_goog_late', email: 'late@example.com', tier: 'builder', role: 'user', providers: ['google'] },
      csrfToken: 'csrf',
      rights: { privatePool: true, communityPool: false },
    });
  }),
  http.get('http://localhost/api/pool/standing', () => {
    poolRequests.push('standing');
    return HttpResponse.json(standing);
  }),
  http.get('http://localhost/api/pool/contribution', () => {
    poolRequests.push('contribution');
    return HttpResponse.json({
      personal_requests_today: 0,
      requests_served_for_community_today: 0,
      cu_contributed_24h: 0,
      cu_borrowed_24h: 0,
    });
  }),
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

describe('Dashboard standing after sign-in (WP-F.5, QA-01)', () => {
  it('fetches standing and contribution only once the session has a user', async () => {
    const app = mount(App, { target: document.body });
    await settle();

    expect(poolRequests).toEqual([]);
    expect(document.body.textContent).not.toContain('Failed to fetch standing');

    releaseSession!();
    await settle();

    expect(poolRequests.filter((r) => r === 'standing')).toHaveLength(1);
    expect(poolRequests.filter((r) => r === 'contribution')).toHaveLength(1);
    expect(document.body.textContent).toContain('3.25x');
    unmount(app);
  });
});
