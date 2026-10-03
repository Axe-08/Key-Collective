/**
 * WP-F.10 T-F.10.5 (AU-02): TenantQuotaDO keeps its dirty flag when a D1 write
 * fails, logs the failure, and the next alarm writes the row.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { TenantQuotaDO } from "../../src/quota/tenant/tenant_do";
import { advance } from "../helpers/clock";

function tenantStub(tenantId: string): DurableObjectStub {
  const ns = (env as unknown as { TENANT_QUOTA: DurableObjectNamespace }).TENANT_QUOTA;
  return ns.get(ns.idFromName(tenantId));
}

function logged(spy: ReturnType<typeof vi.spyOn>, event: string): boolean {
  return spy.mock.calls.some((c: unknown[]) => String(c[0]).includes(event));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TenantQuotaDO failed D1 writes are retried (AU-02)", () => {
  it("keeps standing dirty when the contributor_standing mirror fails and writes it on the next alarm", async () => {
    const tenantId = `usr_mirror_retry_${crypto.randomUUID()}`;
    const stub = tenantStub(tenantId);
    const t0 = Date.UTC(2031, 5, 3, 9, 0, 0);

    await runInDurableObject(stub, async (quota: TenantQuotaDO) => {
      quota.setClockForTest(t0);
      await quota.accrueDebt(40n, "lease_mirror_1", tenantId);
      expect(quota.isStandingDirty()).toBe(true);
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await env.DB.prepare("ALTER TABLE contributor_standing RENAME TO cs_x").run();
    try {
      await advance(stub, t0 + 60_000);
    } finally {
      await env.DB.prepare("ALTER TABLE cs_x RENAME TO contributor_standing").run();
    }
    expect(logged(errorSpy, "standing_mirror_failed")).toBe(true);
    await runInDurableObject(stub, async (quota: TenantQuotaDO) => {
      expect(quota.isStandingDirty()).toBe(true);
    });

    await advance(stub, t0 + 120_000);
    const row = await env.DB.prepare("SELECT community_debt_cu FROM contributor_standing WHERE tenant_id = ?")
      .bind(tenantId)
      .first<{ community_debt_cu: number }>();
    expect(row?.community_debt_cu).toBe(40);
    await runInDurableObject(stub, async (quota: TenantQuotaDO) => {
      expect(quota.isStandingDirty()).toBe(false);
    });
  });

  it("keeps a failed standing_history row pending and inserts it on the next alarm", async () => {
    const tenantId = `usr_hist_retry_${crypto.randomUUID()}`;
    const stub = tenantStub(tenantId);
    const t0 = Date.UTC(2031, 5, 3, 22, 0, 0);

    await runInDurableObject(stub, async (quota: TenantQuotaDO) => {
      quota.setClockForTest(t0);
      await quota.accrueDebt(10n, "lease_hist_1", tenantId);
    });
    await advance(stub, t0 + 60_000);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await env.DB.prepare("ALTER TABLE standing_history RENAME TO sh_x").run();
    try {
      await advance(stub, Date.UTC(2031, 5, 4, 0, 0, 5));
    } finally {
      await env.DB.prepare("ALTER TABLE sh_x RENAME TO standing_history").run();
    }
    expect(logged(errorSpy, "standing_history_write_failed")).toBe(true);

    await advance(stub, Date.UTC(2031, 5, 4, 0, 1, 5));
    const rows = await env.DB.prepare("SELECT day FROM standing_history WHERE tenant_id = ?")
      .bind(tenantId)
      .all<{ day: string }>();
    expect(rows.results.map((r) => r.day)).toEqual(["2031-06-04"]);
  });
});
