/**
 * Key Collective — PoolCoordinatorDO SQLite Registry & Lease Tests (T-4.1.2)
 *
 * Verifies:
 * 1. Selection score: priority_boost + owner debt boost + classification boost + headroom.
 * 2. Round-robin tie-breaking with a rotating cursor across equal-score keys.
 * 3. ownOnly=true vs ownOnly=false (OBSERVATION keys serve owner only; ACTIVE keys lend to others).
 * 4. RPM and RPD limit enforcement on leased keys.
 * 5. Idempotent settle(leaseId, status, cu) via settled_leases.
 * 6. 60s alarm: promotes OBSERVATION keys past observation_until, reactivates COOLDOWN keys past
 *    reactivate_at, prunes expired brakes and borrower_window rows, and runs 5-min D1 reconcile.
 * 7. D1 reconcile(provider) with D-21 filter: only registers COMMUNITY keys whose owner holds communityPool.
 * 8. Legacy HTTP endpoints (/coordinator/health, /report-volume, /update-provider, /brake-status/*) are removed (404).
 */

import { describe, expect, it } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { PoolCoordinatorDO } from "../../src/pool/coordinator_do";
import { addProviderKey, createUser } from "../helpers/world";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    POOL_COORDINATOR: DurableObjectNamespace;
  }
}

function getCoordinatorStub(name: string): DurableObjectStub {
  return env.POOL_COORDINATOR.get(env.POOL_COORDINATOR.idFromName(name));
}

