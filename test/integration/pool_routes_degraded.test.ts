/**
 * WP-F.10 T-F.10.7 (AU-02): pool routes report a failing TenantQuotaDO or
 * coordinator instead of swallowing the error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { handlePoolRoute } from "../../src/worker/pool_routes";
import { createUser } from "../helpers/world";

type PoolEnv = Parameters<typeof handlePoolRoute>[3];

const failingNs = {
  idFromName: (name: string) => name,
  get: () => ({
    standing: async (): Promise<never> => {
      throw new Error("quota DO unreachable");
    },
    ownerStats: async (): Promise<never> => {
      throw new Error("coordinator unreachable");
    },
  }),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pool routes degraded state (AU-02)", () => {
  it("GET /api/pool/standing answers 503 standing_unavailable and logs when TenantQuotaDO throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tenantId = `usr_pool_degraded_${crypto.randomUUID()}`;
    const res = await handlePoolRoute(
      "/api/pool/standing",
      "GET",
      new Request("https://console.test/api/pool/standing"),
      { DB: env.DB, TENANT_QUOTA: failingNs } as unknown as PoolEnv,
      tenantId,
      { waitUntil: () => undefined }
    );
    expect(res?.status).toBe(503);
    expect(await res?.json()).toEqual({ error: "standing_unavailable" });
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("standing_fetch_failed"))).toBe(true);
  });

  it("GET /api/pool/contribution falls back to D1 and lists the degraded sources", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tenantId = (await createUser({ github: true, eligible: true })).id;
    await env.DB.prepare(
      "INSERT INTO contributor_standing (tenant_id, community_debt_cu, daily_contributed_cu) VALUES (?, 7, 3)"
    )
      .bind(tenantId)
      .run();
    const res = await handlePoolRoute(
      "/api/pool/contribution",
      "GET",
      new Request("https://console.test/api/pool/contribution"),
      { DB: env.DB, TENANT_QUOTA: failingNs, POOL_COORDINATOR: failingNs } as unknown as PoolEnv,
      tenantId,
      { waitUntil: () => undefined }
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as { community_debt_cu: number; cu_contributed_24h: number; degraded?: string[] };
    expect(body.community_debt_cu).toBe(7);
    expect(body.cu_contributed_24h).toBe(3);
    expect(body.degraded).toEqual(["coordinator:google", "coordinator:groq", "standing"]);
  });
});
