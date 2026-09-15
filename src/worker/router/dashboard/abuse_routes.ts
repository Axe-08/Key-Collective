/**
 * Key Collective v2/v4 — Developer Dashboard Abuse Reporting
 */

import { verifyTurnstileToken } from "../../../auth/sybil";
import type { WorkerEnv } from "../../auth_middleware";
import { RouterError } from "../errors";

export async function handleReportKeyAbuse(
  request: Request,
  env: WorkerEnv
): Promise<Response> {
  const startMs = Date.now();

  const turnstileToken = request.headers.get("x-turnstile-token") || "";
  const turnstileSecret = env.TURNSTILE_SECRET as string | undefined;
  const tsResult = await verifyTurnstileToken(turnstileToken, { secretKey: turnstileSecret });
  if (!tsResult.success) {
    throw new RouterError("Turnstile validation failed", { statusCode: 403 });
  }

  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "unknown";
  const currentHour = Math.floor(Date.now() / (1000 * 60 * 60));

  if (env.DB && typeof env.DB.prepare === "function") {
    const rl = await env.DB.prepare("SELECT count FROM abuse_rate_limits WHERE ip = ? AND window_hour = ?").bind(ip, currentHour).first<{count: number}>();
    if (rl && rl.count >= 5) {
      throw new RouterError("Rate limit exceeded", { statusCode: 429 });
    }
    await env.DB.prepare("INSERT INTO abuse_rate_limits (ip, window_hour, count) VALUES (?, ?, 1) ON CONFLICT(ip, window_hour) DO UPDATE SET count = count + 1").bind(ip, currentHour).run();
  }

  const body = (await request.json()) as { keyId: string };

  const deletePromise = async () => {
    if (body.keyId && env.DB && typeof env.DB.prepare === "function") {
      await env.DB.prepare(
        `UPDATE api_keys SET status = 'invalid', community_routing_status = 'REVOKED' WHERE id = ?`
      ).bind(body.keyId).run();
    }
  };

  await Promise.all([
    deletePromise(),
    new Promise(resolve => setTimeout(resolve, Math.max(0, 200 - (Date.now() - startMs))))
  ]);

  const elapsed = Date.now() - startMs;
  if (elapsed < 200) {
    await new Promise(resolve => setTimeout(resolve, 200 - elapsed));
  }

  return Response.json({ success: true, message: "Report received" }, { status: 200 });
}
