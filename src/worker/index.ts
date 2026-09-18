/**
 * @file index.ts
 * Main Worker Entrypoint: Subdomain Host Routing, API Gateway, SPA Delivery & Admin Surveillance
 * Decoupled into src/worker/gateway/.
 */

import { MainWorker } from "./gateway/main_worker";
import type { WorkerEnv } from "./auth/index";
import type { ExecutionContextLike } from "./telemetry_emitter";
import type { WorkerOptions } from "./gateway/types";

export * from "./gateway/index";

/**
 * Singleton default instance of MainWorker.
 */
export const defaultMainWorker = new MainWorker();

/**
 * Factory function to create a new MainWorker instance with custom options.
 */
export function createWorker(options?: WorkerOptions): {
  fetch(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ): Promise<Response>;
} {
  const worker = new MainWorker(options);
  return {
    fetch: (req, env, ctx) => worker.fetch(req, env, ctx),
  };
}

/**
 * Cloudflare Worker Default Fetch Handler Export.
 */
const defaultExport = {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ): Promise<Response> {
    return defaultMainWorker.fetch(request, env, ctx);
  },
};

export default defaultExport;

// Re-export core worker components
export {
  AuthMiddleware,
  AuthenticatedContext,
  AuthMiddlewareOptions,
  withAuth,
  authenticateRequest,
  extractBearerToken,
  formatAuthError,
  InMemoryRateLimiterStorage,
} from "./auth/index";

export {
  RouterHandler,
  RouterHandlerOptions,
  RouterError,
  DurableObjectKeyPoolClient,
  formatRouterError,
  createRouterHandler,
  defaultRouterHandler,
  handleRoute,
} from "./router/index";

export {
  TelemetryEmitter,
  TelemetryEmitterOptions,
  ExecutionContextLike,
  createTelemetryEmitter,
  defaultDataPointMapper,
} from "./telemetry_emitter";
