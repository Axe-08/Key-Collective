/**
 * T-F.1.3 (RA-03): lease rights fail closed.
 * A tenant with no `users` row, or an env with no DB binding, gets no private and no community lease.
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { LeaseOrchestrator } from "../../../src/router/leases/orchestrator";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { addProviderKey, createApiKey, createUser } from "../../helpers/world";

async function registerCommunityKey(): Promise<string> {
  const owner = await createUser({ github: true, eligible: true });
  const key = await addProviderKey(owner, {
    provider: "groq",
    pool: "COMMUNITY",
    plaintext: "gsk_rights_fail_closed_" + crypto.randomUUID().replace(/-/g, ""),
    rpmLimit: 100,
    rpdLimit: 1000,
  });
  const coord = env.POOL_COORDINATOR.get(env.POOL_COORDINATOR.idFromName("pool:groq")) as unknown as {
    upsertKey(input: {
      keyId: string;
      owner: string;
      provider: string;
      status: "ACTIVE";
      rpmLimit: number;
      rpdLimit: number;
    }): Promise<{ registered: boolean }>;
  };
  await coord.upsertKey({
    keyId: key.id,
    owner: owner.id,
    provider: "groq",
    status: "ACTIVE",
    rpmLimit: 100,
    rpdLimit: 1000,
  });
  return key.id;
}

describe("lease rights fail closed (T-F.1.3, RA-03)", () => {
  it("an eligible user borrows the community key (control)", async () => {
    const keyId = await registerCommunityKey();
    const borrower = await createUser({ github: true, eligible: true });
    const lease = await new LeaseOrchestrator().acquire("groq", {
      tenantId: borrower.id,
      env: env as unknown as WorkerEnv,
      estimateCu: 1,
    });
    expect(lease?.keyId).toBe(keyId);
  });

  it("a token whose tenant has no users row gets no community lease", async () => {
    await registerCommunityKey();
    const ghost = { id: "usr_goog_ghost" + crypto.randomUUID().replace(/-/g, "").slice(0, 8) };
    await createApiKey(ghost);
    const row = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(ghost.id).first();
    expect(row).toBeNull();

    const lease = await new LeaseOrchestrator().acquire("groq", {
      tenantId: ghost.id,
      env: env as unknown as WorkerEnv,
      estimateCu: 1,
    });
    expect(lease).toBeNull();
  });

  it("no DB binding means no lease", async () => {
    await registerCommunityKey();
    const borrower = await createUser({ github: true, eligible: true });
    const noDb = { ...(env as unknown as WorkerEnv), DB: undefined } as unknown as WorkerEnv;
    const lease = await new LeaseOrchestrator().acquire("groq", {
      tenantId: borrower.id,
      env: noDb,
      estimateCu: 1,
    });
    expect(lease).toBeNull();
  });
});
