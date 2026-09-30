/**
 * Test helper: advances a Durable Object's deterministic test clock and
 * fires any scheduled alarm so lease/window/backoff/alarm code paths can
 * be exercised deterministically in tests.
 *
 * Sets the clock via the DO's `/__test__/clock` HTTP RPC route (backed by
 * `setClockForTest`, which throws unless `env.KC_ENV === "test"`), then
 * forces any scheduled alarm to run immediately via `runDurableObjectAlarm`
 * from `cloudflare:test`.
 */

import { runDurableObjectAlarm } from "cloudflare:test";

export async function advance(
  stub: DurableObjectStub,
  ms: number
): Promise<void> {
  const res = await stub.fetch("https://do.test/__test__/clock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ms }),
  });
  // The response body must be consumed, or isolated storage teardown for
  // the test file fails (see Cloudflare vitest-pool-workers known issues:
  // "Consume response bodies").
  await res.text();
  if (!res.ok) {
    throw new Error(`advance(): setClockForTest failed with status ${res.status}`);
  }
  await runDurableObjectAlarm(stub);
}
