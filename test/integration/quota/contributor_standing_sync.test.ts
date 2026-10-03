import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { TenantQuotaDO, type DurableObjectStateLike } from "../../../src/quota/tenant";
import type { DurableObjectStorageLike } from "../../../src/durable_objects/circuit_breaker";

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

describe("WP-6.5 / T-6.5.3: Contributor standing D1 sync without credit units", () => {
  it("does not name community_debt_sub_cu when synchronizing TenantQuotaDO to D1 contributor_standing", async () => {
    const tenantId = `usr_standing_sync_${Date.now()}`;
    const storage = new InMemoryStorage();
    const state: DurableObjectStateLike = {
      id: {
        toString: () => tenantId,
        name: tenantId,
      },
      storage,
      waitUntil: () => {},
    };

    const executedSqls: string[] = [];
    const dbProxy = {
      prepare(sql: string) {
        executedSqls.push(sql);
        return env.DB.prepare(sql);
      },
      batch(stmts: Parameters<D1Database["batch"]>[0]) {
        return env.DB.batch(stmts);
      },
      exec(sql: string) {
        executedSqls.push(sql);
        return env.DB.exec(sql);
      },
    };

    const now = Date.UTC(2026, 9, 2, 12, 0, 0);
    const quotaDo = new TenantQuotaDO(state, { DB: dbProxy as unknown as D1Database }, {
      tenantId,
      timeProvider: () => now,
    });

    await quotaDo.accrueDebt(120n, "lease_sync_1", tenantId);
    expect(quotaDo.isStandingDirty()).toBe(true);

    await quotaDo.alarm();

    expect(executedSqls.length).toBeGreaterThan(0);
    for (const sql of executedSqls) {
      expect(sql).not.toContain("community_debt_sub_cu");
    }

    const d1Row = await env.DB.prepare(
      "SELECT community_debt_cu FROM contributor_standing WHERE tenant_id = ?"
    )
      .bind(tenantId)
      .first<{ community_debt_cu: number }>();

    expect(d1Row).not.toBeNull();
    expect(d1Row!.community_debt_cu).toBe(120);
  });
});
