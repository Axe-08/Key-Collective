import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock, runInDurableObject } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { handleDeleteKey, handleRotateKeySecret } from "../../../src/worker/router/dashboard/keys/ops";
import { PoolCoordinatorDO } from "../../../src/pool/coordinator_do";
import { KeyPoolDO } from "../../../src/durable_objects/key_pool/key_pool_do";
import { createSession, createUser } from "../../helpers/world";

let scenarioProject = "777888999000";
let proofOfLifeStatus = 200;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  const json = { headers: { "content-type": "application/json" } };
  fetchMock
    .get("https://challenges.cloudflare.com")
    .intercept({ path: "/turnstile/v0/siteverify", method: "POST" })
    .reply(200, () => JSON.stringify({ success: true }), json)
    .persist();

  fetchMock
    .get("https://translation.googleapis.com")
    .intercept({ path: /^\/language\/translate\/v2/, method: "GET" })
    .reply(
      403,
      () =>
        JSON.stringify({
          error: {
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "API_KEY_SERVICE_BLOCKED",
                metadata: { consumer: `projects/${scenarioProject}`, service: "translate.googleapis.com" },
              },
            ],
          },
        }),
      json
    )
    .persist();

  fetchMock
    .get("https://generativelanguage.googleapis.com")
    .intercept({ path: /:generateContent$/, method: "POST" })
    .reply(() => ({
      statusCode: proofOfLifeStatus,
      data: proofOfLifeStatus === 200 ? "{}" : JSON.stringify({ error: { message: "API key not valid" } }),
      responseOptions: json,
    }))
    .persist();
});

const googleKey = () => `AIza${crypto.randomUUID().replace(/-/g, "")}abc`;

function fakePool() {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async () => Response.json({ ok: true }),
      reconcile: async () => 0,
    }),
  };
}

function fakeLimiter() {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async () => new Response(null, { status: 200 }),
    }),
  };
}

async function submitAs(user: { id: string }, body: Record<string, unknown>): Promise<Response> {
  const { cookie, csrfToken } = await createSession(user);
  const workerEnv = {
    ...env,
    TENANT_QUOTA: undefined,
    KEY_POOL: fakePool(),
    POOL_COORDINATOR: undefined,
    RATE_LIMITER: fakeLimiter(),
  } as unknown as WorkerEnv;

  return defaultMainWorker.fetch(
    new Request("https://console.test/api/keys", {
      method: "POST",
      headers: {
        cookie,
        "x-kc-csrf": csrfToken,
        "x-turnstile-token": "tok",
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.50",
        "user-agent": "submit-test/1.0",
      },
      body: JSON.stringify(body),
    }),
    workerEnv
  );
}

