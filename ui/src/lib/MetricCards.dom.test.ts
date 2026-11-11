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
