/**
 * @file types.ts
 * Types and constants for edge worker gateway and subdomain routing.
 */

import type { ExecutionContextLike, TelemetryEmitter } from "../telemetry_emitter";
import type { AuthMiddleware, WorkerEnv } from "../auth_middleware";
import type { RouterHandler, RouterHandlerOptions } from "../router_handler";
import type { EdgeSubdomain, HostRouteDecision } from "../../contracts/v3_5_types";

/**
 * Health response payload format.
 */
export interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  runtime: "cloudflare-workers";
  timestamp: string;
}

/**
 * Standard CORS headers applied to API Gateway responses.
 */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers":
    "Content-Type, Authorization, x-tenant-id, x-kc-trace-id, x-trace-id",
  "access-control-max-age": "86400",
};

/**
 * Options for configuring MainWorker.
 */
export interface WorkerOptions extends RouterHandlerOptions {
  /** Injected RouterHandler instance */
  routerHandler?: RouterHandler;
  /** Injected AuthMiddleware instance */
  authMiddleware?: AuthMiddleware;
  /** Injected TelemetryEmitter instance */
  telemetryEmitter?: TelemetryEmitter;
  /** Whether to automatically attach CORS headers to responses (default: true) */
  cors?: boolean;
  /** Optional custom admin verifier function */
  verifyAdmin?: (
    token: string,
    request: Request,
    env: WorkerEnv
  ) => Promise<boolean> | boolean;
  /** Optional list of tokens considered admin */
  adminTokens?: string[];
  /** Optional custom admin surveillance router handler */
  adminHandler?: (
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ) => Promise<Response>;
}

export type { EdgeSubdomain, HostRouteDecision };