describe("WP-5.11 T-5.11.2 — Soft delete and 30-minute resubmission window", () => {
  it("soft-deletes key to REVOKED, transitions registry to ROTATING (30 min), preserves vesting on owner resubmission within 30 min, and rejects other tenants with 409", async () => {
    const owner = await createUser({ github: true, eligible: true });
    const otherUser = await createUser({ github: true, eligible: true });
    scenarioProject = `proj-rot-inwin-${Date.now()}`;

    const res1 = await submitAs(owner, {
      provider: "google",
      key: googleKey(),
      k1: true,
      k2: true,
      pool_type: "COMMUNITY",
    });
    expect(res1.status).toBe(201);
    const { id: key1Id } = (await res1.json()) as { id: string };

    // Backdate created_at and vesting_started_at by 15 hours so vesting is established
    const originalVestingStart = Date.now() - 15 * 3_600_000;
    const key1RowBefore = await env.DB.prepare(
      "SELECT provider_project_hash FROM api_keys WHERE id = ?"
    )
      .bind(key1Id)
      .first<{ provider_project_hash: string }>();
    const projectHash = key1RowBefore!.provider_project_hash;

    await env.DB.prepare("UPDATE api_keys SET created_at = ? WHERE id = ?")
      .bind(originalVestingStart, key1Id)
      .run();
    await env.DB.prepare(
      "UPDATE project_hash_registry SET vesting_started_at = ? WHERE project_hash = ?"
    )
      .bind(originalVestingStart, projectHash)
      .run();

    // Soft-delete key1
    const delRes = await handleDeleteKey(`/api/keys/${key1Id}`, env as unknown as WorkerEnv, owner.id);
    expect(delRes.status).toBe(200);

    // Key row still exists in D1 with status = 'REVOKED' and community_routing_status = 'REVOKED'
    const key1AfterDel = await env.DB.prepare(
      "SELECT status, community_routing_status, revoked_at FROM api_keys WHERE id = ?"
    )
      .bind(key1Id)
      .first<{ status: string; community_routing_status: string; revoked_at: number | null }>();
    expect(key1AfterDel).not.toBeNull();
    expect(key1AfterDel!.status).toBe("REVOKED");
    expect(key1AfterDel!.community_routing_status).toBe("REVOKED");
    expect(typeof key1AfterDel!.revoked_at).toBe("number");

    // Registry row is ROTATING with rotating_until ~ now + 30 min and vesting_started_at preserved
    const regAfterDel = await env.DB.prepare(
      "SELECT state, rotating_until, vesting_started_at FROM project_hash_registry WHERE project_hash = ?"
    )
      .bind(projectHash)
      .first<{ state: string; rotating_until: number | null; vesting_started_at: number | null }>();
    expect(regAfterDel?.state).toBe("ROTATING");
    expect(regAfterDel?.vesting_started_at).toBe(originalVestingStart);
    expect(Number(regAfterDel?.rotating_until) - Date.now()).toBeGreaterThan(25 * 60 * 1000);
    expect(Number(regAfterDel?.rotating_until) - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000 + 5000);

    // Another tenant attempting to submit a key from the same project during ROTATING gets 409
    const otherRes = await submitAs(otherUser, {
      provider: "google",
      key: googleKey(),
      k1: true,
      k2: true,
      pool_type: "COMMUNITY",
    });
    expect(otherRes.status).toBe(409);

    // Owner resubmitting within 30 min restores registry to ACTIVE and inherits vesting_started_at
    const res2 = await submitAs(owner, {
      provider: "google",
      key: googleKey(),
      k1: true,
      k2: true,
      pool_type: "COMMUNITY",
    });
    expect(res2.status).toBe(201);
    const { id: key2Id } = (await res2.json()) as { id: string };

    const key2Row = await env.DB.prepare(
      "SELECT created_at, community_routing_status FROM api_keys WHERE id = ?"
    )
      .bind(key2Id)
      .first<{ created_at: number; community_routing_status: string }>();
    expect(key2Row?.created_at).toBe(originalVestingStart);

    const regAfterResubmit = await env.DB.prepare(
      "SELECT state, rotating_until, vesting_started_at FROM project_hash_registry WHERE project_hash = ?"
    )
      .bind(projectHash)
      .first<{ state: string; rotating_until: number | null; vesting_started_at: number | null }>();
    expect(regAfterResubmit?.state).toBe("ACTIVE");
    expect(regAfterResubmit?.rotating_until).toBeNull();
    expect(regAfterResubmit?.vesting_started_at).toBe(originalVestingStart);
  });

  it("AC-06: delete, wait 31 min -> resubmission from same project by anyone -> 409 for 14 days, accepted after", async () => {
    const owner = await createUser({ github: true, eligible: true });
    const otherUser = await createUser({ github: true, eligible: true });
    scenarioProject = `proj-ac06-${Date.now()}`;

    const res1 = await submitAs(owner, {
      provider: "google",
      key: googleKey(),
      k1: true,
      k2: true,
      pool_type: "COMMUNITY",
    });
    expect(res1.status).toBe(201);
    const { id: key1Id } = (await res1.json()) as { id: string };

    const key1Row = await env.DB.prepare(
      "SELECT provider_project_hash FROM api_keys WHERE id = ?"
    )
      .bind(key1Id)
      .first<{ provider_project_hash: string }>();
    const projectHash = key1Row!.provider_project_hash;

    const delRes = await handleDeleteKey(`/api/keys/${key1Id}`, env as unknown as WorkerEnv, owner.id);
    expect(delRes.status).toBe(200);

    // Simulate 31 minutes elapsed since delete (so rotating_until was 1 minute ago)
    const now = Date.now();
    const expiredRotatingUntil = now - 60_000;
    await env.DB.prepare(
      "UPDATE project_hash_registry SET rotating_until = ? WHERE project_hash = ?"
    )
      .bind(expiredRotatingUntil, projectHash)
      .run();

    // Resubmission at +31 min by owner -> 409 (and transitions registry to TOMBSTONED for 14d)
    const ownerLateRes = await submitAs(owner, {
      provider: "google",
      key: googleKey(),
      k1: true,
      k2: true,
      pool_type: "COMMUNITY",
    });
    expect(ownerLateRes.status).toBe(409);

    // Resubmission at +31 min by another user -> 409
    const otherLateRes = await submitAs(otherUser, {
      provider: "google",
      key: googleKey(),
      k1: true,
      k2: true,
      pool_type: "COMMUNITY",
    });
    expect(otherLateRes.status).toBe(409);

    // Verify registry is now TOMBSTONED with tombstone_until = rotating_until + 14d
    const regTombstoned = await env.DB.prepare(
      "SELECT state, tombstone_until FROM project_hash_registry WHERE project_hash = ?"
    )
      .bind(projectHash)
      .first<{ state: string; tombstone_until: number }>();
    expect(regTombstoned?.state).toBe("TOMBSTONED");
    expect(regTombstoned?.tombstone_until).toBe(expiredRotatingUntil + 14 * 86_400_000);

    // Simulate 14 days + 1 minute elapsed -> accepted again!
    await env.DB.prepare(
      "UPDATE project_hash_registry SET tombstone_until = ? WHERE project_hash = ?"
    )
      .bind(now - 60_000, projectHash)
      .run();

    const acceptedAfter14d = await submitAs(otherUser, {
      provider: "google",
      key: googleKey(),
      k1: true,
      k2: true,
      pool_type: "COMMUNITY",
    });
    expect(acceptedAfter14d.status).toBe(201);
  });
});

