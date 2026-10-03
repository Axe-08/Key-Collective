/**
 * Key Collective v2/v4 — Developer Dashboard Abuse Reporting
 *
 * Conforms to:
 * - docs/REMEDIATION_PLAN.md (WP-0.4: Lock down abuse takedown and key listing)
 * - PRD FR-11: Exact-hash-only takedown route, constant-time response, Turnstile gated,
 *   rate limited 5/IP/hour via RATE_LIMITER DO.
 */

import { ApiKeyRepository } from "../../../storage/repositories/api_keys/repository";
import { verifyTurnstileToken } from "../../../auth/sybil/index";
import type { WorkerEnv } from "../../auth/index";
import { RouterError } from "../errors";
import type { DurableObjectNamespaceLike } from "../types";

const RESPONSE_PAD_MS = 200;
const RATE_LIMIT_PER_IP_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 3_600_000;
const TOMBSTONE_MS = 14 * 24 * 60 * 60 * 1000;

async function padTo200Ms(startMs: number): Promise<void> {
  const elapsed = Date.now() - startMs;
  const remaining = RESPONSE_PAD_MS - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

export async function handleReportKeyAbuse(
  request: Request,
  env: WorkerEnv
): Promise<Response> {
  const startMs = Date.now();

  const ip = request.headers.get("cf-connecting-ip") || "unknown";

  // Rate limit: 5 reports per IP per hour via a dedicated sliding-window DO.
  const rateLimiterNamespace = env.RATE_LIMITER as unknown as
    | DurableObjectNamespaceLike
    | undefined;
  if (rateLimiterNamespace && typeof rateLimiterNamespace.idFromName === "function") {
    const doId = rateLimiterNamespace.idFromName(`abuse:${ip}`);
    const stub = rateLimiterNamespace.get(doId);
    const limitRes = await stub.fetch("http://rate-limiter/check-limit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        limit: RATE_LIMIT_PER_IP_PER_HOUR,
        windowMs: RATE_LIMIT_WINDOW_MS,
      }),
    });
    await limitRes.text().catch(() => {});

    if (limitRes.status === 429) {
      await padTo200Ms(startMs);
      return Response.json(
        { error: "Too many reports. Please try again later." },
        { status: 429 }
      );
    }
  }

  let body: {
    leaked_key?: string;
    leakedKey?: string;
    turnstile_token?: string;
    turnstileToken?: string;
  } = {};

  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!body || typeof body !== "object") {
    body = {};
  }

  const turnstileToken =
    request.headers.get("x-turnstile-token") ||
    body.turnstile_token ||
    body.turnstileToken ||
    "";
  const turnstileSecret = env.TURNSTILE_SECRET as string | undefined;

  // Always verify Turnstile — no bypass when the secret/token is absent.
  const tsResult = await verifyTurnstileToken(turnstileToken, {
    secretKey: turnstileSecret,
    remoteIp: ip !== "unknown" ? ip : undefined,
  });
  if (!tsResult.success) {
    throw new RouterError("Turnstile validation failed", { statusCode: 403, code: "turnstile_failed" });
  }

  const rawKey = (body.leaked_key || body.leakedKey || "").trim();

  const revokePromise = async (): Promise<void> => {
    if (!rawKey || !env.DB || typeof env.DB.prepare !== "function") {
      return;
    }

    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawKey)
    );
    const keyHashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const revoked = await new ApiKeyRepository(env.DB).revokeByHash(keyHashHex, Date.now());

    if (!revoked) {
      return;
    }

    if (revoked.provider_project_hash) {
      await env.DB.prepare(
        `UPDATE project_hash_registry SET state = 'TOMBSTONED', tombstone_until = ? WHERE project_hash = ?`
      )
        .bind(Date.now() + TOMBSTONE_MS, revoked.provider_project_hash)
        .run();
    }

    try {
      const keyPoolNamespace = env.KEY_POOL as unknown as
        | {
            idFromName?: (name: string) => DurableObjectId;
            get?: (id: DurableObjectId) => {
              reconcile?: (tenantId?: string) => Promise<unknown>;
              removeKey?: (keyId: string) => Promise<void>;
              fetch: (req: Request | string, init?: RequestInit) => Promise<Response>;
            };
          }
        | undefined;
      if (keyPoolNamespace && typeof keyPoolNamespace.idFromName === "function" && typeof keyPoolNamespace.get === "function") {
        const doId = keyPoolNamespace.idFromName(revoked.tenant_id);
        const stub = keyPoolNamespace.get(doId);
        if (typeof stub.reconcile === "function") {
          await stub.reconcile(revoked.tenant_id);
        } else {
          const res = await stub.fetch(`http://key-pool/keys/${encodeURIComponent(revoked.id)}`, {
            method: "DELETE",
            headers: { "x-tenant-id": revoked.tenant_id },
          });
          await res.text().catch(() => {});
        }
      }
    } catch (err) {
      void err;
    }

    try {
      const coordNs = env.POOL_COORDINATOR as
        | {
            idFromName?: (name: string) => DurableObjectId;
            get?: (id: DurableObjectId) => { removeKey?: (keyId: string) => Promise<boolean> };
          }
        | undefined;
      if (coordNs && typeof coordNs.idFromName === "function" && typeof coordNs.get === "function") {
        const shard = revoked.provider?.toLowerCase() === "gemini" ? "google" : (revoked.provider?.toLowerCase() || "google");
        const coordStub = coordNs.get(coordNs.idFromName(`pool:${shard}`));
        if (typeof coordStub.removeKey === "function") {
          await coordStub.removeKey(revoked.id);
        }
      }
    } catch (err) {
      void err;
    }

    if (revoked && env.DB) {
      const notifId = "notif_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      await env.DB
        .prepare(
          "INSERT INTO notifications (id, tenant_id, type, key_id, message, created_at, read_at) VALUES (?, ?, 'abuse_takedown', ?, 'Your key was revoked after an abuse report', ?, NULL)"
        )
        .bind(notifId, revoked.tenant_id, revoked.id, Date.now())
        .run()
        .catch(() => {});
    }
  };

  await revokePromise();
  await padTo200Ms(startMs);

  return Response.json(
    { message: "Report received. Thank you for keeping the commons safe." },
    { status: 200 }
  );
}
