import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "svelte/server";
import MetricCards from "./MetricCards.svelte";
import type { PoolStats } from "./types";

describe("MetricCards", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as any);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders CU used and CU allowance from a fixture /api/stats response and contains no dollar sign ($)", () => {
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
      proxy_status: "healthy",
      cu_used_today: 1250,
      cu_allowance_today: 50000,
    };

    const result = render(MetricCards, {
      props: {
        stats: fixtureStats,
      },
    });

    // Assert that CU used and CU allowance are rendered
    expect(result.body).toContain("1,250");
    expect(result.body).toContain("50,000");
    expect(result.body).toContain("CU used today");
    expect(result.body).toContain("CU allowance today");

    // Assert that the rendered markup contains no dollar sign ($)
    expect(result.body).not.toContain("$");
  });
});
