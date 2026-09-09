/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Root Entrypoint: Cloudflare Worker & Durable Object Re-Exports
 */

import worker, {
  createWorker,
  MainWorker,
  WorkerOptions,
  HealthResponse,
} from "./worker/index";
import type { WorkerEnv } from "./worker/auth_middleware";

export interface Env {
  KEY_POOL: DurableObjectNamespace;
  DB: D1Database;
  TELEMETRY: AnalyticsEngineDataset;
  KC_MASTER_KEY?: string;
  [key: string]: unknown;
}

export { HealthResponse, WorkerEnv };
export { KeyPoolDO } from "./durable_objects/key_pool_do";
export { createWorker, MainWorker };
export type { WorkerOptions };

// Re-export all worker module components
export * from "./worker/index";

// Cloudflare Worker Default Fetch Handler
export default worker;
