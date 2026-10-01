import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import PricingTable from "./PricingTable.svelte";
import type { ModelPricingItem } from "./types";

describe("PricingTable", () => {
  const fixtureModels: ModelPricingItem[] = [
    {
      id: "gemini-3.8-flash",
      owned_by: "google",
      routing_engine: "Google Edge Direct",
      cu_base: 10,
      cu_in_per_1k: 1,
      cu_cached_per_1k: 0,
      cu_out_per_1k: 4,
      bulletClass: "bg-secondary",
      isDeprecated: false,
      sunsetAt: null,
    },
    {
      id: "llama-3.3-70b",
      owned_by: "groq",
      routing_engine: "LPU Ultrafast",
      cu_base: 12,
      cu_in_per_1k: 2,
      cu_cached_per_1k: 1,
      cu_out_per_1k: 5,
      bulletClass: "bg-primary",
      isDeprecated: false,
      sunsetAt: null,
    },
  ];

  it("renders the four CU weight columns and contains no dollar sign ($)", () => {
    const result = render(PricingTable, {
      props: {
        modelsData: fixtureModels,
        pricingFilter: "active",
      },
    });

    // Assert that the table renders the four CU weight columns
    expect(result.body).toContain("Base CU");
    expect(result.body).toContain("Input CU/1k");
    expect(result.body).toContain("Cached CU/1k");
    expect(result.body).toContain("Output CU/1k");

    // Assert model IDs and CU values are rendered
    expect(result.body).toContain("gemini-3.8-flash");
    expect(result.body).toContain("10 CU");
    expect(result.body).toContain("1 CU");
    expect(result.body).toContain("0 CU");
    expect(result.body).toContain("4 CU");

    // Assert that no dollar sign ($) appears in the output
    expect(result.body).not.toContain("$");
  });

  it("shows only models from /v1/models, as CU weights without dollar amounts", () => {
    const { body } = render(PricingTable, { props: { modelsData: fixtureModels } });

    for (const m of fixtureModels.filter((x) => !x.isDeprecated)) {
      expect(body).toContain(m.id);
    }
    expect(body).not.toContain("gemini-3.5-flash-lite");
    expect(body).not.toContain("qwen/qwen3.8-27b");
    expect(body).toContain("(CU) Weights");
    expect(body).not.toContain("$");
  });

  it("renders no model rows before /v1/models answers", () => {
    const { body } = render(PricingTable, { props: { modelsData: null } });

    for (const m of fixtureModels) {
      expect(body).not.toContain(m.id);
    }
  });
});
