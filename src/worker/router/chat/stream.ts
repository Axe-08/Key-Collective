/**
 * Streaming response handling and non-blocking background telemetry/ledger persistence.
 */

import type { KeyPoolContract } from "../../../contracts/key_pool";
import type { CascadeRouteResponse } from "../../../router/cascade/index";
import type { StreamUsage } from "../../../proxy/sse/index";
import type {
  AuthenticatedContext,
  WorkerEnv,
} from "../../auth/index";
import type { ExecutionContextLike } from "../../telemetry_emitter";
import { RouterError } from "../errors";
import type { ChatHandlerDependencies } from "./types";

export function handleStreamingResponse(
  deps: ChatHandlerDependencies,
  cascadeRes: CascadeRouteResponse,
  authContext: AuthenticatedContext,
  keyPool: KeyPoolContract,
  env: WorkerEnv,
  ctx?: ExecutionContextLike,
  traceId: string = crypto.randomUUID(),
  startTime: number = deps.timeProvider()
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

    const durationMs = deps.timeProvider() - startTime;

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
        costMicrodollars = deps.modelRegistry.calculateCost(cascadeRes.model, usage);
      } catch {
        costMicrodollars = 0n;
      }
    }

    // 3. Record key usage on tenant DO
    if (costMicrodollars > 0n && cascadeRes.modelDef?.id) {
      keyPool.recordUsage(cascadeRes.modelDef.id, costMicrodollars).catch(() => {});
    }

    // 4. Record event to D1 Cost Ledger (Golden Test tc-02)
    const costLedgerRepo = deps.getCostLedgerRepo(env);
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

    // 6. Emit Non-Blocking Telemetry to Workers Analytics Engine
    const telemetryEmitter = deps.getTelemetryEmitter(env, ctx);
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
