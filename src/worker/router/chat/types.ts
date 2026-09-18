/**
 * ChatHandler types and dependency contracts.
 */

import type { KeyPoolContract } from "../../../contracts/key_pool";
import type { RouterContract } from "../../../contracts/router";
import type {
  CascadeRouter,
} from "../../../router/cascade/index";
import type { IModelRegistry } from "../../../router/registry/index";
import type { CostLedgerRepository } from "../../../storage/repositories/cost_ledger/index";
import type { AuthTokensRepository } from "../../../storage/repositories/auth_tokens/index";
import type {
  WorkerEnv,
} from "../../auth/index";
import type { ExecutionContextLike, TelemetryEmitter } from "../../telemetry_emitter";
import type { DurableObjectStubLike, RouterHandlerOptions } from "../types";

export interface ChatHandlerDependencies {
  options: RouterHandlerOptions;
  modelRegistry: IModelRegistry;
  timeProvider: () => number;
  getKeyPool: (tenantId: string, env: WorkerEnv) => KeyPoolContract;
  getRouter: (
    tenantId: string,
    keyPool: KeyPoolContract,
    env: WorkerEnv
  ) => CascadeRouter | RouterContract;
  getCostLedgerRepo: (env: WorkerEnv) => CostLedgerRepository | undefined;
  getAuthTokensRepo: (env: WorkerEnv) => AuthTokensRepository | undefined;
  getTelemetryEmitter: (
    env: WorkerEnv,
    ctx?: ExecutionContextLike
  ) => TelemetryEmitter;
  getPoolCoordinator?: (env: WorkerEnv) => DurableObjectStub | DurableObjectStubLike;
}
