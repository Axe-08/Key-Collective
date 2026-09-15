/**
 * Non-streaming response handling, cost calculation, and non-blocking D1 ledger logging.
 */

import type { KeyPoolContract } from "../../../contracts/key_pool";
import type { CascadeRouteResponse } from "../../../router/cascade_router";
import { createApiResponse } from "../../../types/api";
import type {
  AuthenticatedContext,
  WorkerEnv,
} from "../../auth_middleware";
import type { ExecutionContextLike } from "../../telemetry_emitter";
import type { ChatHandlerDependencies } from "./types";

export async function handleNonStreamingResponse(
  deps: ChatHandlerDependencies,
  cascadeRes: CascadeRouteResponse,
  authContext: AuthenticatedContext,
  keyPool: KeyPoolContract,
  env: WorkerEnv,
  ctx?: ExecutionContextLike,
  traceId: string = crypto.randomUUID(),
  startTime: number = deps.timeProvider()
): Promise<Response> {
  const durationMs = deps.timeProvider() - startTime;
  const costMicrodollars = cascadeRes.costMicrodollars;

  // Asynchronous background task for D1 persistence and telemetry
  const postWork = async (): Promise<void> => {
    // 1. Record key usage on tenant DO
    if (costMicrodollars > 0n && cascadeRes.modelDef?.id) {
      keyPool.recordUsage(cascadeRes.modelDef.id, costMicrodollars).catch(() => {});
    }

    // 2. Record event to D1 Cost Ledger (Golden Test tc-01)
    const costLedgerRepo = deps.getCostLedgerRepo(env);
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
    const authTokensRepo = deps.getAuthTokensRepo(env);
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
    const telemetryEmitter = deps.getTelemetryEmitter(env, ctx);
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
  if (deps.options.responseFormat === "kc_api") {
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
