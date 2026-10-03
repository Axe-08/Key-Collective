import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { TenantQuotaDO, type DurableObjectStateLike } from "../../../src/quota/tenant";
import type { DurableObjectStorageLike } from "../../../src/durable_objects/circuit_breaker";
import { handleConsent } from "../../../src/auth/consent";
import { createPendingToken, PENDING_COOKIE } from "../../../src/auth/session/store";

class InMemoryStorage implements DurableObjectStorageLike {
  private readonly map = new Map<string, unknown>();
  public alarmTime: number | null = null;

  public async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  public async put<T = unknown>(key: string, value: T): Promise<void> {
    this.map.set(key, JSON.parse(JSON.stringify(value)));
  }

  public async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }

  public async deleteAll(): Promise<void> {
    this.map.clear();
  }

  public async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    const prefix = options?.prefix ?? "";
    for (const [k, v] of this.map.entries()) {
      if (k.startsWith(prefix)) {
        out.set(k, JSON.parse(JSON.stringify(v)) as T);
      }
    }
    return out;
  }

  public async setAlarm(time: number): Promise<void> {
    this.alarmTime = time;
  }

  public async getAlarm(): Promise<number | null> {
    return this.alarmTime;
  }
}

describe("Standing mirror to D1 (WP-5.3 T-5.3.3)", () => {
  it("marks TenantQuotaDO dirty on debt/contribution change, schedules 60s alarm, and mirrors standing to D1 contributor_standing", async () => {
    const tenantId = `usr_standing_${Date.now()}`;
    const storage = new InMemoryStorage();
    const state: DurableObjectStateLike = {
      id: {
        toString: () => tenantId,
        name: tenantId,
      },
      storage,
      waitUntil: () => {},
    };

    const now = Date.UTC(2026, 9, 2, 12, 0, 0);
    const quotaDo = new TenantQuotaDO(state, { DB: env.DB }, {
      tenantId,
      timeProvider: () => now,
    });

    // Accrue 250 debt and credit 100 -> net debt 150, contributed 0; then credit 300 -> debt 0, contributed 150
    await quotaDo.accrueDebt(250n, "lease_s_1", tenantId);
    await quotaDo.credit(100n, "lease_s_2", tenantId);
    expect(quotaDo.isStandingDirty()).toBe(true);
    expect(storage.alarmTime).toBe(now + 60_000);

    // Run the 60s dirty alarm on the same day
    await quotaDo.alarm();
    expect(quotaDo.isStandingDirty()).toBe(false);

    const doState = await quotaDo.standing(tenantId);
    const d1Row = await env.DB.prepare(
      `SELECT tenant_id, community_debt_cu, contributed_cu_24h, multiplier_pct, jail_status, trusted_contributor, consecutive_debt_free_days
       FROM contributor_standing WHERE tenant_id = ?`
    )
      .bind(tenantId)
      .first<{
        tenant_id: string;
        community_debt_cu: number;
        contributed_cu_24h: number;
        multiplier_pct: number;
        jail_status: string;
        trusted_contributor: number;
        consecutive_debt_free_days: number;
      }>();

    expect(d1Row).not.toBeNull();
    expect(String(d1Row!.community_debt_cu)).toBe(doState.communityDebtCu);
    expect(String(d1Row!.contributed_cu_24h)).toBe(doState.contributedCu24h);
    expect(d1Row!.multiplier_pct).toBe(doState.multiplierCeiling);
    expect(d1Row!.jail_status).toBe(doState.jailStatus);
    expect(Boolean(d1Row!.trusted_contributor)).toBe(doState.trustedContributor);
    expect(d1Row!.consecutive_debt_free_days).toBe(doState.consecutiveDebtFreeDays);
  });

  it("inserts a contributor_standing row on user registration consent", async () => {
    const userId = `usr_reg_standing_${Date.now()}`;
    await env.DB.prepare(
      "INSERT INTO users (id, email, tier, role, registration_status) VALUES (?, ?, 'builder', 'user', 'PENDING_CONSENT')"
    )
      .bind(userId, `${userId}@example.com`)
      .run();

    const pendingToken = await createPendingToken(String(env.KC_MASTER_KEY ?? "test-master-key-please-rotate"), userId);
    const req = new Request("https://console.test/api/auth/consent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${PENDING_COOKIE}=${pendingToken}`,
      },
      body: JSON.stringify({ c1: true, c2: true, c3: true }),
    });

    const res = await handleConsent(req, env as unknown as Parameters<typeof handleConsent>[1]);
    expect(res.status).toBe(200);

    const standingRow = await env.DB.prepare(
      "SELECT tenant_id, community_debt_cu, contributed_cu_24h, multiplier_pct, jail_status FROM contributor_standing WHERE tenant_id = ?"
    )
      .bind(userId)
      .first<{
        tenant_id: string;
        community_debt_cu: number;
        contributed_cu_24h: number;
        multiplier_pct: number;
        jail_status: string;
      }>();

    expect(standingRow).toEqual({
      tenant_id: userId,
      community_debt_cu: 0,
      contributed_cu_24h: 0,
      multiplier_pct: 100,
      jail_status: "PRISTINE",
    });
  });

  it("GET /api/pool/standing for a brand-new user returns debt 0 and multiplier 1.00x from TenantQuotaDO, and 500 when DO is missing (T-5.3.4)", async () => {
    const { handlePoolRoute } = await import("../../../src/worker/pool_routes");
    const brandNewTenant = `usr_brand_new_${Date.now()}`;
    const storage = new InMemoryStorage();
    const quotaDo = new TenantQuotaDO(
      {
        id: { toString: () => brandNewTenant, name: brandNewTenant },
        storage,
        waitUntil: () => {},
      },
      { DB: env.DB },
      { tenantId: brandNewTenant }
    );

    const envWithQuota = {
      DB: env.DB,
      TENANT_QUOTA: {
        idFromName: (name: string) => name,
        get: () => quotaDo,
      },
    } as unknown as Parameters<typeof handlePoolRoute>[3];

    const req = new Request("https://console.test/api/pool/standing");
    const res = await handlePoolRoute(
      "/api/pool/standing",
      "GET",
      req,
      envWithQuota,
      brandNewTenant,
      { waitUntil: () => {} }
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as {
      multiplier: number;
      multiplier_pct: number;
      community_debt_cu: number;
      contributed_cu_24h: number;
      jail_status: string;
    };
    expect(body.community_debt_cu).toBe(0);
    expect(body.contributed_cu_24h).toBe(0);
    expect(body.multiplier).toBe(1.0);
    expect(body.multiplier_pct).toBe(100);
    expect(body.jail_status).toBe("PRISTINE");

    // Missing TenantQuotaDO -> 500, not hard-coded PRISTINE
    const envWithoutQuota = {
      DB: env.DB,
    } as unknown as Parameters<typeof handlePoolRoute>[3];
    const resMissing = await handlePoolRoute(
      "/api/pool/standing",
      "GET",
      req,
      envWithoutQuota,
      brandNewTenant,
      { waitUntil: () => {} }
    );
    expect(resMissing).not.toBeNull();
    expect(resMissing!.status).toBe(500);
  });

  it("GET /api/pool/contribution computes requests_served_for_community_today, personal_requests_today, cu_contributed_24h, cu_borrowed_24h, net_cu from coordinator and TenantQuotaDO (T-5.3.4)", async () => {
    const { handlePoolRoute } = await import("../../../src/worker/pool_routes");
    const { createUser } = await import("../../helpers/world");
    const owner = await createUser({ github: true, eligible: true });
    const borrower = await createUser({ github: true, eligible: true });

    const coordStub = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:groq")
    ) as unknown as {
      upsertKey(input: {
        keyId: string;
        owner: string;
        provider: string;
        status: "ACTIVE";
        rpmLimit: number;
        rpdLimit: number;
      }): Promise<{ registered: boolean }>;
      lease(req: { tenant: string; ownOnly: boolean; estimateCu?: number }): Promise<{ leaseId: string } | null>;
      settle(leaseId: string, status: string, cu: number): Promise<unknown>;
      ownerStats(owner: string): Promise<{
        totalCommunityKeys: number;
        activeCommunityKeys: number;
        dispatchedToday: number;
        dispatchedCommunal: number;
      }>;
      removeKey(keyId: string): Promise<boolean>;
    };

    const keyId = `key_contrib_${Date.now()}`;
    await coordStub.upsertKey({
      keyId,
      owner: owner.id,
      provider: "groq",
      status: "ACTIVE",
      rpmLimit: 50,
      rpdLimit: 1000,
    });

    // 2 personal leases (ownOnly: true) and 3 borrowed leases (ownOnly: false)
    for (let i = 0; i < 2; i++) {
      const l = await coordStub.lease({ tenant: owner.id, ownOnly: true, estimateCu: 10 });
      await coordStub.settle(l!.leaseId, "ok", 10);
    }
    for (let i = 0; i < 3; i++) {
      const l = await coordStub.lease({ tenant: borrower.id, ownOnly: false, estimateCu: 20 });
      await coordStub.settle(l!.leaseId, "ok", 20);
    }

    const storage = new InMemoryStorage();
    const quotaDo = new TenantQuotaDO(
      {
        id: { toString: () => owner.id, name: owner.id },
        storage,
        waitUntil: () => {},
      },
      { DB: env.DB },
      { tenantId: owner.id }
    );
    await quotaDo.credit(60n, "lease_c_1", owner.id);
    await quotaDo.accrueDebt(15n, "lease_d_1", owner.id);

    const testEnv = {
      ...env,
      TENANT_QUOTA: {
        idFromName: (name: string) => name,
        get: () => quotaDo,
      },
    } as unknown as Parameters<typeof handlePoolRoute>[3];

    const req = new Request("https://console.test/api/pool/contribution");
    const res = await handlePoolRoute(
      "/api/pool/contribution",
      "GET",
      req,
      testEnv,
      owner.id,
      { waitUntil: () => {} }
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as {
      requests_served_for_community_today: number;
      personal_requests_today: number;
      cu_contributed_24h: number;
      cu_borrowed_24h: number;
      net_cu: number;
    };

    expect(body.requests_served_for_community_today).toBe(3);
    expect(body.personal_requests_today).toBe(2);
    expect(body.cu_contributed_24h).toBe(60);
    expect(body.cu_borrowed_24h).toBe(15);
    expect(body.net_cu).toBe(45);

    await coordStub.removeKey(keyId);
  });

  it("inserts a standing_history row into D1 for each nightly reset day (T-5.4.2)", async () => {
    const tenantId = `usr_hist_${Date.now()}`;
    const storage = new InMemoryStorage();
    let now = Date.UTC(2026, 9, 1, 20, 0, 0); // 2026-10-01

    const quotaDo = new TenantQuotaDO(
      {
        id: { toString: () => tenantId, name: tenantId },
        storage,
        waitUntil: () => {},
      },
      { DB: env.DB },
      {
        tenantId,
        timeProvider: () => now,
      }
    );

    await quotaDo.credit(200n, "lease_h_1", tenantId);
    await quotaDo.accrueDebt(100n, "lease_h_2", tenantId);

    // Advance across midnight to 2026-10-02T00:05:00Z
    now = Date.UTC(2026, 9, 2, 0, 5, 0);
    await quotaDo.alarm();

    const histRow = await env.DB.prepare(
      "SELECT tenant_id, day, multiplier_pct, debt_cu, contributed_cu_24h, jail_status FROM standing_history WHERE tenant_id = ? AND day = '2026-10-02'"
    )
      .bind(tenantId)
      .first<{
        tenant_id: string;
        day: string;
        multiplier_pct: number;
        debt_cu: number;
        contributed_cu_24h: number;
        jail_status: string;
      }>();

    expect(histRow).toEqual({
      tenant_id: tenantId,
      day: "2026-10-02",
      multiplier_pct: 450,
      debt_cu: 80,
      contributed_cu_24h: 200,
      jail_status: "PRISTINE",
    });
  });
});

describe("GET /api/pool/standing without a real tenant (T-F.7.8, RA-12)", () => {
  it.each(["anonymous", "guest", "default", ""])("answers 401 for %j, never an invented PRISTINE standing", async (tenantId) => {
    const { handlePoolRoute } = await import("../../../src/worker/pool_routes");
    const res = await handlePoolRoute(
      "/api/pool/standing",
      "GET",
      new Request("https://console.test/api/pool/standing"),
      { DB: env.DB } as unknown as Parameters<typeof handlePoolRoute>[3],
      tenantId,
      { waitUntil: () => {} }
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = (await res!.json()) as Record<string, unknown>;
    expect("jail_status" in body).toBe(false);
    expect("caps" in body).toBe(false);
  });
});
