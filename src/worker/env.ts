import type {
  D1Database,
  DurableObjectNamespace,
  AnalyticsEngineDataset,
} from "@cloudflare/workers-types";

/**
 * Worker environment bindings for Key Collective edge worker.
 */
export interface WorkerEnv {
  D1_DB: D1Database;
  KEY_POOL: DurableObjectNamespace;
  ANALYTICS: AnalyticsEngineDataset;
}
