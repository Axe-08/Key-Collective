/**
 * Key Collective v2/v4 — Chat Completions & Streaming Routing Engine
 * Conforms to:
 * - Streaming Response Passthrough & Non-Blocking Observability (GEMINI.md Invariant)
 * - Fixed-Point Microdollars: All costs tracked in int64/bigint microdollars (1 USD = 1,000,000 µ$)
 * - Multi-Model Cascade Routing & Fallback Escalation (CascadeRouter)
 */

import type { KeyPoolContract } from "../../contracts/key_pool";
import type { RouterContract } from "../../contracts/router";
import { CapabilityFilter } from "../../router/capability_filter";
import type {
  CascadeRouter,
  CascadeRouteRequest,
  CascadeRouteResponse,
} from "../../router/cascade_router";
import type { IModelRegistry } from "../../router/model_registry";
import type { StreamUsage } from "../../proxy/sse_transformer";
import type { CostLedgerRepository } from "../../storage/repositories/costLedger";
import type { AuthTokensRepository } from "../../storage/repositories/authTokens";
import { createApiResponse } from "../../types/api";
import type {
  AuthenticatedContext,
  WorkerEnv,
} from "../auth_middleware";
import type { ExecutionContextLike, TelemetryEmitter } from "../telemetry_emitter";
import { RouterError } from "./errors";
import type { RouterHandlerOptions } from "./types";

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

export class ChatHandler {
  constructor(private readonly deps: ChatHandlerDependencies) {}

  private now(): number {
    return this.deps.timeProvider();
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

    // 5. Execute routing via CascadeRouter (handles model alias resolution tc-06, capability filter tc-07, and context window tc-05)
    const cascadeRes = (await router.route(cascadeReq)) as CascadeRouteResponse;

    // 6. Handle Streaming vs Non-Streaming Responses
    if (stream) {
      return this.handleStreamingResponse(
        cascadeRes,
        authContext,
        keyPool,
        env,
        ctx,
        traceId,
        startTime
      );
    }

    return await this.handleNonStreamingResponse(
      cascadeRes,
      authContext,
      keyPool,
      env,
      ctx,
      traceId,
      startTime
    );
  }

