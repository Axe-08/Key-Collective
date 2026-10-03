/**
 * Key Collective v2/v4 — Developer Dashboard & Console REST API Handler
 */

import type { KeyPoolContract } from "../../../contracts/key_pool";
import type { AuthMiddleware, WorkerEnv } from "../../auth/index";
import type { WorkerEnv as AppWorkerEnv } from "../../auth/types";
import type { ExecutionContextLike } from "../../telemetry_emitter";
import type { RouterHandlerOptions } from "../types";
import { handleReportKeyAbuse } from "./abuse_routes";
import { handleConsent, registrationStatus } from "../../../auth/consent";
import { loadPoolRights } from "../../../auth/rights";
import { getClaimableLegacyAccounts, handleClaimLegacy } from "../../../auth/legacy_claim";
import { handleGoogleAuth, handleLogout } from "./auth_routes";
import { handleGithubLinkCallback, handleGithubLinkStart } from "../../../auth/github/link_flow";
import { SESSION_COOKIE, lookupSession, readCookie, type SessionContext } from "../../../auth/session/store";
import { timingSafeEqualStrings } from "../../../crypto/utils";
import { Logger } from "../../../utils/logger";
import {
  handleDeleteKey,
  handleGetKeys,
  handlePoolMode,
  handlePostKeys,
  handleRotateKeySecret,
  handleTestKey,
} from "./keys/index";
import {
  handleDeleteProject,
  handleGetProjects,
  handlePostProjects,
  handleUpdateProject,
} from "./project_routes";
import {
  handleDeleteToken,
  handleGetTokens,
  handlePostTokens,
  handleRotateToken,
  handlePlaygroundToken,
} from "./token_routes";
import {
  handleGetAnalyticsLedger,
  handleGetAnalyticsMultiplierHistory,
  handleGetAnalyticsUsage,
  handleGetLogs,
  handleGetStats,
} from "./metrics_routes";
import { handlePoolRoute } from "../../pool_routes";
import { handleAdminRequest } from "../../gateway/admin_handler";
import { verifyAdminRequest } from "../../gateway/admin_verifier";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class DashboardRouter {
  constructor(
    private readonly options: RouterHandlerOptions,
    private readonly authMiddleware: AuthMiddleware,
    private readonly getKeyPool: (tenantId: string, env: WorkerEnv) => KeyPoolContract
  ) {}

  public async handle(
    request: Request,
    pathname: string,
    method: string,
    env: WorkerEnv,
    _ctx?: ExecutionContextLike,
    _traceId?: string
  ): Promise<Response> {
    const masterKey =
      this.options.masterKey ??
      (env.KC_MASTER_KEY ? String(env.KC_MASTER_KEY) : undefined);

    let tenantId = "anonymous";

    // 0. GitHub link flow (WP-3.3)
    if (method === "GET" && pathname === "/api/auth/github/start") {
      return handleGithubLinkStart(request, env);
    }
    if (method === "GET" && pathname === "/api/auth/github/callback") {
      return handleGithubLinkCallback(request, env);
    }

    // 0.1 Verified Google Sign-In
    if (method === "POST" && pathname === "/api/auth/google") {
      return handleGoogleAuth(request, env);
    }

    if (method === "POST" && pathname === "/api/auth/consent") {
      return handleConsent(request, env);
    }

    if (method === "POST" && pathname === "/api/auth/logout") {
      return handleLogout(request, env);
    }

    // Public key takedown (QA-16): Turnstile is its only gate. It runs before the session is
    // read, so a signed-in browser is not stopped by the session CSRF check, and the session
    // gives the report no authority.
    if (method === "POST" && pathname === "/api/abuse/report-key") {
      return handleReportKeyAbuse(request, env);
    }

    // 1. Cookie session (console host only; api.* never routes here).
    let session: SessionContext | null = null;
    const sessionToken = readCookie(request, SESSION_COOKIE);
    if (sessionToken && env.DB) {
      session = await lookupSession(env.DB, sessionToken);
    }
    if (session) {
      const csrf = request.headers.get("x-kc-csrf") ?? "";
      if (STATE_CHANGING_METHODS.has(method) && !timingSafeEqualStrings(csrf, session.csrfToken)) {
        return new Response(JSON.stringify({ error: "csrf_required" }), {
          status: 403,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      tenantId = session.userId;
    }

    const isAllowListed =
      (method === "GET" && pathname === "/api/session") ||
      pathname.startsWith("/api/auth/");

    if (tenantId === "anonymous" && !isAllowListed) {
      return new Response(
        JSON.stringify({
          error: {
            message: "Authentication required",
            code: "UNAUTHORIZED",
            statusCode: 401,
          },
        }),
        {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8" },
        }
      );
    }

    // Legacy GitHub-only account claim (WP-3.5): needs a signed-in caller.
    if (method === "POST" && pathname === "/api/auth/claim-legacy") {
      if (tenantId === "anonymous") {
        return Response.json({ error: "session_required" }, { status: 401 });
      }
      return handleClaimLegacy(env, tenantId, masterKey as string | Uint8Array | undefined);
    }

    // Until registration consent (WP-3.2) only the allow-listed routes answer.
    if (!isAllowListed && tenantId !== "anonymous" && env.DB) {
      const status = await registrationStatus(env.DB, tenantId);
      if (status === "PENDING_CONSENT") {
        return new Response(JSON.stringify({ error: "consent_required" }), {
          status: 403,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
    }

    // 0.2 Real-Time Telemetry Stream (SSE)
    if (method === "GET" && (pathname === "/api/telemetry/stream" || pathname === "/v1/telemetry/stream")) {
      const encoder = new TextEncoder();
      let intervalId: ReturnType<typeof setInterval> | null = null;
      const targetTenantId = tenantId;

      const stream = new ReadableStream({
        start(controller) {
          const sendPulse = async () => {
            try {
              let currentRpm = 0;
              let status: "healthy" | "degraded" | "rate_limited" = "healthy";

              // 1. Resolve quotaDO for this tenant if available
              if (env?.TENANT_QUOTA && targetTenantId && targetTenantId !== "anonymous") {
                try {
                  const quotaStub = env.TENANT_QUOTA.get(env.TENANT_QUOTA.idFromName(targetTenantId));
                  const quotaRes = await quotaStub.fetch("http://do/status");
                  if (quotaRes.ok) {
                    const quotaData = await quotaRes.json<{ currentRpm?: number; rpmLimit?: number }>();
                    currentRpm = quotaData.currentRpm ?? 0;
                    if (quotaData.rpmLimit && currentRpm >= quotaData.rpmLimit) {
                      status = "rate_limited";
                    }
                  }
                } catch {
                  // Keep defaults on DO fetch errors
                }
              }

              // 2. Pull avg latency from D1 cost_ledger (last 5 min)
              let avgLatencyMs = 0;
              const db = (env?.DB || env?.D1_DB) as D1Database | undefined;
              if (db && typeof db.prepare === "function") {
                try {
                  const query = targetTenantId && targetTenantId !== "anonymous" && targetTenantId !== "admin"
                    ? "SELECT AVG(latency_ms) as avg_lat FROM cost_ledger WHERE tenant_id = ? AND created_at > datetime('now', '-5 minutes')"
                    : "SELECT AVG(latency_ms) as avg_lat FROM cost_ledger WHERE created_at > datetime('now', '-5 minutes')";
                  const stmt = db.prepare(query);
                  const row = targetTenantId && targetTenantId !== "anonymous" && targetTenantId !== "admin"
                    ? await stmt.bind(targetTenantId).first<{ avg_lat: number | null }>()
                    : await stmt.first<{ avg_lat: number | null }>();
                  avgLatencyMs = Math.round(row?.avg_lat ?? 0);
                } catch {
                  // Keep 0 on query error
                }
              }

              const payload = JSON.stringify({
                timestamp: Date.now(),
                value: avgLatencyMs,
                latency_ms: avgLatencyMs,
                rpm: currentRpm,
                status,
              });
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            } catch {
              if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
              }
            }
          };

          // Send immediate pulse upon connection
          void sendPulse();

          // Stream periodic telemetry updates every 3s
          intervalId = setInterval(() => {
            void sendPulse();
          }, 3000);
        },
        cancel() {
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          "connection": "keep-alive",
          "access-control-allow-origin": "*",
        },
      });
    }

    // 0.3 Session Identity Verification (GET /api/session)
    if (method === "GET" && pathname === "/api/session") {
      let user: {
        id: string;
        email: string;
        tier: string;
        role: string;
        sybil_score?: number;
      } | null = null;

      if (tenantId === "admin") {
        user = {
          id: "admin",
          email: "admin@keycollective.ai",
          tier: "admin",
          role: "admin",
          sybil_score: 100,
        };
      } else if (env.DB && typeof env.DB.prepare === "function" && tenantId && tenantId !== "anonymous") {
        try {
          const userRow = await env.DB.prepare(
            "SELECT id, email, tier, role, sybil_score FROM users WHERE id = ?"
          ).bind(tenantId).first<{
            id: string;
            email: string;
            tier: string;
            role: string;
            sybil_score: number;
          }>();

          if (userRow) {
            user = {
              id: userRow.id,
              email: userRow.email,
              tier: userRow.tier,
              role: userRow.role || (userRow.tier === "admin" ? "admin" : "user"),
              sybil_score: userRow.sybil_score ?? 95,
            };
          }
        } catch (err) {
          new Logger({ traceId: "session-user", tenantId }).warn("Failed to load user row for session", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (!user && tenantId && tenantId !== "anonymous") {
        user = {
          id: tenantId,
          email: `${tenantId}@keycollective.local`,
          tier: tenantId.startsWith("usr_gh_") || tenantId.startsWith("gh_") ? "max" : "builder",
          role: "user",
          sybil_score: 90,
        };
      }

      // D-21: a COMMUNITY key owner without communityPool keeps the key but stops lending it.
      // Shown on every session read until WP-4.3 adds the notifications table.
      const notices: string[] = [];
      let rights: { privatePool: boolean; communityPool: boolean } | undefined;
      let claimable: string[] = [];
      if (user && env.DB && tenantId !== "anonymous") {
        claimable = await getClaimableLegacyAccounts(env.DB, tenantId);
        const { privatePool, communityPool } = await loadPoolRights(env.DB, tenantId);
        rights = { privatePool, communityPool };
        const owned = await env.DB.prepare("SELECT 1 FROM api_keys WHERE tenant_id = ? AND pool_type = 'COMMUNITY' LIMIT 1")
          .bind(tenantId)
          .first();
        if (owned && !communityPool) {
          notices.push("Link GitHub to keep sharing your key with the community pool");
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          user,
          ...(session ? { csrfToken: session.csrfToken } : {}),
          ...(notices.length > 0 ? { notices } : {}),
          ...(rights ? { rights } : {}),
          ...(claimable.length > 0 ? { claimable_legacy_accounts: claimable } : {}),
        }),
        {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        }
      );
    }

    // 0.5 Admin Surveillance APIs (/api/admin/*) on console/dashboard
    if (pathname.startsWith("/api/admin/")) {
      const isAdmin = await verifyAdminRequest(request, env, this.options);
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: { message: "Admin access required", code: "FORBIDDEN", statusCode: 403 } }), {
          status: 403,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      return handleAdminRequest(request, env, this as any, this.options, _ctx);
    }

    // 1. GET /api/keys
    if (method === "GET" && pathname === "/api/keys") {
      return handleGetKeys(env, tenantId);
    }

    // 2. POST /api/keys
    if (method === "POST" && pathname === "/api/keys") {
      return handlePostKeys(request, env, tenantId, masterKey);
    }

    // 3. DELETE /api/keys/:id
    if (method === "DELETE" && pathname.startsWith("/api/keys/")) {
      return handleDeleteKey(pathname, env, tenantId);
    }

    // PATCH /api/keys/:id/pool-mode (Anti-Midnight Freeze FR-22)
    if (method === "PATCH" && /^\/api\/keys\/[^/]+\/pool-mode$/.test(pathname)) {
      return handlePoolMode(pathname, request, env, tenantId);
    }

    // 3.8 POST /api/keys/:id/rotate
    if (method === "POST" && pathname.startsWith("/api/keys/") && pathname.endsWith("/rotate")) {
      return handleRotateKeySecret(pathname, request, env, tenantId, masterKey);
    }

    // 4. POST /api/keys/:id/test
    if (method === "POST" && pathname.startsWith("/api/keys/") && pathname.endsWith("/test")) {
      return handleTestKey(pathname, env, tenantId, masterKey);
    }

    // 4.1 Projects APIs
    if (method === "GET" && (pathname === "/api/projects" || pathname === "/api/projects/")) {
      return handleGetProjects(request, env as unknown as AppWorkerEnv, tenantId);
    }

    if (method === "POST" && (pathname === "/api/projects" || pathname === "/api/projects/")) {
      return handlePostProjects(request, env as unknown as AppWorkerEnv, tenantId);
    }

    if (method === "DELETE" && (pathname === "/api/projects" || pathname.startsWith("/api/projects/"))) {
      return handleDeleteProject(pathname, env as unknown as AppWorkerEnv, tenantId);
    }

    if (method === "PATCH" && (pathname === "/api/projects" || pathname.startsWith("/api/projects/"))) {
      return handleUpdateProject(request, pathname, env as unknown as AppWorkerEnv, tenantId);
    }

    // 4.2 Auth Tokens APIs
    if (method === "GET" && (pathname === "/api/tokens" || pathname === "/api/tokens/")) {
      return handleGetTokens(request, env as unknown as AppWorkerEnv, tenantId);
    }

    if (method === "POST" && pathname === "/api/playground/token") {
      return handlePlaygroundToken(env, tenantId);
    }
    if (method === "POST" && /^\/api\/tokens\/[^/]+\/rotate\/?$/.test(pathname)) {
      return handleRotateToken(pathname, env, tenantId);
    }
    if (method === "POST" && (pathname === "/api/tokens" || pathname === "/api/tokens/")) {
      return handlePostTokens(request, env as unknown as AppWorkerEnv, tenantId);
    }

    if (method === "DELETE" && (pathname === "/api/tokens" || pathname.startsWith("/api/tokens/"))) {
      return handleDeleteToken(pathname, env as unknown as AppWorkerEnv, tenantId);
    }

    // 5. GET /api/logs
    if (method === "GET" && pathname === "/api/logs") {
      return handleGetLogs(env, tenantId, this.getKeyPool);
    }

    // 6. GET /api/stats
    if (method === "GET" && pathname === "/api/stats") {
      return handleGetStats(env, tenantId, this.getKeyPool);
    }

    // 6.5 Analytics Routes (T-6.4.6)
    if (method === "GET" && pathname === "/api/analytics/usage") {
      return handleGetAnalyticsUsage(env, tenantId);
    }
    if (method === "GET" && pathname === "/api/analytics/ledger") {
      return handleGetAnalyticsLedger(request, env, tenantId);
    }
    if (method === "GET" && pathname === "/api/analytics/multiplier-history") {
      return handleGetAnalyticsMultiplierHistory(env, tenantId);
    }

    // 7. Pool Commons & Notifications Routes (/api/pool/*, /api/notifications)
    const poolRes = await handlePoolRoute(pathname, method, request, env, tenantId, _ctx as any);
    if (poolRes) {
      return poolRes;
    }

    return new Response(
      JSON.stringify({
        error: {
          message: `Dashboard API endpoint '${method} ${pathname}' not found`,
          code: "NOT_FOUND",
          statusCode: 404,
        },
      }),
      { status: 404, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}

export { DashboardRouter as DashboardHandler };
