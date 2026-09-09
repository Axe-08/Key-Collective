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

export { KeyPoolDO } from "./durable_objects/key_pool_do";

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
