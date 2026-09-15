/**
 * ChatHandler types and dependency contracts.
 */

import type { KeyPoolContract } from "../../../contracts/key_pool";
import type { RouterContract } from "../../../contracts/router";
import type {
  CascadeRouter,
} from "../../../router/cascade_router";
import type { IModelRegistry } from "../../../router/model_registry";
import type { CostLedgerRepository } from "../../../storage/repositories/costLedger";
import type { AuthTokensRepository } from "../../../storage/repositories/authTokens";
import type {
  WorkerEnv,
} from "../../auth_middleware";
import type { ExecutionContextLike, TelemetryEmitter } from "../../telemetry_emitter";
import type { RouterHandlerOptions } from "../types";

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
}
