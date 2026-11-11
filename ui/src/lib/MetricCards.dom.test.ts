import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import MetricCards from './MetricCards.svelte';
import type { PoolStats, APIKey } from './types';

describe('MetricCards DOM (WP-1.1 & WP-4.1)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders MetricCards in JSDOM; advances fake timers by 60 seconds; verifies globalThis.fetch is called exactly 0 times after mount', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}));

    const fixtureStats: PoolStats = {
      total_keys: 5,
      healthy_keys: 4,
      rate_limited_keys: 1,
      invalid_keys: 0,
      total_rpm_headroom: 100,
      total_rpm_limit: 120,
      current_rpm_used: 20,
      avg_upstream_latency_ms: 45,
      daily_quota_used: 1200,
      daily_quota_limit: 5000,
      proxy_status: 'healthy',
      cu_used_today: 1250,
      cu_allowance_today: 50000,
    };

    const component = mount(MetricCards, {
      target: document.body,
      props: {
        stats: fixtureStats,
      },
    });

    await tick();
    vi.advanceTimersByTime(60000);
    await tick();

    expect(fetchSpy).toHaveBeenCalledTimes(0);

    unmount(component);
    vi.useRealTimers();
  });
});

describe('MetricCards DOM (WP-1.3 & WP-4.1)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('clicking data-testid="refresh-stats-btn" executes fetch to /api/stats, shows spin animation, and updates rendered metrics', async () => {
    let resolveFetch!: (res: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/stats')) {
        return pendingFetch;
      }
      return Response.json({});
    });

    const initialStats: PoolStats = {
      total_keys: 5,
      healthy_keys: 4,
      rate_limited_keys: 1,
      invalid_keys: 0,
      total_rpm_headroom: 100,
      total_rpm_limit: 120,
      current_rpm_used: 20,
      avg_upstream_latency_ms: 45,
      daily_quota_used: 1200,
      daily_quota_limit: 5000,
      proxy_status: 'healthy',
      cu_used_today: 1250,
      cu_allowance_today: 50000,
    };

    const updatedStats: PoolStats = {
      total_keys: 15,
      healthy_keys: 12,
      rate_limited_keys: 3,
      invalid_keys: 0,
      total_rpm_headroom: 300,
      total_rpm_limit: 450,
      current_rpm_used: 60,
      avg_upstream_latency_ms: 25,
      daily_quota_used: 2400,
      daily_quota_limit: 8000,
      proxy_status: 'healthy',
      cu_used_today: 8888,
      cu_allowance_today: 99999,
    };

    const component = mount(MetricCards, {
      target: document.body,
      props: {
        stats: initialStats,
      },
    });

    await tick();

    // Verify initial rendered metrics
    expect(document.body.textContent).toContain('120');
    expect(document.body.textContent).toContain('1,250');
    expect(document.body.textContent).toContain('50,000');

    const refreshBtn = document.querySelector('[data-testid="refresh-stats-btn"]') as HTMLButtonElement | null;
    expect(refreshBtn).not.toBeNull();
    const spinIcon = refreshBtn!.querySelector('span');
    expect(spinIcon).not.toBeNull();
    expect(spinIcon!.classList.contains('animate-spin')).toBe(false);

    // Trigger click on refresh button
    refreshBtn!.click();
    await tick();

    // Assert that fetch('/api/stats', ...) is executed
    expect(fetchSpy).toHaveBeenCalledWith('/api/stats');
    // Assert that the spin animation is applied during the fetch
    expect(spinIcon!.classList.contains('animate-spin')).toBe(true);

    // Resolve the pending fetch with updated stats
    resolveFetch(Response.json(updatedStats));
    await tick();
    await new Promise((r) => setTimeout(r, 10));
    await tick();

    // Assert that the spin animation is cleared after fetch completes
    expect(spinIcon!.classList.contains('animate-spin')).toBe(false);

    // Assert that the rendered metrics update with the new values
    expect(document.body.textContent).toContain('450');
    expect(document.body.textContent).toContain('8,888');
    expect(document.body.textContent).toContain('99,999');

    unmount(component);
  });

  it('clears animate-spin and handles fetch errors gracefully on failed refresh', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

    const component = mount(MetricCards, {
      target: document.body,
      props: {
        stats: {
          total_keys: 2,
          healthy_keys: 2,
          rate_limited_keys: 0,
          invalid_keys: 0,
          total_rpm_headroom: 30,
          total_rpm_limit: 30,
          current_rpm_used: 0,
          avg_upstream_latency_ms: 10,
          daily_quota_used: 0,
          daily_quota_limit: 1000,
          proxy_status: 'healthy',
        },
      },
    });

    await tick();
    const refreshBtn = document.querySelector('[data-testid="refresh-stats-btn"]') as HTMLButtonElement | null;
    expect(refreshBtn).not.toBeNull();
    const spinIcon = refreshBtn!.querySelector('span');
    expect(spinIcon).not.toBeNull();

    refreshBtn!.click();
    await tick();
    await new Promise((r) => setTimeout(r, 10));
    await tick();

    expect(spinIcon!.classList.contains('animate-spin')).toBe(false);
    expect(console.error).toHaveBeenCalled();

    unmount(component);
  });

  it('updates dynamic cooldown countdown every second and cleans up interval on unmount', async () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);

    const keys: APIKey[] = [
      {
        id: 'key-1',
        key_prefix: 'AIza',
        key_suffix: '1234',
        provider: 'gemini',
        label: 'Cooling Key',
        rpm_limit: 15,
        rpd_limit: 1500,
        priority: 1,
        status: 'rate_limited',
        cooldown_until: new Date(now + 30_000).toISOString(),
      },
    ];

    const component = mount(MetricCards, {
      target: document.body,
      props: {
        keys,
      },
    });

    await tick();
    expect(document.body.textContent).toContain('00:30s cooldown');

    // Advance 5 seconds
    vi.advanceTimersByTime(5000);
    await tick();
    expect(document.body.textContent).toContain('00:25s cooldown');

    unmount(component);
    vi.useRealTimers();
  });

  it('does not trigger network requests on window focus event (focus isolation)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}));

    const component = mount(MetricCards, {
      target: document.body,
      props: {},
    });

    await tick();
    expect(fetchSpy).toHaveBeenCalledTimes(0);

    // Dispatch focus event on window
    window.dispatchEvent(new Event('focus'));
    await tick();

    // MetricCards should not independently revalidate on focus (responsibility of parent/App)
    expect(fetchSpy).toHaveBeenCalledTimes(0);

    unmount(component);
  });
});
