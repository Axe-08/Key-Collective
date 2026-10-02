import { describe, expect, it } from "vitest";
import { applyKcHeaders } from "../../../src/worker/router/headers";

describe("WP-6.5 / T-6.5.4: Delete x-kc-cost-microdollars header and financial.ts", () => {
  it("never includes x-kc-cost-microdollars on responses even if present on input", () => {
    const raw = new Response("{}", {
      headers: {
        "content-type": "application/json",
        "x-kc-cost-microdollars": "5000",
      },
    });

    const res = applyKcHeaders(raw, {
      requestId: "kc_req_test",
      cu: 10n,
      // @ts-expect-error costMicrodollars should no longer be a valid header ctx property
      costMicrodollars: 5000n,
    });

    expect(res.headers.get("x-kc-cu")).toBe("10");
    expect(res.headers.get("x-kc-cost-microdollars")).toBeNull();
  });
});
