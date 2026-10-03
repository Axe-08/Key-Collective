/**
 * WP-F.10 T-F.10.12 (AU-02): GET /api/keys reports degraded sources instead of
 * swallowing them. The body stays a plain array, so the degraded sources go in
 * the `x-kc-degraded` header.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { handleGetKeys } from "../../../src/worker/router/dashboard/keys/get_keys";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { addProviderKey, createUser } from "../../helpers/world";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/keys degraded state (AU-02)", () => {
  it("lists the keys, sets x-kc-degraded and logs when coordinator counters cannot be read", async () => {
    const owner = await createUser({ github: true, eligible: true });
    const key = await addProviderKey(owner, { provider: "groq", plaintext: `gsk_${crypto.randomUUID()}` });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failingEnv = {
      ...(env as unknown as WorkerEnv),
      POOL_COORDINATOR: {
        idFromName: (name: string) => name,
        get: () => ({
          getKeysCounterMap: async (): Promise<never> => {
            throw new Error("shard unreachable");
          },
        }),
      },
    } as unknown as WorkerEnv;

    const res = await handleGetKeys(failingEnv, owner.id);
    const lines = warnSpy.mock.calls.map((c) => String(c[0]));

    expect(res.status).toBe(200);
    expect(res.headers.get("x-kc-degraded")).toBe("coordinator:google,coordinator:groq");
    const body = (await res.json()) as Array<{ id: string; dispatches_today: number }>;
    expect(body.map((k) => k.id)).toEqual([key.id]);
    expect(lines.some((l) => l.includes("key_counters_read_failed"))).toBe(true);
  });

  it("logs a failed role lookup and falls back to the caller's own keys", async () => {
    const owner = await createUser({ github: true, eligible: true });
    const key = await addProviderKey(owner, { provider: "groq", plaintext: `gsk_${crypto.randomUUID()}` });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await env.DB.prepare("ALTER TABLE users RENAME TO users_x").run();
    let res: Response;
    try {
      res = await handleGetKeys(env as unknown as WorkerEnv, owner.id);
    } finally {
      await env.DB.prepare("ALTER TABLE users_x RENAME TO users").run();
    }
    const lines = warnSpy.mock.calls.map((c) => String(c[0]));

    expect(res.status).toBe(200);
    expect(res.headers.get("x-kc-degraded")).toBe("role");
    const body = (await res.json()) as Array<{ id: string; tenant_id?: string }>;
    expect(body.map((k) => k.id)).toEqual([key.id]);
    expect(body[0]).not.toHaveProperty("tenant_id");
    expect(lines.some((l) => l.includes("key_list_role_lookup_failed"))).toBe(true);
  });
});
