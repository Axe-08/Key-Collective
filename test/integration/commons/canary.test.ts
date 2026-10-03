import { describe, expect, it, afterEach } from "vitest";
import { env, fetchMock, runInDurableObject } from "cloudflare:test";
import { KeyPoolDO } from "../../../src/durable_objects/key_pool/key_pool_do";
import { PoolCoordinatorDO } from "../../../src/pool/coordinator_do";
import { TenantQuotaDO } from "../../../src/quota/tenant/tenant_do";
import { addProviderKey, createUser } from "../../helpers/world";

function getKeyPoolStub(tenantId: string): DurableObjectStub {
  return env.KEY_POOL.get(env.KEY_POOL.idFromName(tenantId));
}

function getCoordinatorStub(name: string): DurableObjectStub {
  return env.POOL_COORDINATOR.get(env.POOL_COORDINATOR.idFromName(name));
}

function getQuotaStub(tenantId: string): DurableObjectStub {
  return env.TENANT_QUOTA.get(env.TENANT_QUOTA.idFromName(tenantId));
}

describe("Passive contributor canary (WP-5.9 T-5.9.1)", () => {
  afterEach(() => {
    fetchMock.deactivate();
  });

  it("probes a passive contributor's (< 50 requests) community keys on midnight alarm: 200 -> HEALTHY, 401 -> QUARANTINED + notification", async () => {
    const owner = await createUser({ github: true, eligible: true });
    const goodKey = await addProviderKey(owner, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_canary_good_key_00000001",
      label: "Groq Good Key",
    });
    const revokedKey = await addProviderKey(owner, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_canary_revoked_key_00002",
      label: "Groq Revoked Key",
    });

    const groqCoord = getCoordinatorStub("pool:groq");
    await runInDurableObject(groqCoord, async (coord: PoolCoordinatorDO) => {
      await coord.upsertKey({
        keyId: goodKey.id,
        owner: owner.id,
        provider: "groq",
        status: "ACTIVE",
      });
      await coord.upsertKey({
        keyId: revokedKey.id,
        owner: owner.id,
        provider: "groq",
        status: "ACTIVE",
      });
    });

    // Passive tenant: only 5 personal requests in the last 24h (< 50)
    const quotaStub = getQuotaStub(owner.id);
    await runInDurableObject(quotaStub, async (quotaDo: TenantQuotaDO) => {
      for (let i = 0; i < 5; i++) {
        await quotaDo.consumeQuota({
          tenantId: owner.id,
          cu: 10n,
          costCu: 100n,
        });
      }
    });

    let probeCalls = 0;
    fetchMock.activate();
    fetchMock.disableNetConnect();
    const groqPool = fetchMock.get("https://api.groq.com");
    groqPool
      .intercept({
        path: "/openai/v1/chat/completions",
        method: "POST",
      })
      .reply((opts) => {
        probeCalls += 1;
        const headers = opts.headers as Record<string, string> | undefined;
        const auth =
          headers?.authorization ??
          headers?.Authorization ??
          "";
        if (auth.includes("gsk_canary_revoked_key_00002")) {
          return {
            statusCode: 401,
            data: JSON.stringify({ error: { message: "Invalid API Key" } }),
          };
        }
        return {
          statusCode: 200,
          data: JSON.stringify({ id: "chatcmpl-ok" }),
        };
      })
      .persist();

    const keyPoolStub = getKeyPoolStub(owner.id);
    await runInDurableObject(keyPoolStub, async (poolDo: KeyPoolDO) => {
      await poolDo.reconcile(owner.id);
      await poolDo.alarm();
    });

    expect(probeCalls).toBe(2);

    // Verify goodKey remains HEALTHY in D1 and ACTIVE in coordinator
    const d1Good = await env.DB.prepare("SELECT status FROM api_keys WHERE id = ?")
      .bind(goodKey.id)
      .first<{ status: string }>();
    expect(d1Good?.status).toBe("HEALTHY");

    // Verify revokedKey is QUARANTINED in D1 and coordinator, and owner notification created
    const d1Revoked = await env.DB.prepare("SELECT status FROM api_keys WHERE id = ?")
      .bind(revokedKey.id)
      .first<{ status: string }>();
    expect(d1Revoked?.status).toBe("QUARANTINED");

    await runInDurableObject(groqCoord, async (coord: PoolCoordinatorDO) => {
      const goodState = await coord.getKeyState(goodKey.id);
      const revokedState = await coord.getKeyState(revokedKey.id);
      expect(goodState?.status).toBe("ACTIVE");
      expect(revokedState?.status).toBe("QUARANTINED");
    });

    const notif = await env.DB.prepare(
      "SELECT type, key_id, message FROM notifications WHERE tenant_id = ? AND key_id = ?"
    )
      .bind(owner.id, revokedKey.id)
      .first<{ type: string; key_id: string; message: string }>();
    expect(notif).not.toBeNull();
    expect(notif?.type).toBe("key_invalid");
  });

  it("skips canary probes for an active contributor (>= 50 personal requests in 24h)", async () => {
    const activeOwner = await createUser({ github: true, eligible: true });
    const commKey = await addProviderKey(activeOwner, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_canary_active_owner_0003",
    });

    const groqCoord = getCoordinatorStub("pool:groq");
    await runInDurableObject(groqCoord, async (coord: PoolCoordinatorDO) => {
      await coord.upsertKey({
        keyId: commKey.id,
        owner: activeOwner.id,
        provider: "groq",
        status: "ACTIVE",
      });
    });

    // Record 50 personal requests in TenantQuotaDO (use 'max' tier: 60 RPM, 10,000 RPD)
    const quotaStub = getQuotaStub(activeOwner.id);
    await runInDurableObject(quotaStub, async (quotaDo: TenantQuotaDO) => {
      await quotaDo.setTier("max");
      const baseNow = Date.UTC(2030, 6, 1, 12, 0, 0);
      for (let i = 0; i < 50; i++) {
        quotaDo.setClockForTest(baseNow + i * 3_000);
        const res = await quotaDo.consumeQuota({
          tenantId: activeOwner.id,
          cu: 1n,
          costCu: 10n,
        });
        expect(res.allowed).toBe(true);
      }
    });

    let probeCalls = 0;
    fetchMock.activate();
    fetchMock.disableNetConnect();
    const groqPool = fetchMock.get("https://api.groq.com");
    groqPool
      .intercept({
        path: "/openai/v1/chat/completions",
        method: "POST",
      })
      .reply(() => {
        probeCalls += 1;
        return { statusCode: 200, data: "{}" };
      })
      .persist();

    const keyPoolStub = getKeyPoolStub(activeOwner.id);
    await runInDurableObject(keyPoolStub, async (poolDo: KeyPoolDO) => {
      poolDo.setClockForTest(Date.UTC(2030, 6, 1, 13, 0, 0));
      await poolDo.reconcile(activeOwner.id);
      await poolDo.alarm();
    });

    expect(probeCalls).toBe(0);
  });
});