describe("WP-5.11 T-5.11.3 — Tombstone lifecycle and project-preserving key rotation", () => {
  it("POST /api/keys/:id/rotate rejects key from another project with 409 project_mismatch and succeeds on same project preserving vesting", async () => {
    proofOfLifeStatus = 200;
    const owner = await createUser({ github: true, eligible: true });
    const projectA = `proj-rot-same-${Date.now()}`;
    const projectB = `proj-rot-diff-${Date.now()}`;
    scenarioProject = projectA;

    const initialKey = googleKey();
    const res1 = await submitAs(owner, {
      provider: "google",
      key: initialKey,
      k1: true,
      k2: true,
      pool_type: "COMMUNITY",
    });
    expect(res1.status).toBe(201);
    const { id: keyId } = (await res1.json()) as { id: string };

    const originalVesting = Date.now() - 20 * 3_600_000;
    await env.DB.prepare("UPDATE api_keys SET created_at = ? WHERE id = ?")
      .bind(originalVesting, keyId)
      .run();

    const beforeRow = await env.DB.prepare(
      "SELECT key_hash, key_prefix, key_suffix, created_at, provider_project_hash FROM api_keys WHERE id = ?"
    )
      .bind(keyId)
      .first<{
        key_hash: string;
        key_prefix: string;
        key_suffix: string;
        created_at: number;
        provider_project_hash: string;
      }>();

    // 1. Rotate with a key from another GCP project -> 409 project_mismatch
    scenarioProject = projectB;
    const wrongProjectKey = googleKey();
    const masterKey =
      (env as unknown as { KC_MASTER_KEY?: string }).KC_MASTER_KEY ||
      "test-master-key-please-rotate";

    const mismatchRes = await handleRotateKeySecret(
      `/api/keys/${keyId}/rotate`,
      new Request(`https://console.test/api/keys/${keyId}/rotate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ new_key: wrongProjectKey }),
      }),
      env as unknown as WorkerEnv,
      owner.id,
      masterKey
    );
    expect(mismatchRes.status).toBe(409);
    const mismatchBody = (await mismatchRes.json()) as { error: string };
    expect(mismatchBody.error).toBe("project_mismatch");

    // Verify original key hash and prefix are untouched
    const afterMismatchRow = await env.DB.prepare(
      "SELECT key_hash, key_prefix FROM api_keys WHERE id = ?"
    )
      .bind(keyId)
      .first<{ key_hash: string; key_prefix: string }>();
    expect(afterMismatchRow?.key_hash).toBe(beforeRow?.key_hash);
    expect(afterMismatchRow?.key_prefix).toBe(beforeRow?.key_prefix);

    // 2. Rotate with a key from the same GCP project -> 200, updates key_hash & prefix/suffix, preserves created_at
    scenarioProject = projectA;
    const sameProjectNewKey = googleKey();
    const okRes = await handleRotateKeySecret(
      `/api/keys/${keyId}/rotate`,
      new Request(`https://console.test/api/keys/${keyId}/rotate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ new_key: sameProjectNewKey }),
      }),
      env as unknown as WorkerEnv,
      owner.id,
      masterKey
    );
    expect(okRes.status).toBe(200);

    const afterOkRow = await env.DB.prepare(
      "SELECT key_hash, key_prefix, key_suffix, created_at, provider_project_hash FROM api_keys WHERE id = ?"
    )
      .bind(keyId)
      .first<{
        key_hash: string;
        key_prefix: string;
        key_suffix: string;
        created_at: number;
        provider_project_hash: string;
      }>();
    expect(afterOkRow?.key_hash).not.toBe(beforeRow?.key_hash);
    expect(afterOkRow?.key_prefix).toBe(sameProjectNewKey.slice(0, 8));
    expect(afterOkRow?.key_suffix).toBe(sameProjectNewKey.slice(-4));
    expect(afterOkRow?.created_at).toBe(originalVesting);
    expect(afterOkRow?.provider_project_hash).toBe(beforeRow?.provider_project_hash);
  });

  it("Coordinator alarm transitions expired ROTATING rows into TOMBSTONED, and repeated 401 after canary transitions directly to TOMBSTONED", async () => {
    proofOfLifeStatus = 200;
    const owner = await createUser({ github: true, eligible: true });
    scenarioProject = `proj-alarm-tomb-${Date.now()}`;

    const res1 = await submitAs(owner, {
      provider: "google",
      key: googleKey(),
      k1: true,
      k2: true,
      pool_type: "COMMUNITY",
    });
    expect(res1.status).toBe(201);
    const { id: key1Id } = (await res1.json()) as { id: string };

    const key1Row = await env.DB.prepare(
      "SELECT provider_project_hash FROM api_keys WHERE id = ?"
    )
      .bind(key1Id)
      .first<{ provider_project_hash: string }>();
    const projectHash1 = key1Row!.provider_project_hash;

    await handleDeleteKey(`/api/keys/${key1Id}`, env as unknown as WorkerEnv, owner.id);

    const futureNow = Date.UTC(2030, 8, 1, 12, 0, 0);
    const expiredRotatingUntil = futureNow - 120_000;
    await env.DB.prepare(
      "UPDATE project_hash_registry SET rotating_until = ? WHERE project_hash = ?"
    )
      .bind(expiredRotatingUntil, projectHash1)
      .run();

    const coordStub = env.POOL_COORDINATOR.get(
      env.POOL_COORDINATOR.idFromName("pool:google")
    );
    await runInDurableObject(coordStub, async (coord: PoolCoordinatorDO) => {
      coord.setClockForTest(futureNow);
      await coord.alarm();
    });

    const regAfterAlarm = await env.DB.prepare(
      "SELECT state, tombstone_until FROM project_hash_registry WHERE project_hash = ?"
    )
      .bind(projectHash1)
      .first<{ state: string; tombstone_until: number }>();
    expect(regAfterAlarm?.state).toBe("TOMBSTONED");
    expect(regAfterAlarm?.tombstone_until).toBe(expiredRotatingUntil + 14 * 86_400_000);

    // Part 2: Upstream permanent revocation (repeated 401 after canary) -> TOMBSTONED directly
    scenarioProject = `proj-canary-tomb-${Date.now()}`;
    const res2 = await submitAs(owner, {
      provider: "google",
      key: googleKey(),
      k1: true,
      k2: true,
      pool_type: "COMMUNITY",
    });
    expect(res2.status).toBe(201);
    const { id: key2Id } = (await res2.json()) as { id: string };

    const key2Row = await env.DB.prepare(
      "SELECT provider_project_hash FROM api_keys WHERE id = ?"
    )
      .bind(key2Id)
      .first<{ provider_project_hash: string }>();
    const projectHash2 = key2Row!.provider_project_hash;

    // Upstream returns 401 on canary probes
    proofOfLifeStatus = 401;
    const keyPoolStub = env.KEY_POOL.get(env.KEY_POOL.idFromName(owner.id));
    await runInDurableObject(keyPoolStub, async (poolDo: KeyPoolDO) => {
      poolDo.setClockForTest(Date.UTC(2030, 8, 2, 0, 1, 0));
      await poolDo.reconcile(owner.id);
      // First canary 401 -> QUARANTINED
      await poolDo.alarm();

      // Next day canary 401 (repeated 401 after canary) -> TOMBSTONED directly
      poolDo.setClockForTest(Date.UTC(2030, 8, 3, 0, 1, 0));
      await poolDo.alarm();
    });
    proofOfLifeStatus = 200;

    const regAfterCanary = await env.DB.prepare(
      "SELECT state, tombstone_until FROM project_hash_registry WHERE project_hash = ?"
    )
      .bind(projectHash2)
      .first<{ state: string; tombstone_until: number }>();
    expect(regAfterCanary?.state).toBe("TOMBSTONED");
    expect(regAfterCanary?.tombstone_until).toBe(
      Date.UTC(2030, 8, 3, 0, 1, 0) + 14 * 86_400_000
    );
  });
});

