/**
 * Key Collective v2/v4 — Router Subsystem Types & Options
 */

import type { KeyPoolContract, KeyMetrics } from "../../contracts/key_pool";
import type { RouterContract } from "../../contracts/router";
import type { KeyInput } from "../../crypto";
import type { CapacitySummary } from "../../durable_objects/key_selector";
import type { CascadeRouter } from "../../router/cascade/index";
import type { IModelRegistry } from "../../router/registry/index";
import type { CapabilityFilter } from "../../router/capability/index";
import type { UpstreamClient } from "../../proxy/upstream/index";
import type { TelemetryEmitter } from "../telemetry_emitter";
import type { CostLedgerRepository } from "../../storage/repositories/cost_ledger/index";
import type { AuthTokensRepository } from "../../storage/repositories/auth_tokens/index";
import type { AuthMiddleware, WorkerEnv } from "../auth/index";

/**
 * Structural interface matching Cloudflare DurableObjectStub.
 * Enables both Cloudflare native stubs and mock stubs in unit tests.
 */
export interface DurableObjectStubLike {
  id?: {
    toString(): string;
    name?: string;
  };
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  getKey?(provider: string): Promise<string>;
  recordUsage?(keyId: string, costMicrodollars: bigint): Promise<void>;
  recordResult?(keyId: string, success: boolean): Promise<void>;
  recordStatusCode?(keyId: string, statusCode: number): Promise<void>;
  getKeyMetrics?(keyId: string): Promise<KeyMetrics>;
  getCapacitySummary?(provider?: string): Promise<CapacitySummary>;
}

/**
 * Structural interface matching Cloudflare DurableObjectNamespace.
 */
export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStubLike;
}

/**
 * Configuration options for RouterHandler.
 */
export interface RouterHandlerOptions {
  /** Injected AuthMiddleware instance or configuration options */
  authMiddleware?: AuthMiddleware;
  /** Whether to enforce Bearer token authentication (default: true) */
  requireAuth?: boolean;
  /** Injected CascadeRouter instance (overrides per-tenant router creation) */
  router?: CascadeRouter | RouterContract;
  /** Custom factory to build a CascadeRouter per tenant */
  routerFactory?: (
    tenantId: string,
    keyPool: KeyPoolContract,
    env: WorkerEnv
  ) => CascadeRouter | RouterContract;
  /** Custom factory to build a KeyPoolContract per tenant */
  keyPoolFactory?: (tenantId: string, env: WorkerEnv) => KeyPoolContract;
  /** Injected ModelRegistry */
  modelRegistry?: IModelRegistry;
  /** Injected CapabilityFilter */
  capabilityFilter?: CapabilityFilter;
  /** Injected UpstreamClient */
  upstreamClient?: UpstreamClient;
  /** Injected TelemetryEmitter */
  telemetryEmitter?: TelemetryEmitter;
  /** Injected CostLedgerRepository */
  costLedgerRepo?: CostLedgerRepository;
  /** Injected AuthTokensRepository */
  authTokensRepo?: AuthTokensRepository;
  /** Master encryption passphrase/key for D1 repositories */
  masterKey?: KeyInput;
  /** Injectable time provider for deterministic unit testing */
  timeProvider?: () => number;
  /** Default response format: "openai" (OpenAI-compatible payload) or "kc_api" (structured ApiResponse) */
  responseFormat?: "openai" | "kc_api";
}
