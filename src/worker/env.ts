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
  REPORT_WEBHOOK_SECRET?: string;
  MIDNIGHT_FREEZE?: string;
  DB?: D1Database;
  TELEMETRY?: AnalyticsEngineDataset;
  KC_MASTER_KEY?: string;
  ASSETS?: { fetch(request: Request | string): Promise<Response> };
  [key: string]: unknown;
}
