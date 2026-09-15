/**
 * Key Collective v2/v4 — Edge Router Context & Dependency Resolver
 *
 * Invariants (GEMINI.md Constitution):
 * - Per-Tenant DO Isolation: env.KEY_POOL.idFromName(tenantId)
 * - Strict TypeScript (zero `any`).
 */

import type { KeyPoolContract } from "../../../contracts/key_pool";
import type { RouterContract } from "../../../contracts/router";
import { UpstreamClient } from "../../../proxy/upstream_client";
import { CapabilityFilter } from "../../../router/capability_filter";
import { CascadeRouter } from "../../../router/cascade_router";
import type { IModelRegistry } from "../../../router/model_registry";
import { AuthTokensRepository } from "../../../storage/repositories/authTokens";
import { CostLedgerRepository } from "../../../storage/repositories/costLedger";
import type { WorkerEnv } from "../../auth_middleware";
import type { ExecutionContextLike } from "../../telemetry_emitter";
import { TelemetryEmitter } from "../../telemetry_emitter";
import { DurableObjectKeyPoolClient } from "../do_client";
import { RouterError } from "../errors";
import type {
  DurableObjectNamespaceLike,
  RouterHandlerOptions,
} from "../types";

export class RouterContextResolver {
  constructor(
    private readonly options: RouterHandlerOptions,
    private readonly modelRegistry: IModelRegistry,
    private readonly capabilityFilter: CapabilityFilter,
    private readonly upstreamClient: UpstreamClient
  ) {}

  /**
   * Resolves or creates a KeyPoolContract client for the given tenant ID.
   * Enforces Per-Tenant DO Isolation (GEMINI.md Invariant).
   */
  public getKeyPool(tenantId: string, env: WorkerEnv): KeyPoolContract {
    if (this.options.keyPoolFactory) {
      return this.options.keyPoolFactory(tenantId, env);
    }

    const keyPoolNamespace = env.KEY_POOL as unknown as DurableObjectNamespaceLike | undefined;
    if (keyPoolNamespace && typeof keyPoolNamespace.idFromName === "function") {
      const doId = keyPoolNamespace.idFromName(tenantId);
      const doStub = keyPoolNamespace.get(doId);
      return new DurableObjectKeyPoolClient(doStub, tenantId);
    }

    if (this.options.router && "getKeyPool" in this.options.router) {
      const routerKeyPool = (this.options.router as CascadeRouter).getKeyPool();
      if (routerKeyPool) {
        return routerKeyPool;
      }
    }

    throw new RouterError(
      `No KEY_POOL Durable Object namespace binding or keyPoolFactory found for tenant '${tenantId}'`,
      { statusCode: 500, code: "MISSING_KEY_POOL_BINDING" }
    );
  }

  /**
   * Resolves or creates a CascadeRouter for the given tenant ID.
   */
  public getRouter(
    tenantId: string,
    keyPool: KeyPoolContract,
    env: WorkerEnv
  ): CascadeRouter | RouterContract {
    if (this.options.routerFactory) {
      return this.options.routerFactory(tenantId, keyPool, env);
    }

    if (this.options.router) {
      return this.options.router;
    }

    const client =
      this.upstreamClient ??
      new UpstreamClient({
        keyResolver: async (provider: string) => {
          return keyPool.getKey(provider);
        },
      });

    return new CascadeRouter({
      keyPool,
      registry: this.modelRegistry,
      capabilityFilter: this.capabilityFilter,
      upstreamClient: client,
    });
  }

  /**
   * Resolves or creates a CostLedgerRepository instance.
   */
  public getCostLedgerRepo(env: WorkerEnv): CostLedgerRepository | undefined {
    if (this.options.costLedgerRepo) {
      return this.options.costLedgerRepo;
    }
    if (env.DB && typeof env.DB.prepare === "function") {
      return new CostLedgerRepository(env.DB);
    }
    return undefined;
  }

  /**
   * Resolves or creates an AuthTokensRepository instance.
   */
  public getAuthTokensRepo(env: WorkerEnv): AuthTokensRepository | undefined {
    if (this.options.authTokensRepo) {
      return this.options.authTokensRepo;
    }
    if (env.DB && typeof env.DB.prepare === "function") {
      const masterKey =
        this.options.masterKey ??
        (env.KC_MASTER_KEY ? String(env.KC_MASTER_KEY) : undefined);
      return new AuthTokensRepository(env.DB, { masterKey });
    }
    return undefined;
  }

  /**
   * Resolves or creates a TelemetryEmitter instance.
   */
  public getTelemetryEmitter(
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ): TelemetryEmitter {
    if (this.options.telemetryEmitter) {
      return this.options.telemetryEmitter;
    }
    return new TelemetryEmitter({
      dataset: env.TELEMETRY,
      ctx,
    });
  }
}