  /**
   * Handles streaming response passthrough, usage parsing, and non-blocking background ledger & telemetry writes.
   * Conforms to Golden Test tc-02 & GEMINI.md non-blocking telemetry invariant.
   */
  public handleStreamingResponse(
    cascadeRes: CascadeRouteResponse,
    authContext: AuthenticatedContext,
    keyPool: KeyPoolContract,
    env: WorkerEnv,
    ctx?: ExecutionContextLike,
    traceId: string = crypto.randomUUID(),
    startTime: number = this.now()
  ): Response {
    const upstreamRes = cascadeRes.response;
    const bodyStream = upstreamRes?.body;

    if (!bodyStream) {
      throw new RouterError("Upstream returned empty body for streaming response", {
        statusCode: 502,
        code: "EMPTY_STREAM_BODY",
      });
    }

    let finalized = false;

    // Background task to finalize telemetry, cost calculation, and D1 ledger
    const finalizeStream = async (): Promise<void> => {
      if (finalized) return;
      finalized = true;

      const durationMs = this.now() - startTime;

      // 1. Extract usage from upstream response or transformer
      let usage: StreamUsage | null = null;
      try {
        usage = await upstreamRes?.getUsage(200);
      } catch {
        usage = null;
      }

      // 2. Calculate exact cost in fixed-point microdollars (int64 / bigint)
      let costMicrodollars = 0n;
      if (usage) {
        try {
          costMicrodollars = this.deps.modelRegistry.calculateCost(cascadeRes.model, usage);
        } catch {
          costMicrodollars = 0n;
        }
      }

      // 3. Record key usage on tenant DO
      if (costMicrodollars > 0n && cascadeRes.modelDef?.id) {
        keyPool.recordUsage(cascadeRes.modelDef.id, costMicrodollars).catch(() => {});
      }

      // 4. Record event to D1 Cost Ledger (Golden Test tc-02)
      const costLedgerRepo = this.deps.getCostLedgerRepo(env);
      if (costLedgerRepo) {
        try {
          await costLedgerRepo.recordEvent({
            requestId: traceId,
            tenantId: authContext.tenantId,
            keyId: cascadeRes.modelDef?.id ?? cascadeRes.model,
            provider: cascadeRes.provider,
            modelId: cascadeRes.model,
            promptTokens: usage?.promptTokens ?? 0,
            completionTokens: usage?.completionTokens ?? 0,
            cachedTokens: usage?.cachedTokens ?? 0,
            reasoningTokens: usage?.reasoningTokens ?? 0,
            costMicrodollars,
            latencyMs: durationMs,
            statusCode: 200,
          });
        } catch {
          // Non-blocking telemetry & hot path invariant
        }
      }

      // 5. Update AuthToken spend in D1
      const authTokensRepo = this.deps.getAuthTokensRepo(env);
      if (authContext.token && authTokensRepo && costMicrodollars > 0n) {
        try {
          await authTokensRepo.recordSpend(
            authContext.token.id,
            authContext.tenantId,
            costMicrodollars
          );
        } catch {
          // Non-blocking hot path invariant
        }
      }

      // 6. Emit Non-Blocking Telemetry to Workers Analytics Engine
      const telemetryEmitter = this.deps.getTelemetryEmitter(env, ctx);
      try {
        telemetryEmitter.emit({
          traceId,
          tenantId: authContext.tenantId,
          timestamp: startTime,
          eventType: "chat_completion_stream",
          latencyMs: durationMs,
          costMicrodollars,
          metadata: {
            model: cascadeRes.model,
            provider: cascadeRes.provider,
            statusCode: "200",
            promptTokens: String(usage?.promptTokens ?? 0),
            completionTokens: String(usage?.completionTokens ?? 0),
            totalTokens: String(usage?.totalTokens ?? 0),
          },
        });
      } catch {
        // Non-blocking telemetry invariant
      }
    };

    // Monitor stream chunks and invoke background finalizeStream on stream completion
    const monitorTransform = new TransformStream<Uint8Array | string, Uint8Array | string>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      flush() {
        const bgWork = finalizeStream();
        if (ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(bgWork);
        }
      },
      cancel() {
        const bgWork = finalizeStream();
        if (ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(bgWork);
        }
      },
    });

    const transformedStream = (bodyStream as ReadableStream<Uint8Array | string>).pipeThrough(
      monitorTransform
    );

    return new Response(transformedStream as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        "x-kc-trace-id": traceId,
        "x-kc-tenant-id": authContext.tenantId,
        "x-kc-model": cascadeRes.model,
        "x-kc-provider": cascadeRes.provider,
      },
    });
  }

  /**
   * Handles non-streaming response generation, cost calculation, and non-blocking D1 ledger logging.
   * Conforms to Golden Test tc-01.
   */
  public async handleNonStreamingResponse(
    cascadeRes: CascadeRouteResponse,
    authContext: AuthenticatedContext,
    keyPool: KeyPoolContract,
    env: WorkerEnv,
    ctx?: ExecutionContextLike,
    traceId: string = crypto.randomUUID(),
    startTime: number = this.now()
  ): Promise<Response> {
    const durationMs = this.now() - startTime;
    const costMicrodollars = cascadeRes.costMicrodollars;

    // Asynchronous background task for D1 persistence and telemetry
    const postWork = async (): Promise<void> => {
      // 1. Record key usage on tenant DO
      if (costMicrodollars > 0n && cascadeRes.modelDef?.id) {
        keyPool.recordUsage(cascadeRes.modelDef.id, costMicrodollars).catch(() => {});
      }

      // 2. Record event to D1 Cost Ledger (Golden Test tc-01)
      const costLedgerRepo = this.deps.getCostLedgerRepo(env);
      if (costLedgerRepo) {
        try {
          await costLedgerRepo.recordEvent({
            requestId: traceId,
            tenantId: authContext.tenantId,
            keyId: cascadeRes.modelDef?.id ?? cascadeRes.model,
            provider: cascadeRes.provider,
            modelId: cascadeRes.model,
            promptTokens: cascadeRes.usage?.promptTokens ?? 0,
            completionTokens: cascadeRes.usage?.completionTokens ?? 0,
            cachedTokens: cascadeRes.usage?.cachedTokens ?? 0,
            reasoningTokens: cascadeRes.usage?.reasoningTokens ?? 0,
            costMicrodollars,
            latencyMs: durationMs,
            statusCode: 200,
          });
        } catch {
          // Non-blocking hot path invariant
        }
      }

      // 3. Update AuthToken spend in D1
      const authTokensRepo = this.deps.getAuthTokensRepo(env);
      if (authContext.token && authTokensRepo && costMicrodollars > 0n) {
        try {
          await authTokensRepo.recordSpend(
            authContext.token.id,
            authContext.tenantId,
            costMicrodollars
          );
        } catch {
          // Non-blocking hot path invariant
        }
      }

      // 4. Emit Telemetry to Workers Analytics Engine
      const telemetryEmitter = this.deps.getTelemetryEmitter(env, ctx);
      try {
        telemetryEmitter.emit({
          traceId,
          tenantId: authContext.tenantId,
          timestamp: startTime,
          eventType: "chat_completion",
          latencyMs: durationMs,
          costMicrodollars,
          metadata: {
            model: cascadeRes.model,
            provider: cascadeRes.provider,
            statusCode: "200",
            promptTokens: String(cascadeRes.usage?.promptTokens ?? 0),
            completionTokens: String(cascadeRes.usage?.completionTokens ?? 0),
            totalTokens: String(cascadeRes.usage?.totalTokens ?? 0),
          },
        });
      } catch {
        // Non-blocking telemetry invariant
      }
    };

    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(postWork());
    } else {
      await postWork();
    }

    // Format OpenAI-compatible completion response payload
    const payload = {
      id: `chatcmpl-${traceId}`,
      object: "chat.completion",
      created: Math.floor(startTime / 1000),
      model: cascadeRes.model,
      provider: cascadeRes.provider,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: cascadeRes.content,
          },
          finish_reason: "stop",
        },
      ],
      usage: cascadeRes.usage
        ? {
            prompt_tokens: cascadeRes.usage.promptTokens,
            completion_tokens: cascadeRes.usage.completionTokens,
            total_tokens: cascadeRes.usage.totalTokens,
          }
        : {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
      cost_microdollars: costMicrodollars.toString(),
    };

    // Format response based on requested format
    if (this.deps.options.responseFormat === "kc_api") {
      const apiRes = createApiResponse(payload, {
        latencyMs: durationMs,
        costMicrodollars: costMicrodollars.toString(),
        traceId,
        requestId: traceId,
        timestamp: startTime,
        provider: cascadeRes.provider,
        model: cascadeRes.model,
      });
      return new Response(JSON.stringify(apiRes), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-kc-trace-id": traceId,
          "x-kc-tenant-id": authContext.tenantId,
          "x-kc-model": cascadeRes.model,
          "x-kc-provider": cascadeRes.provider,
          "x-kc-cost-microdollars": costMicrodollars.toString(),
        },
      });
    }

    return Response.json(payload, {
      status: 200,
      headers: {
        "x-kc-trace-id": traceId,
        "x-kc-tenant-id": authContext.tenantId,
        "x-kc-model": cascadeRes.model,
        "x-kc-provider": cascadeRes.provider,
        "x-kc-cost-microdollars": costMicrodollars.toString(),
      },
    });
  }
}
