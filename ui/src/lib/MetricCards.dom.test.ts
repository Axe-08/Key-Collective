import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import MetricCards from './MetricCards.svelte';
import type { PoolStats } from './types';

describe('MetricCards DOM (WP-1.1)', () => {
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

describe('MetricCards DOM (WP-1.3)', () => {
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
});
