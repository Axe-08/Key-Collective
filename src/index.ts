/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Entrypoint: Cloudflare Worker & Durable Object
 */

export interface Env {
  KEY_POOL: DurableObjectNamespace;
  DB: D1Database;
  TELEMETRY: AnalyticsEngineDataset;
}

export interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  runtime: "cloudflare-workers";
  timestamp: string;
}

/**
 * KeyPoolDO — Per-tenant stateful Durable Object
 * Isolates key pool, circuit breaker state, and sliding-window RPM.
 */
export class KeyPoolDO implements DurableObject {
  private ctx: DurableObjectState;
  private env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "healthy", do: true });
    }
    return new Response("Not Found", { status: 404 });
  }
}

/**
 * Cloudflare Worker Default Fetch Handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" || url.pathname === "/v1/health") {
      const payload: HealthResponse = {
        status: "healthy",
        version: "0.2.0",
        runtime: "cloudflare-workers",
        timestamp: new Date().toISOString(),
      };
      return Response.json(payload);
    }

    return new Response("Key Collective v2 Edge Proxy Ready", { status: 200 });
  },
};
