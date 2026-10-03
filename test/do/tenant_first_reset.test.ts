/**
 * WP-F.10 T-F.10.3 (AU-04): a new tenant's first alarm (the 60 s standing-mirror
 * alarm) must not run nightlyReset mid-day. The reset day is set to "today" when
 * the tenant is first loaded, so the first reset runs at the next UTC midnight.
 */
import { describe, expect, it } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { TenantQuotaDO } from "../../src/quota/tenant/tenant_do";
import { advance } from "../helpers/clock";

describe("TenantQuotaDO first reset day (AU-04)", () => {
  it("a tenant created at 14:00 gets no standing_history row from the 14:01 dirty alarm, and exactly one at the next midnight", async () => {
    const tenantId = `usr_first_reset_${crypto.randomUUID()}`;
    const ns = (env as unknown as { TENANT_QUOTA: DurableObjectNamespace }).TENANT_QUOTA;
    const stub = ns.get(ns.idFromName(tenantId));

    const createdAt = Date.UTC(2031, 2, 10, 14, 0, 0);
    await runInDurableObject(stub, async (quota: TenantQuotaDO) => {
      quota.setClockForTest(createdAt);
      // reset() marks standing dirty and schedules the 60 s mirror alarm.
      await quota.reset();
      expect(quota.isStandingDirty()).toBe(true);
    });

    await advance(stub, Date.UTC(2031, 2, 10, 14, 1, 0));

    const countRows = async (): Promise<number> => {
      const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM standing_history WHERE tenant_id = ?")
        .bind(tenantId)
        .first<{ n: number }>();
      return Number(row?.n ?? 0);
    };

    expect(await countRows()).toBe(0);
    await runInDurableObject(stub, async (quota: TenantQuotaDO) => {
      expect(quota.isStandingDirty()).toBe(false);
      const standing = await quota.standing(tenantId);
      expect(standing.consecutiveDebtFreeDays).toBe(0);
    });

    await advance(stub, Date.UTC(2031, 2, 11, 0, 0, 5));

    expect(await countRows()).toBe(1);
    const hist = await env.DB.prepare("SELECT day FROM standing_history WHERE tenant_id = ?")
      .bind(tenantId)
      .first<{ day: string }>();
    expect(hist?.day).toBe("2031-03-11");
  });
});
