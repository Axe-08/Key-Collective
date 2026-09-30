/**
 * Key Collective — Deterministic Clock Abstraction (T-1.1.1)
 *
 * Verifies:
 * 1. A DO in the test environment reports the time set by `setClockForTest`.
 * 2. `setClockForTest` throws when `KC_ENV` is not `"test"`.
 * 3. `advance()` fires a DO alarm scheduled for the new time, and the alarm
 *    handler observably used the injected clock (not the real wall clock)
 *    when rescheduling its next alarm.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { advance } from "../helpers/clock";
import { KeyPoolDO } from "../../src/durable_objects/key_pool/key_pool_do";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    KEY_POOL: DurableObjectNamespace;
  }
}

describe("Deterministic Clock (KeyPoolDO representative)", () => {
  it("reports the time set by setClockForTest in the test environment", async () => {
    const id = env.KEY_POOL.idFromName("clock-test-tenant-a");
    const stub = env.KEY_POOL.get(id);

    const fixedMs = 1_700_000_000_000;
    const setRes = await stub.fetch("https://do.test/__test__/clock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ms: fixedMs }),
    });
    expect(setRes.status).toBe(200);
    const setBody = (await setRes.json()) as { now: number };
    expect(setBody.now).toBe(fixedMs);

    // A subsequent, independent read confirms the clock stuck.
    const getRes = await stub.fetch("https://do.test/__test__/clock");
    const getBody = (await getRes.json()) as { now: number };
    expect(getBody.now).toBe(fixedMs);
  });

  it("throws when KC_ENV is not 'test'", () => {
    const fakeCtx = {
      id: { toString: () => "non-test-tenant", name: "non-test-tenant" },
      storage: {
        get: async () => undefined,
        put: async () => {},
        getAlarm: async () => null,
        setAlarm: async () => {},
      },
      waitUntil: () => {},
    };

    // No KC_ENV set on env at all (production-shaped env).
    const doInstance = new KeyPoolDO(fakeCtx as any, {});
    expect(() => doInstance.setClockForTest(123)).toThrow(
      /setClockForTest is only available when KC_ENV=test/
    );

    // Explicitly non-"test" KC_ENV also throws.
    const doInstance2 = new KeyPoolDO(fakeCtx as any, { KC_ENV: "production" });
    expect(() => doInstance2.setClockForTest(123)).toThrow(
      /setClockForTest is only available when KC_ENV=test/
    );
  });

  it("advance() fires a DO alarm scheduled for the new time", async () => {
    const id = env.KEY_POOL.idFromName("clock-test-tenant-b");
    const stub = env.KEY_POOL.get(id);

    // Ensure the DO instance exists and its constructor's async alarm
    // bootstrap has settled before we drive it deterministically. The
    // response body must be consumed, or isolated storage teardown for
    // this test file fails (see Cloudflare vitest-pool-workers known
    // issues: "Consume response bodies").
    const settleRes = await stub.fetch("https://do.test/__test__/clock");
    await settleRes.text();

    const fixedMs = Date.UTC(2030, 0, 15, 10, 0, 0); // 2030-01-15T10:00:00Z
    await advance(stub, fixedMs);

    // The alarm handler recomputes "tomorrow" (next UTC midnight) from the
    // clock it was given. If it had used the real wall clock instead of the
    // injected one, this would not match the 2030-01-16 boundary.
    const expectedNextAlarm = Date.UTC(2030, 0, 16, 0, 0, 0);

    const statusRes = await stub.fetch("https://do.test/__test__/clock");
    const statusBody = (await statusRes.json()) as { now: number; alarm: number | null };

    expect(statusBody.alarm).toBe(expectedNextAlarm);
  });
});
