/**
 * Key Collective — KeyPoolDO Private Lease API Tests (WP-4.1, T-4.1.3)
 *
 * Verifies:
 * 1. leasePrivate(provider, estimateCu) loads tenant's PRIVATE keys from D1 on first access
 *    and ignores COMMUNITY keys when the owner has communityPool rights.
 * 2. D-21: A Google-only owner's stranded COMMUNITY key (owner lacks communityPool) is served
 *    to its owner via KeyPoolDO.leasePrivate.
 * 3. Per-key RPM limit is enforced at lease time and resets after 60s on the test clock.
 * 4. settle(leaseId, outcome, cu) is idempotent; upstream_error trips the circuit breaker after
 *    5 consecutive failures and recovers to HALF_OPEN after 60s; key_invalid quarantines in DO + D1.
 * 5. reconcile() reflects key add, delete, and pool-mode toggles (PRIVATE <-> COMMUNITY) across
 *    KeyPoolDO and PoolCoordinatorDO.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { DEFAULT_CIRCUIT_BREAKER_THRESHOLD } from "../../src/constants/limits";
import type { KeyPoolDO } from "../../src/durable_objects/key_pool/key_pool_do";
import type { PoolCoordinatorDO } from "../../src/pool/coordinator_do";
import { defaultMainWorker } from "../../src/worker/index";
import type { WorkerEnv } from "../../src/worker/auth/index";
import { addProviderKey, createSession, createUser } from "../helpers/world";

function getKeyPoolStub(tenantId: string): DurableObjectStub<KeyPoolDO> {
  const ns = env.KEY_POOL as unknown as DurableObjectNamespace<KeyPoolDO>;
  return ns.get(ns.idFromName(tenantId));
}

function getCoordinatorStub(provider: string): DurableObjectStub<PoolCoordinatorDO> {
  const ns = env.POOL_COORDINATOR as unknown as DurableObjectNamespace<PoolCoordinatorDO>;
  return ns.get(ns.idFromName(provider));
}

describe("KeyPoolDO private lease API (T-4.1.3)", () => {
  it("loads PRIVATE keys from D1 on first access and excludes eligible owner's COMMUNITY keys", async () => {
    const alice = await createUser({ github: true, eligible: true });
    const privKey = await addProviderKey(alice, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_priv_alice_first_access_01",
      rpmLimit: 5,
    });
    await addProviderKey(alice, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_comm_alice_first_access_02",
      rpmLimit: 5,
    });

    const pool = getKeyPoolStub(alice.id);
    const lease = await pool.leasePrivate("groq", 100, alice.id);

    expect(lease).not.toBeNull();
    expect(lease?.keyId).toBe(privKey.id);
    expect(lease?.ownerTenantId).toBe(alice.id);
    expect(lease?.source).toBe("private");
    expect(lease?.provider).toBe("groq");
  });

  it("D-21: serves a Google-only owner's stranded COMMUNITY key via leasePrivate", async () => {
    const googleOnly = await createUser({ github: false, eligible: false });
    const stranded = await addProviderKey(googleOnly, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_stranded_d21_private_lease",
      rpmLimit: 5,
    });
    await env.DB.prepare("UPDATE api_keys SET community_routing_status = 'ACTIVE' WHERE id = ?")
      .bind(stranded.id)
      .run();

    const pool = getKeyPoolStub(googleOnly.id);
    const lease = await pool.leasePrivate("groq", 50, googleOnly.id);

    expect(lease).not.toBeNull();
    expect(lease?.keyId).toBe(stranded.id);
    expect(lease?.ownerTenantId).toBe(googleOnly.id);
    expect(lease?.source).toBe("private");
  });

  it("enforces per-key rpmLimit on leasePrivate and recovers after 60s on test clock", async () => {
    const bob = await createUser({ github: true, eligible: true });
    const privKey = await addProviderKey(bob, {
      provider: "google",
      pool: "PRIVATE",
      plaintext: "AIzaSyPrivateBobRpmLimitKey00000000001",
      rpmLimit: 2,
      rpdLimit: 100,
    });

    const pool = getKeyPoolStub(bob.id);
    const t0 = Date.UTC(2030, 0, 15, 12, 0, 0);
    await pool.setClockForTest(t0);

    const l1 = await pool.leasePrivate("google", 10, bob.id);
    const l2 = await pool.leasePrivate("google", 10, bob.id);
    const l3 = await pool.leasePrivate("google", 10, bob.id);

    expect(l1?.keyId).toBe(privKey.id);
    expect(l2?.keyId).toBe(privKey.id);
    expect(l3).toBeNull();

    // Advance clock past 60s RPM window
    await pool.setClockForTest(t0 + 61_000);
    const l4 = await pool.leasePrivate("google", 10, bob.id);
    expect(l4?.keyId).toBe(privKey.id);
  });

  it("settle is idempotent, trips circuit breaker after consecutive upstream_error outcomes, and quarantines on key_invalid", async () => {
    const carol = await createUser({ github: true, eligible: true });
    const privKey = await addProviderKey(carol, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_priv_carol_breaker_test_001",
      rpmLimit: 20,
      rpdLimit: 500,
    });

    const pool = getKeyPoolStub(carol.id);
    const t0 = Date.UTC(2030, 0, 15, 13, 0, 0);
    await pool.setClockForTest(t0);

    for (let i = 0; i < DEFAULT_CIRCUIT_BREAKER_THRESHOLD; i++) {
      const lease = await pool.leasePrivate("groq", 10, carol.id);
      expect(lease?.keyId).toBe(privKey.id);
      const firstSettle = await pool.settle(lease!.leaseId, "upstream_error", 10);
      expect(firstSettle.settled).toBe(true);
      expect(firstSettle.duplicate).toBe(false);

      // Duplicate settle on the first lease must be a no-op
      if (i === 0) {
        const dupSettle = await pool.settle(lease!.leaseId, "upstream_error", 10);
        expect(dupSettle.settled).toBe(true);
        expect(dupSettle.duplicate).toBe(true);
      }
    }

    // Circuit breaker is now OPEN -> leasePrivate returns null
    expect(await pool.leasePrivate("groq", 10, carol.id)).toBeNull();

    // Advance clock by 61s -> breaker transitions to HALF_OPEN -> lease succeeds
    await pool.setClockForTest(t0 + 61_000);
    const halfOpenLease = await pool.leasePrivate("groq", 10, carol.id);
    expect(halfOpenLease?.keyId).toBe(privKey.id);

    // Settling key_invalid quarantines the key in KeyPoolDO and D1
    await pool.settle(halfOpenLease!.leaseId, "key_invalid", 0);
    expect(await pool.leasePrivate("groq", 10, carol.id)).toBeNull();

    const row = await env.DB.prepare("SELECT status FROM api_keys WHERE id = ?")
      .bind(privKey.id)
      .first<{ status: string }>();
    expect(row?.status).toBe("QUARANTINED");
  });

  it("updates KeyPoolDO and PoolCoordinatorDO on pool-mode toggle and key deletion", async () => {
    const dave = await createUser({ github: true, eligible: true });
    const key = await addProviderKey(dave, {
      provider: "groq",
      pool: "PRIVATE",
      plaintext: "gsk_priv_dave_toggle_mode_0001",
      rpmLimit: 10,
    });

    const pool = getKeyPoolStub(dave.id);
    const coord = getCoordinatorStub("groq");

    // Initially PRIVATE -> leasable via leasePrivate, not in coordinator
    const privLease = await pool.leasePrivate("groq", 10, dave.id);
    expect(privLease?.keyId).toBe(key.id);

    // Switch PRIVATE -> COMMUNITY via PATCH /api/keys/:id/pool-mode
    const { cookie, csrfToken } = await createSession(dave);
    const toCommRes = await defaultMainWorker.fetch(
      new Request(`https://console.test/api/keys/${key.id}/pool-mode`, {
        method: "PATCH",
        headers: {
          cookie,
          "x-kc-csrf": csrfToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({ pool_type: "COMMUNITY" }),
      }),
      env as unknown as WorkerEnv
    );
    expect(toCommRes.status).toBe(200);

    // KeyPoolDO no longer leases it as private; Coordinator leases it as own_community (in OBSERVATION)
    expect(await pool.leasePrivate("groq", 10, dave.id)).toBeNull();
    const ownCommLease = await coord.lease({
      tenant: dave.id,
      ownOnly: true,
      estimateCu: 10,
      provider: "groq",
    });
    expect(ownCommLease?.keyId).toBe(key.id);

    // Switch COMMUNITY -> PRIVATE via PATCH /api/keys/:id/pool-mode
    const toPrivRes = await defaultMainWorker.fetch(
      new Request(`https://console.test/api/keys/${key.id}/pool-mode`, {
        method: "PATCH",
        headers: {
          cookie,
          "x-kc-csrf": csrfToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({ pool_type: "PRIVATE" }),
      }),
      env as unknown as WorkerEnv
    );
    expect(toPrivRes.status).toBe(200);

    // Coordinator no longer has it; KeyPoolDO leases it as private again
    expect(
      await coord.lease({
        tenant: dave.id,
        ownOnly: true,
        estimateCu: 10,
        provider: "groq",
      })
    ).toBeNull();
    const privAgain = await pool.leasePrivate("groq", 10, dave.id);
    expect(privAgain?.keyId).toBe(key.id);

    // Delete via DELETE /api/keys/:id -> removed from KeyPoolDO
    const delRes = await defaultMainWorker.fetch(
      new Request(`https://console.test/api/keys/${key.id}`, {
        method: "DELETE",
        headers: {
          cookie,
          "x-kc-csrf": csrfToken,
        },
      }),
      env as unknown as WorkerEnv
    );
    expect(delRes.status).toBe(200);
    expect(await pool.leasePrivate("groq", 10, dave.id)).toBeNull();
  });
});
