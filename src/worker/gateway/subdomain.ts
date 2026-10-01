/**
 * @file subdomain.ts
 * Subdomain parsing, host route resolution, and CORS utility functions.
 */

import type { EdgeSubdomain, HostRouteDecision } from "../../contracts/v3_5_types";
import type { WorkerEnv } from "../auth/index";
import { CORS_HEADERS } from "./types";

export type EdgeHost = "api" | "console" | "admin" | "apex" | "unknown";

/**
 * Resolves the edge host classification from the Host header against Worker environment variables.
 * Performs exact, port-stripped, lower-cased comparison against:
 * env.API_HOST, env.CONSOLE_HOST, env.ADMIN_HOST, env.APEX_HOST.
 */
export function resolveHost(hostHeader: string, env?: WorkerEnv): EdgeHost {
  if (!hostHeader) return "unknown";
  const normalized = hostHeader.split(":")[0].toLowerCase().trim();

  const envObj = env as Record<string, unknown> | undefined;
  const apiHost = typeof envObj?.API_HOST === "string" ? envObj.API_HOST.split(":")[0].toLowerCase().trim() : undefined;
  const consoleHost = typeof envObj?.CONSOLE_HOST === "string" ? envObj.CONSOLE_HOST.split(":")[0].toLowerCase().trim() : undefined;
  const adminHost = typeof envObj?.ADMIN_HOST === "string" ? envObj.ADMIN_HOST.split(":")[0].toLowerCase().trim() : undefined;
  const apexHost = typeof envObj?.APEX_HOST === "string" ? envObj.APEX_HOST.split(":")[0].toLowerCase().trim() : undefined;

  if (apiHost && normalized === apiHost) return "api";
  if (consoleHost && normalized === consoleHost) return "console";
  if (adminHost && normalized === adminHost) return "admin";
  if (apexHost && normalized === apexHost) return "apex";

  // Fallback defaults if environment host variables are not set
  if (!apiHost && !consoleHost && !adminHost && !apexHost) {
    if (
      normalized === "api.key-col.axe08.tech" ||
      normalized === "api.keycollective.ai" ||
      normalized === "api.localhost" ||
      normalized === "proxy.keycollective.internal"
    ) {
      return "api";
    }
    if (
      normalized === "console.key-col.axe08.tech" ||
      normalized === "console.keycollective.ai" ||
      normalized === "console.localhost"
    ) {
      return "console";
    }
    if (
      normalized === "admin.key-col.axe08.tech" ||
      normalized === "admin.keycollective.ai" ||
      normalized === "admin.localhost"
    ) {
      return "admin";
    }
    if (
      normalized === "key-col.axe08.tech" ||
      normalized === "keycollective.ai" ||
      normalized === "localhost"
    ) {
      return "apex";
    }
  }

  return "unknown";
}

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
