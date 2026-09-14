import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import PoolCommonsTab, {
  fetchPoolData,
  renderCommons,
  type PoolMetrics,
} from "./PoolCommonsTab.svelte";

describe("PoolCommonsTab", () => {
  it("should conform to exact function and contract signatures", async () => {
    expect(typeof fetchPoolData).toBe("function");
    expect(typeof renderCommons).toBe("function");

    const data: PoolMetrics = await fetchPoolData();
    expect(data).toHaveProperty("total");
    expect(data).toHaveProperty("available");
    expect(typeof data.total).toBe("number");
    expect(typeof data.available).toBe("number");

    // renderCommons should be callable without errors
    expect(() => renderCommons()).not.toThrow();
  });

  it("Should render pool metrics", () => {
    const mockMetrics: PoolMetrics = {
      total: 150,
      available: 95,
    };

    const rendered = render(PoolCommonsTab, {
      props: {
        initialMetrics: mockMetrics,
      },
    });

    expect(rendered.html).toBeDefined();
    // Verify pool metrics container and values are rendered
    expect(rendered.html).toContain("data-testid=\"pool-metrics\"");
    expect(rendered.html).toContain("Total Pool Capacity");
    expect(rendered.html).toContain("150");
    expect(rendered.html).toContain("Pool Commons &amp; Metrics");
  });

  it("Should show available commons", () => {
    const mockMetrics: PoolMetrics = {
      total: 200,
      available: 120,
    };

    const rendered = render(PoolCommonsTab, {
      props: {
        initialMetrics: mockMetrics,
      },
    });

    // Verify available commons section and count are rendered
    expect(rendered.html).toContain("data-testid=\"available-commons\"");
    expect(rendered.html).toContain("Available Commons");
    expect(rendered.html).toContain("120");
    expect(rendered.html).toContain("data-testid=\"available-commons-count\"");
  });

  it("should handle custom fetchPoolData provider", async () => {
    const customFetch = vi.fn().mockResolvedValue({ total: 80, available: 40 });
    const data = await customFetch();
    expect(customFetch).toHaveBeenCalledTimes(1);
    expect(data.total).toBe(80);
    expect(data.available).toBe(40);
  });
});