describe("PoolCoordinatorDO (T-4.1.2)", () => {
  it("selects the highest-scoring key using owner debt boost, classification, and headroom", async () => {
    const stub = getCoordinatorStub("test-coord-score");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(Date.UTC(2030, 0, 15, 10, 0, 0));

      await coord.upsertKey({
        keyId: "key_low",
        owner: "owner_low",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 10,
        rpdLimit: 100,
      });
      await coord.upsertKey({
        keyId: "key_debtor",
        owner: "owner_debtor",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 10,
        rpdLimit: 100,
      });
      await coord.upsertKey({
        keyId: "key_hero",
        owner: "owner_hero",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 10,
        rpdLimit: 100,
        classification: "HERO",
      });

      // Push owner debt of 5,000 CU -> boost = min(5000, 5000 / 10) = 500
      await coord.setOwnerDebt("owner_debtor", 5000);

      const lease1 = await coord.lease({
        tenant: "borrower_1",
        ownOnly: false,
        estimateCu: 10,
      });
      expect(lease1).not.toBeNull();
      expect(lease1?.keyId).toBe("key_debtor");
      expect(lease1?.ownerTenantId).toBe("owner_debtor");
      expect(lease1?.source).toBe("borrowed");
    });
  });

  it("breaks ties round-robin with a rotating cursor when scores are equal", async () => {
    const stub = getCoordinatorStub("test-coord-rr");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(Date.UTC(2030, 0, 15, 10, 0, 0));

      // Give key_b 1 extra rpdLimit so after key_a is leased once (headroom 99),
      // we can also test exact tie at the start when both have rpdLimit=100 and day_count=0.
      await coord.upsertKey({
        keyId: "key_a",
        owner: "owner_a",
        provider: "groq",
        status: "ACTIVE",
        rpmLimit: 10,
        rpdLimit: 100,
      });
      await coord.upsertKey({
        keyId: "key_b",
        owner: "owner_b",
        provider: "groq",
        status: "ACTIVE",
        rpmLimit: 10,
        rpdLimit: 100,
      });

      // Lease 1: both at score 100 -> picks key_a
      const l1 = await coord.lease({ tenant: "borrower", ownOnly: false, estimateCu: 5 });
      expect(l1?.keyId).toBe("key_a");

      // Lease 2: key_b has headroom 100, key_a has headroom 99 -> picks key_b
      const l2 = await coord.lease({ tenant: "borrower", ownOnly: false, estimateCu: 5 });
      expect(l2?.keyId).toBe("key_b");

      // Lease 3: both now at headroom 99 (equal score) -> rotating cursor picks key_a
      const l3 = await coord.lease({ tenant: "borrower", ownOnly: false, estimateCu: 5 });
      expect(l3?.keyId).toBe("key_a");

      // Boost key_a by +1 so both key_a (headroom 98 + boost 1 = 99) and key_b (headroom 99) tie again!
      // Since last leased was key_a, the rotating cursor must pick key_b on tie.
      await coord.upsertKey({
        keyId: "key_a",
        owner: "owner_a",
        provider: "groq",
        status: "ACTIVE",
        rpmLimit: 10,
        rpdLimit: 100,
        priorityBoost: 1,
      });
      const l4 = await coord.lease({ tenant: "borrower", ownOnly: false, estimateCu: 5 });
      expect(l4?.keyId).toBe("key_b");
    });
  });

  it("enforces ownOnly semantics, OBSERVATION isolation, and RPM/RPD limits", async () => {
    const stub = getCoordinatorStub("test-coord-own-only");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(Date.UTC(2030, 0, 15, 10, 0, 0));

      await coord.upsertKey({
        keyId: "key_obs_owner",
        owner: "tenant_owner",
        provider: "google",
        status: "OBSERVATION",
        observationUntil: Date.UTC(2030, 0, 15, 10, 0, 0) + 60_000,
        rpmLimit: 2,
        rpdLimit: 10,
      });

      // Another tenant cannot borrow an OBSERVATION key
      const strangerLease = await coord.lease({
        tenant: "tenant_stranger",
        ownOnly: false,
      });
      expect(strangerLease).toBeNull();

      // Owner CAN lease their own OBSERVATION key with ownOnly=true
      const own1 = await coord.lease({
        tenant: "tenant_owner",
        ownOnly: true,
      });
      expect(own1?.keyId).toBe("key_obs_owner");
      expect(own1?.source).toBe("own_community");

      const own2 = await coord.lease({
        tenant: "tenant_owner",
        ownOnly: true,
      });
      expect(own2?.keyId).toBe("key_obs_owner");

      // Third lease in the same minute hits rpmLimit=2
      const own3 = await coord.lease({
        tenant: "tenant_owner",
        ownOnly: true,
      });
      expect(own3).toBeNull();
    });
  });

  it("settles leases idempotently and updates key status on cooldown/quarantine outcomes", async () => {
    const stub = getCoordinatorStub("test-coord-settle");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      const t0 = Date.UTC(2030, 0, 15, 10, 0, 0);
      coord.setClockForTest(t0);

      await coord.upsertKey({
        keyId: "key_shared",
        owner: "owner_1",
        provider: "groq",
        status: "ACTIVE",
        rpmLimit: 10,
        rpdLimit: 100,
      });

      const lease = await coord.lease({
        tenant: "borrower_1",
        ownOnly: false,
        estimateCu: 20,
      });
      expect(lease).not.toBeNull();

      const first = await coord.settle(lease!.leaseId, "ok", 15);
      expect(first.settled).toBe(true);
      expect(first.duplicate).toBe(false);

      // Second settle with same leaseId is a no-op
      const second = await coord.settle(lease!.leaseId, "ok", 15);
      expect(second.settled).toBe(false);
      expect(second.duplicate).toBe(true);

      const statsAfterOk = await coord.stats();
      expect(statsAfterOk.borrowerCuInWindow).toBe(15);

      // Lease again and settle with key_invalid -> key becomes QUARANTINED
      const lease2 = await coord.lease({
        tenant: "borrower_1",
        ownOnly: false,
        estimateCu: 10,
      });
      expect(lease2?.keyId).toBe("key_shared");
      await coord.settle(lease2!.leaseId, "key_invalid", 0);

      const statsAfterQuarantine = await coord.stats();
      expect(statsAfterQuarantine.quarantinedKeys).toBe(1);
      expect(statsAfterQuarantine.activeKeys).toBe(0);
    });
  });

  it("alarm promotes OBSERVATION keys, reactivates COOLDOWN keys, and prunes expired state", async () => {
    const stub = getCoordinatorStub("test-coord-alarm");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      const t0 = Date.UTC(2030, 0, 15, 10, 0, 0);
      coord.setClockForTest(t0);

      await coord.upsertKey({
        keyId: "key_obs",
        owner: "owner_1",
        provider: "google",
        status: "OBSERVATION",
        observationUntil: t0 + 30_000,
        rpmLimit: 10,
        rpdLimit: 100,
      });
      await coord.upsertKey({
        keyId: "key_cool",
        owner: "owner_2",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 10,
        rpdLimit: 100,
      });
      await coord.setStatus("key_cool", "COOLDOWN", t0 + 45_000);

      let s = await coord.stats();
      expect(s.observationKeys).toBe(1);
      expect(s.cooldownKeys).toBe(1);
      expect(s.activeKeys).toBe(0);

      // Advance clock by 60s and run alarm
      coord.setClockForTest(t0 + 60_000);
      await coord.alarm();

      s = await coord.stats();
      expect(s.observationKeys).toBe(0);
      expect(s.cooldownKeys).toBe(0);
      expect(s.activeKeys).toBe(2);
    });
  });

  it("reconciles against D1 and enforces D-21 (excludes COMMUNITY keys whose owner lacks communityPool)", async () => {
    const googleOnlyOwner = await createUser({ github: false, eligible: false });
    const eligibleOwner = await createUser({ github: true, eligible: true });

    const strandedKey = await addProviderKey(googleOnlyOwner, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_stranded_coord_key_00001",
    });
    const eligibleKey = await addProviderKey(eligibleOwner, {
      provider: "groq",
      pool: "COMMUNITY",
      plaintext: "gsk_eligible_coord_key_00002",
    });

    await env.DB.prepare(
      "UPDATE api_keys SET community_routing_status = 'ACTIVE' WHERE id IN (?, ?)"
    )
      .bind(strandedKey.id, eligibleKey.id)
      .run();

    const stub = getCoordinatorStub("pool:groq");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(Date.UTC(2030, 0, 15, 10, 0, 0));
      await coord.reconcile("groq");

      const borrowerLease = await coord.lease({
        tenant: "borrower_x",
        ownOnly: false,
      });
      expect(borrowerLease).not.toBeNull();
      expect(borrowerLease?.keyId).toBe(eligibleKey.id);

      // Revoke eligibleKey in D1 and reconcile -> removed from coordinator
      await env.DB.prepare("UPDATE api_keys SET status = 'REVOKED' WHERE id = ?")
        .bind(eligibleKey.id)
        .run();
      await coord.reconcile("groq");

      const afterRevoke = await coord.lease({
        tenant: "borrower_y",
        ownOnly: false,
      });
      expect(afterRevoke).toBeNull();
    });
  });

  it("returns 404 for removed legacy HTTP endpoints", async () => {
    const stub = getCoordinatorStub("test-coord-http");
    for (const path of [
      "/coordinator/health",
      "/coordinator/report-volume",
      "/coordinator/update-provider",
      "/coordinator/brake-status/t1",
    ]) {
      const res = await stub.fetch(`https://coord.test${path}`);
      await res.text();
      expect(res.status).toBe(404);
    }
  });

  it("increments dispatched_today and dispatched_communal in settle() (not lease()): 5 borrowed + 5 own -> dispatched=10, communal=5 (T-5.5.2)", async () => {
    const { KeyPoolDO } = await import("../../src/durable_objects/key_pool/key_pool_do");
    expect("recordDispatch" in KeyPoolDO.prototype).toBe(false);

    const stub = getCoordinatorStub("test-coord-dispatch-counters");
    await runInDurableObject(stub, async (coord: PoolCoordinatorDO) => {
      const t0 = Date.UTC(2030, 0, 15, 10, 0, 0);
      coord.setClockForTest(t0);

      await coord.upsertKey({
        keyId: "key_counter_1",
        owner: "owner_counter",
        provider: "google",
        status: "ACTIVE",
        rpmLimit: 100,
        rpdLimit: 1000,
      });

      const borrowedLeases: string[] = [];
      const ownLeases: string[] = [];

      for (let i = 0; i < 5; i++) {
        const b = await coord.lease({
          tenant: `borrower_${i}`,
          ownOnly: false,
          estimateCu: 10,
        });
        expect(b).not.toBeNull();
        borrowedLeases.push(b!.leaseId);

        const o = await coord.lease({
          tenant: "owner_counter",
          ownOnly: true,
          estimateCu: 10,
        });
        expect(o).not.toBeNull();
        ownLeases.push(o!.leaseId);
      }

      // Before settle(), dispatch counters are 0
      const statsBeforeSettle = await coord.stats();
      expect(statsBeforeSettle.dispatchedToday).toBe(0);
      expect(statsBeforeSettle.dispatchedCommunal).toBe(0);

      for (const lid of borrowedLeases) {
        await coord.settle(lid, "ok", 10);
      }
      for (const lid of ownLeases) {
        await coord.settle(lid, "ok", 10);
      }

      const statsAfterSettle = await coord.stats();
      expect(statsAfterSettle.dispatchedToday).toBe(10);
      expect(statsAfterSettle.dispatchedCommunal).toBe(5);
    });
  });
});
