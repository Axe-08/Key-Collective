/**
 * Key Collective — existing COMMUNITY keys of owners without community rights (WP-3.3, D-21)
 *
 * Invariants Tested:
 * 1. A Google-only owner's COMMUNITY key still loads into the owner's own pool.
 * 2. Another tenant's pool never loads it; an eligible owner's COMMUNITY key still lends.
 * 3. GET /api/session tells the Google-only owner to link GitHub; an eligible owner gets no notice.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { KeyPoolDO, type DurableObjectStateLike } from "../../../src/durable_objects/key_pool/key_pool_do";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { addProviderKey, createSession, createUser } from "../../helpers/world";

const LINK_NOTICE = "Link GitHub to keep sharing your key with the community pool";

function poolFor(tenantId: string): KeyPoolDO {
  const store = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => store.get(key),
    put: async (key: string, value: unknown) => void store.set(key, value),
    delete: async (key: string) => store.delete(key),
    deleteAll: async () => store.clear(),
    list: async () => new Map(store),
  };
  const state = { id: { name: tenantId, toString: () => `id-${tenantId}` }, storage, waitUntil: () => {} };
  return new KeyPoolDO(state as unknown as DurableObjectStateLike, { DB: env.DB }, { tenantId });
}

async function communityKey(owner: { id: string }, plaintext: string): Promise<string> {
  const key = await addProviderKey(owner, { provider: "groq", pool: "COMMUNITY", plaintext });
  await env.DB.prepare("UPDATE api_keys SET community_routing_status = 'ACTIVE' WHERE id = ?").bind(key.id).run();
  return key.id;
}

describe("D-21: COMMUNITY keys of owners without communityPool", () => {
  it("serve their owner but are never lent; eligible owners' keys still lend", async () => {
    const googleOnly = await createUser();
    const eligible = await createUser({ github: true, eligible: true });
    const borrower = await createUser({ github: true, eligible: true });
    const stranded = await communityKey(googleOnly, "gsk_stranded_owner_key_0001");
    const shared = await communityKey(eligible, "gsk_eligible_owner_key_0002");

    const ownerKeys = (await poolFor(googleOnly.id).getKeys()).map((k) => k.id);
    const borrowerKeys = (await poolFor(borrower.id).getKeys()).map((k) => k.id);

    expect(ownerKeys).toContain(stranded);
    expect(borrowerKeys).not.toContain(stranded);
    expect(borrowerKeys).toContain(shared);
  });

  it("GET /api/session asks a Google-only COMMUNITY owner to link GitHub", async () => {
    const googleOnly = await createUser();
    const eligible = await createUser({ github: true, eligible: true });
    await communityKey(googleOnly, "gsk_notice_owner_key_0003");
    await communityKey(eligible, "gsk_notice_owner_key_0004");
    const sessionOf = async (user: { id: string }) => {
      const { cookie } = await createSession(user);
      const res = await defaultMainWorker.fetch(
        new Request("https://console.test/api/session", { headers: { cookie } }),
        { ...env, TENANT_QUOTA: undefined, KEY_POOL: undefined } as unknown as WorkerEnv
      );
      return (await res.json()) as { notices?: string[] };
    };

    expect((await sessionOf(googleOnly)).notices).toEqual([LINK_NOTICE]);
    expect((await sessionOf(eligible)).notices ?? []).toEqual([]);
  });
});
