/**
 * Key Collective — ROUTING_ENGINE Switch Tests (T-4.1.1, D-23)
 *
 * Verifies:
 * 1. The Workers test harness sets env.ROUTING_ENGINE ("leases" by default, or "legacy" when overridden via CLI env).
 * 2. routingEngine(env) selects "leases" when ROUTING_ENGINE="leases".
 * 3. routingEngine(env) selects "legacy" when ROUTING_ENGINE="legacy".
 * 4. routingEngine(env) defaults to "legacy" when unset, empty, or unrecognised.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { routingEngine } from "../../../src/router/leases/engine";

describe("ROUTING_ENGINE switch (D-23)", () => {
  it("resolves the configured engine from the Workers test environment binding", () => {
    const raw = (env as unknown as { ROUTING_ENGINE?: string }).ROUTING_ENGINE;
    expect(raw === "leases" || raw === "legacy").toBe(true);
    expect(routingEngine(env as unknown as { ROUTING_ENGINE?: unknown })).toBe(raw);
  });

  it("returns 'leases' when ROUTING_ENGINE is 'leases' (case-insensitive)", () => {
    expect(routingEngine({ ROUTING_ENGINE: "leases" })).toBe("leases");
    expect(routingEngine({ ROUTING_ENGINE: "LEASES" })).toBe("leases");
  });

  it("returns 'legacy' when ROUTING_ENGINE is explicitly 'legacy'", () => {
    expect(routingEngine({ ROUTING_ENGINE: "legacy" })).toBe("legacy");
  });

  it("defaults to 'legacy' when ROUTING_ENGINE is unset or unrecognised", () => {
    expect(routingEngine(undefined)).toBe("legacy");
    expect(routingEngine(null)).toBe("legacy");
    expect(routingEngine({})).toBe("legacy");
    expect(routingEngine({ ROUTING_ENGINE: "" })).toBe("legacy");
    expect(routingEngine({ ROUTING_ENGINE: "unknown" })).toBe("legacy");
  });
});
