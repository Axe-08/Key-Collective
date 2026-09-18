/**
 * Key Collective v2/v4 — Developer Dashboard Abuse Reporting
 */

import { verifyTurnstileToken } from "../../../auth/sybil/index";
import type { WorkerEnv } from "../../auth/index";
import { RouterError } from "../errors";

export async function handleReportKeyAbuse(
  request: Request,
  env: WorkerEnv
): Promise<Response> {
  const startMs = Date.now();

  let body: {
    keyId?: string;
    key_id?: string;
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

  if (turnstileToken || turnstileSecret) {
    const tsResult = await verifyTurnstileToken(turnstileToken, { secretKey: turnstileSecret });
    if (!tsResult.success) {
      throw new RouterError("Turnstile validation failed", { statusCode: 403 });
    }
  }

  const rawKey = (body.leaked_key || body.leakedKey || "").trim();
  const keyId = (body.keyId || body.key_id || "").trim();

  let keyHashHex: string | null = null;
  let keyPrefix: string | null = null;

  if (rawKey) {
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawKey)
    );
    keyHashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    keyPrefix = rawKey.slice(0, 8);
  }

  const deletePromise = async (): Promise<void> => {
    if (!env.DB || typeof env.DB.prepare !== "function") {
      return;
    }

    if (keyId) {
      await env.DB.prepare(
        `UPDATE api_keys SET status = 'invalid', community_routing_status = 'REVOKED' WHERE id = ?`
      ).bind(keyId).run();
    }

    if (keyPrefix && rawKey) {
      const prefix6 = rawKey.slice(0, 6);
      await env.DB.prepare(
        `UPDATE api_keys SET status = 'invalid', community_routing_status = 'REVOKED' WHERE key_prefix = ? OR key_prefix = ?`
      ).bind(keyPrefix, prefix6).run();
    }

    if (keyHashHex) {
      try {
        await env.DB.prepare(
          `UPDATE api_keys SET status = 'invalid', community_routing_status = 'REVOKED' WHERE key_hash = ?`
        ).bind(keyHashHex).run();
      } catch {
        // key_hash column might not exist in all schemas
      }

      try {
        await env.DB.prepare(
          `UPDATE api_keys SET status = 'invalid', community_routing_status = 'REVOKED' WHERE provider_project_hash = ?`
        ).bind(keyHashHex).run();
      } catch {
        // provider_project_hash column might not exist in all schemas
      }

      try {
        await env.DB.prepare(
          `UPDATE project_hash_registry SET state = 'TOMBSTONED', tombstone_until = ? WHERE project_hash = ?`
        ).bind(Date.now() + 365 * 24 * 60 * 60 * 1000, keyHashHex).run();
      } catch {
        // project_hash_registry table might not exist
      }
    }
  };

  await Promise.all([
    deletePromise(),
    new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 200 - (Date.now() - startMs)))
    ),
  ]);

  const elapsed = Date.now() - startMs;
  if (elapsed < 200) {
    await new Promise((resolve) => setTimeout(resolve, 200 - elapsed));
  }

  return Response.json(
    { success: true, message: "Report received" },
    { status: 200 }
  );
}
