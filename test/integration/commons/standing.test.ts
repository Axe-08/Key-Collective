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
});
