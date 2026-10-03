/**
 * Key Collective — TenantQuotaDO native RPC in the real Workers runtime
 *
 * Regression for the dev-deploy finding of 2026-09-30: TenantQuotaDO extended a local look-alike
 * `DurableObject` class instead of the runtime's, so `stub.consumeQuota(...)` threw
 * "The receiving Durable Object does not support RPC" and every authenticated /v1 request
 * returned 500. Earlier suites used mock stubs or a pre-authenticated context, so none of them
 * reached the real binding.
 *
 * Invariants Tested:
 * 1. The real TENANT_QUOTA binding answers consumeQuota over native RPC.
 * 2. An authenticated request travels through the real auth middleware and quota DO:
 *    GET /v1/keys (removed by N-01) returns 404, not 500.
 * 3. An unknown internal error never exposes runtime text to the client.
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { defaultMainWorker } from "../../../src/worker/index";
import type { WorkerEnv } from "../../../src/worker/auth/index";
import { formatRouterError } from "../../../src/worker/router/errors";
import { createApiKey, createUser } from "../../helpers/world";

interface ConsumeResult {
  allowed: boolean;
}

interface QuotaStub {
  consumeQuota(req: { tenantId: string; costCu: bigint; count: number }): Promise<ConsumeResult>;
}

describe("TenantQuotaDO over native RPC", () => {
  it("answers consumeQuota through the real TENANT_QUOTA binding", async () => {
    const ns = (env as unknown as { TENANT_QUOTA: DurableObjectNamespace }).TENANT_QUOTA;
    const stub = ns.get(ns.idFromName("usr_goog_rpc_probe")) as unknown as QuotaStub;

    const result = await stub.consumeQuota({ tenantId: "usr_goog_rpc_probe", costCu: 0n, count: 1 });

    expect(result.allowed).toBe(true);
  });

  it("serves an authenticated request through the real middleware: GET /v1/keys is 404, not 500", async () => {
    const user = await createUser({ tier: "builder" });
    const token = await createApiKey(user);

    const res = await defaultMainWorker.fetch(
      new Request("https://api.test/v1/keys", { headers: { authorization: `Bearer ${token}` } }),
      env as unknown as WorkerEnv
    );

    expect(res.status).toBe(404);
  });

  it("never sends the text of an unknown internal error to the client", async () => {
    const res = formatRouterError(
      new Error("The receiving Durable Object does not support RPC, because its class was not declared")
    );
    const body = (await res.json()) as { error: { message: string } };

    expect(res.status).toBe(500);
    expect(body.error.message).not.toContain("Durable Object");
    expect(body.error.message).toBe("Internal error");
  });
});
