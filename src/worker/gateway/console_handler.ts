/**
 * @file console_handler.ts
 * Handlers for Developer Console SPA static delivery and fallback.
 */

import type { WorkerEnv } from "../auth_middleware";
import type { HealthResponse, WorkerOptions } from "./types";
import { applyCors } from "./subdomain";

/**
 * Handles static asset delivery and SPA fallback on console.*.
 */
export async function handleConsoleRequest(
  request: Request,
  env: WorkerEnv,
  options: WorkerOptions = {}
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  // Health probe on console
  if (
    method === "GET" &&
    (pathname === "/health" || pathname === "/v1/health")
  ) {
    const payload: HealthResponse = {
      status: "healthy",
      version: "0.2.0",
      runtime: "cloudflare-workers",
      timestamp: new Date().toISOString(),
    };
    const res = Response.json(payload, { status: 200 });
    return options.cors !== false ? applyCors(res) : res;
  }

  // Static Assets & Dashboard SPA Serving (when ASSETS binding is present)
  if (env.ASSETS && (method === "GET" || method === "HEAD")) {
    if (
      pathname.startsWith("/assets/") ||
      pathname === "/favicon.ico" ||
      pathname === "/favicon.svg" ||
      /\.[a-zA-Z0-9]+$/.test(pathname)
    ) {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status !== 404) {
        return assetRes;
      }
    }

    // SPA navigation fallback
    const indexUrl = new URL("/", request.url);
    let res = await env.ASSETS.fetch(new Request(indexUrl.toString(), request));

    // Force no-cache on HTML navigation so edge and browsers always get latest asset bundles
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");

    const queryToken = url.searchParams.get("token") || url.searchParams.get("admin_token");
    if (queryToken) {
      headers.append(
        "Set-Cookie",
        `kc_auth_token=${encodeURIComponent(queryToken)}; Path=/; SameSite=Lax; Secure`
      );
    }
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }

  // Default SPA HTML delivery when ASSETS binding is absent
  if (method === "GET" || method === "HEAD") {
    const res = new Response(
      "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"/><title>Key Collective Console</title></head><body><div id=\"app\"></div></body></html>",
      {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      }
    );
    return options.cors !== false ? applyCors(res) : res;
  }

  return new Response("Method Not Allowed", { status: 405 });
}
