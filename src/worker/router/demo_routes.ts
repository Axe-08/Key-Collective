/**
 * Key Collective — Ephemeral Demo Token Endpoint
 * POST /v1/demo/token -> delegates to DEMO_POOL DemoDO
 */

import type { WorkerEnv } from "../auth/types";

export async function handleDemoTokenRequest(
  request: Request,
  env: WorkerEnv
): Promise<Response> {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    "0.0.0.0";

  const demoPool = (env as unknown as { DEMO_POOL?: DurableObjectNamespace }).DEMO_POOL;

  if (!demoPool || typeof demoPool.idFromName !== "function") {
    return Response.json(
      { error: "Demo pool unavailable", code: "NO_DEMO_POOL" },
      {
        status: 503,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json; charset=utf-8",
        },
      }
    );
  }

  try {
    const doId = demoPool.idFromName("global_demo_pool");
    const stub = demoPool.get(doId);

    const res = await stub.fetch("http://demo-pool/token", {
      method: "POST",
      headers: {
        "cf-connecting-ip": ip,
        "Content-Type": "application/json",
      },
    });

    const body = await res.json();
    return Response.json(body, {
      status: res.status,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json; charset=utf-8",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "Failed to allocate demo token", details: message },
      {
        status: 500,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json; charset=utf-8",
        },
      }
    );
  }
}
