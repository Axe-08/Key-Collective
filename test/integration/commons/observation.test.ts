/**
 * Key Collective — Observation Lifecycle & Notification Tests (WP-5.2 T-5.2.2 / AC-05)
 *
 * Verifies:
 * - A key submitted as COMMUNITY starts in OBSERVATION with observation_until = T + 24h.
 * - During OBSERVATION, key is leasable only with ownOnly=true (owner only), borrower gets null (AC-05).
 * - After observation_until passes and coordinator alarm runs:
 *   - Coordinator marks key ACTIVE.
 *   - D1 api_keys.community_routing_status is updated to 'ACTIVE'.
 *   - D1 notifications row is created for the owner: "Your key joined the community pool".
 *   - Borrower can now lease the key (ownOnly=false).
 */

import { describe, expect, it } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { PoolCoordinatorDO } from "../../../src/pool/coordinator_do";
import { addProviderKey, createUser } from "../../helpers/world";

function getCoordinatorStub(name: string): DurableObjectStub {
  return env.POOL_COORDINATOR.get(env.POOL_COORDINATOR.idFromName(name));
}

describe("Observation Lifecycle & Anti-Cycling (WP-5.2 T-5.2.2 / AC-05)", () => {
  it("AC-05: key in OBSERVATION serves owner only; coordinator alarm promotes to D1 ACTIVE and notifies owner", async () => {
    const owner = await createUser({ github: true, eligible: true });
    const borrower = await createUser({ github: true, eligible: true });

    const t0 = Date.UTC(2030, 5, 1, 12, 0, 0);
    const observationUntil = t0 + 24 * 3600 * 1000; // +24 hours

    // 1. Add key with status OBSERVATION in D1
    const key = await addProviderKey(owner, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_observation_test_key_12345",
      rpmLimit: 10,
    });

    // Update D1 row to explicitly set community_routing_status='OBSERVATION' and observation_until
    await env.DB.prepare(
      "UPDATE api_keys SET community_routing_status = 'OBSERVATION', observation_until = ? WHERE id = ?"
    )
      .bind(observationUntil, key.id)
      .run();

    const shardName = "pool:groq";
    const stub = getCoordinatorStub(shardName);

    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(t0);

      await coord.upsertKey({
        keyId: key.id,
        owner: owner.id,
        provider: "groq",
        status: "OBSERVATION",
        observationUntil,
        rpmLimit: 10,
        rpdLimit: 100,
      });

      // 2. T = 0 + 1 min: Owner can lease (ownOnly=true)
      coord.setClockForTest(t0 + 60_000);
      const ownerLease = await coord.lease({
        tenant: owner.id,
        ownOnly: true,
        estimateCu: 10,
      });
      expect(ownerLease).not.toBeNull();
      expect(ownerLease?.keyId).toBe(key.id);
      expect(ownerLease?.source).toBe("own_community");

      // 3. T + 23h 59m: Borrower cannot lease (ownOnly=false) -> null
      coord.setClockForTest(observationUntil - 60_000);
      const borrowerEarlyLease = await coord.lease({
        tenant: borrower.id,
        ownOnly: false,
        estimateCu: 10,
      });
      expect(borrowerEarlyLease).toBeNull();

      // 4. Advance to T + 24h (observation period elapsed) and run alarm()
      coord.setClockForTest(observationUntil + 1000);
      await coord.alarm();

      // 5. Coordinator state should now be ACTIVE
      const stats = await coord.stats();
      expect(stats.observationKeys).toBe(0);
      expect(stats.activeKeys).toBe(1);

      // 6. Borrower can now lease the key!
      const borrowerLease = await coord.lease({
        tenant: borrower.id,
        ownOnly: false,
        estimateCu: 10,
      });
      expect(borrowerLease).not.toBeNull();
      expect(borrowerLease?.keyId).toBe(key.id);
      expect(borrowerLease?.source).toBe("borrowed");
    });

    // 7. Verify D1 status updated to ACTIVE
    const keyRow = await env.DB.prepare(
      "SELECT community_routing_status, status_changed_at FROM api_keys WHERE id = ?"
    )
      .bind(key.id)
      .first<{ community_routing_status: string; status_changed_at: number }>();

    expect(keyRow?.community_routing_status).toBe("ACTIVE");

    // 8. Verify D1 notification created for owner
    const notifRow = await env.DB.prepare(
      "SELECT type, key_id, message FROM notifications WHERE tenant_id = ? AND key_id = ?"
    )
      .bind(owner.id, key.id)
      .first<{ type: string; key_id: string; message: string }>();

    expect(notifRow).not.toBeNull();
    expect(notifRow?.type).toBe("pool_joined");
    expect(notifRow?.message).toContain("joined the community pool");
  });
});
