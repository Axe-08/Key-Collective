/**
 * ChatHandler orchestrates parameter extraction, token estimation, cascade routing, and delegation.
 */

import type { KeyPoolContract } from "../../../contracts/key_pool";
import { CapabilityFilter } from "../../../router/capability/index";
import type {
  CascadeRouteRequest,
  CascadeRouteResponse,
} from "../../../router/cascade/index";
import type {
  AuthenticatedContext,
  WorkerEnv,
} from "../../auth/index";
import type { ExecutionContextLike } from "../../telemetry_emitter";
import { RouterError } from "../errors";
import type { DurableObjectNamespaceLike, DurableObjectStubLike } from "../types";
import type { ChatHandlerDependencies } from "./types";
import { handleStreamingResponse } from "./stream";
import { handleNonStreamingResponse } from "./non_streaming";

export class ChatHandler {
  constructor(private readonly deps: ChatHandlerDependencies) {}

  private now(): number {
    return this.deps.timeProvider();
  }

  private getPoolCoordinator(
    env: WorkerEnv
  ): DurableObjectStub | DurableObjectStubLike | undefined {
    if (this.deps.getPoolCoordinator) {
      return this.deps.getPoolCoordinator(env);
    }
    const coordinatorNamespace = env.POOL_COORDINATOR as unknown as
      | DurableObjectNamespaceLike
      | undefined;
    if (
      coordinatorNamespace &&
      typeof coordinatorNamespace.idFromName === "function"
    ) {
      const doId = coordinatorNamespace.idFromName("global");
      return coordinatorNamespace.get(doId);
    }
    return undefined;
  }

  /**
   * Handles chat completions routing, fallback escalation, and streaming response transformation.
   */
  public async handleChatCompletions(
    request: Request,
    body: Record<string, unknown>,
    authContext: AuthenticatedContext,
    env: WorkerEnv,
    ctx?: ExecutionContextLike,
    traceId: string = crypto.randomUUID(),
    startTime: number = this.now()
  ): Promise<Response> {
    // 1. Validate and extract request parameters
    const modelAliasRaw = body.model ?? body.modelAlias;
    const modelAlias =
      typeof modelAliasRaw === "string" && modelAliasRaw.trim().length > 0
        ? modelAliasRaw.trim()
        : "auto";

    if (body.messages !== undefined && !Array.isArray(body.messages)) {
      throw new RouterError("'messages' parameter must be an array", {
        statusCode: 400,
        code: "INVALID_MESSAGES_PARAMETER",
      });
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const stream = Boolean(body.stream);

    // 2. Pre-calculate estimated prompt tokens for context window check (Golden Test tc-05)
    let estimatedPromptTokens: number | undefined =
      typeof body.estimatedPromptTokens === "number"
        ? body.estimatedPromptTokens
        : undefined;

    if (estimatedPromptTokens === undefined && messages.length > 0) {
      estimatedPromptTokens = CapabilityFilter.estimateTokens(messages);
    }

    // 3. Resolve tenant DO key pool & CascadeRouter
    const keyPool = this.deps.getKeyPool(authContext.tenantId, env);
    const router = this.deps.getRouter(authContext.tenantId, keyPool, env);

    // 4. Construct CascadeRouteRequest
    const maxTokens =
      typeof body.max_tokens === "number"
        ? body.max_tokens
        : typeof body.maxTokens === "number"
        ? body.maxTokens
        : typeof body.max_completion_tokens === "number"
        ? body.max_completion_tokens
        : undefined;

    const temperature =
      typeof body.temperature === "number" ? body.temperature : undefined;

    const cascadeReq: CascadeRouteRequest = {
      modelAlias,
      messages,
      stream,
      temperature,
      maxTokens,
      tools: Array.isArray(body.tools) ? body.tools : undefined,
      functions: Array.isArray(body.functions) ? body.functions : undefined,
      tool_choice: body.tool_choice,
      function_call: body.function_call,
      response_format: body.response_format,
      estimatedPromptTokens,
      signal: request.signal,
      headers: {
        "x-kc-trace-id": traceId,
        "x-kc-tenant-id": authContext.tenantId,
      },
    };

    // Pre-dispatch emergency brake check via POOL_COORDINATOR DO (Fail-open design)
    const poolCoordinator = this.getPoolCoordinator(env);
    if (poolCoordinator) {
      try {
        const brakeUrl = `http://coordinator/coordinator/brake-status/${encodeURIComponent(
          authContext.tenantId
        )}`;
        const brakeRes = await poolCoordinator.fetch(brakeUrl, { method: "GET" });
        if (brakeRes.status === 429) {
          throw new RouterError(
            `Emergency brake active for tenant '${authContext.tenantId}'`,
            {
              statusCode: 429,
              code: "EMERGENCY_BRAKE_ACTIVE",
            }
          );
        }
        if (brakeRes.ok) {
          const brakeData = (await brakeRes.json()) as { braked?: boolean };
          if (brakeData.braked) {
            throw new RouterError(
              `Emergency brake active for tenant '${authContext.tenantId}'`,
              {
                statusCode: 429,
                code: "EMERGENCY_BRAKE_ACTIVE",
              }
            );
          }
        }
      } catch (err) {
        if (err instanceof RouterError) {
          throw err;
        }
        // Fail-open: suppress coordinator errors so proxy availability is preserved
      }
    }

    // 5. Execute routing via CascadeRouter (handles model alias resolution tc-06, capability filter tc-07, and context window tc-05)
    const cascadeRes = (await router.route(cascadeReq)) as CascadeRouteResponse;

    // 6. Handle Streaming vs Non-Streaming Responses
    const responsePromise = stream
      ? this.handleStreamingResponse(
          cascadeRes,
          authContext,
          keyPool,
          env,
          ctx,
          traceId,
          startTime
        )
      : await this.handleNonStreamingResponse(
          cascadeRes,
          authContext,
          keyPool,
          env,
          ctx,
          traceId,
          startTime
        );

    // Asynchronously report volume to POOL_COORDINATOR
    if (poolCoordinator) {
      const reportVolumeTask = async () => {
        try {
          const volume = cascadeRes.usage?.totalTokens ?? estimatedPromptTokens ?? 1;
          await poolCoordinator.fetch("http://coordinator/coordinator/report-volume", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              tenantId: authContext.tenantId,
              volume: Math.max(1, volume),
            }),
          });
        } catch {
          // Non-blocking telemetry
        }
      };

      if (ctx?.waitUntil) {
        ctx.waitUntil(reportVolumeTask());
      } else {
        reportVolumeTask().catch(() => {});
      }
    }

    return responsePromise;
  }

  public handleStreamingResponse(
    cascadeRes: CascadeRouteResponse,
    authContext: AuthenticatedContext,
    keyPool: KeyPoolContract,
    env: WorkerEnv,
    ctx?: ExecutionContextLike,
    traceId: string = crypto.randomUUID(),
    startTime: number = this.now()
  ): Response {
    return handleStreamingResponse(
      this.deps,
      cascadeRes,
      authContext,
      keyPool,
      env,
      ctx,
      traceId,
      startTime
    );
  }

  public async handleNonStreamingResponse(
    cascadeRes: CascadeRouteResponse,
    authContext: AuthenticatedContext,
    keyPool: KeyPoolContract,
    env: WorkerEnv,
    ctx?: ExecutionContextLike,
    traceId: string = crypto.randomUUID(),
    startTime: number = this.now()
  ): Promise<Response> {
    return handleNonStreamingResponse(
      this.deps,
      cascadeRes,
      authContext,
      keyPool,
      env,
      ctx,
      traceId,
      startTime
    );
  }
}
