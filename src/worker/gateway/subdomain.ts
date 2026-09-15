/**
 * @file subdomain.ts
 * Subdomain parsing, host route resolution, and CORS utility functions.
 */

import type { EdgeSubdomain, HostRouteDecision } from "../../contracts/v3_5_types";
import { CORS_HEADERS } from "./types";

/**
 * Parses the incoming Host header or URL host to determine the edge routing subdomain.
 *
 * Routing domains:
 * - `api.*` -> LLM Proxy Hot Path Gateway
 * - `console.*` -> Developer Console SPA static delivery
 * - `admin.*` -> Admin surveillance router
 * - Other / apex -> Apex routing
 *
 * @param host The Host header or hostname
 * @returns Parsed EdgeSubdomain (\"api\" | \"console\" | \"admin\" | \"apex\")
 */
export function parseSubdomain(host: string): EdgeSubdomain {
  if (!host) return "apex";
  const normalized = host.split(":")[0].toLowerCase().trim();
  if (normalized.startsWith("api.") || normalized === "api") {
    return "api";
  }
  if (normalized.startsWith("console.") || normalized === "console") {
    return "console";
  }
  if (normalized.startsWith("admin.") || normalized === "admin") {
    return "admin";
  }
  return "apex";
}

/**
 * Resolves the edge routing decision from a Host header string.
 *
 * @param host The Host header or hostname
 * @returns HostRouteDecision contract
 */
export function resolveHostRoute(host: string): HostRouteDecision {
  const subdomain = parseSubdomain(host);
  return {
    host,
    subdomain,
    requiresAdminAuth: subdomain === "admin",
    isApiGateway: subdomain === "api",
    isConsoleSpa: subdomain === "console",
  };
}

/**
 * Injects CORS headers into a Response if they are not already set.
 */
export function applyCors(response: Response): Response {
  if (response.headers.has("access-control-allow-origin")) {
    return response;
  }
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    if (!newHeaders.has(key)) {
      newHeaders.set(key, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
