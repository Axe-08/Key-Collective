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
import { sanitize } from "../../error_normalizer";
import { calculateCu } from "../../../router/registry/registry";
import type { TokenUsage } from "../../../router/registry/types";
import { extractUsageFromPayload } from "../../../proxy/sse/usage_extractor";

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
  let emittedKcUsage = false;
  let trackedUsage: StreamUsage | null = cascadeRes.usage ?? null;
  let isBinary = true;
  let textBuffer = "";

  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });

  const getCalculatedCu = (usageToUse: StreamUsage | null): bigint => {
    const effectiveUsage: TokenUsage = {
      promptTokens: usageToUse?.promptTokens ?? 0,
      completionTokens: usageToUse?.completionTokens ?? 0,
      cachedTokens: usageToUse?.cachedTokens ?? 0,
      reasoningTokens: usageToUse?.reasoningTokens ?? 0,
    };

    if (deps.modelRegistry) {
      try {
        const registry = deps.modelRegistry as unknown as {
          calculateCu?: (model: string, usage: TokenUsage) => bigint;
          calculateCost?: (model: string, usage: TokenUsage) => bigint;
        };
        if (typeof registry.calculateCu === "function") {
          return registry.calculateCu(cascadeRes.model, effectiveUsage);
        }
      } catch {
        // Fall back below
      }
    }

    if (cascadeRes.modelDef) {
      try {
        return calculateCu(cascadeRes.modelDef, effectiveUsage);
      } catch {
        // Fall back below
      }
    }

    if (deps.modelRegistry) {
      try {
        return deps.modelRegistry.calculateCost(cascadeRes.model, effectiveUsage);
      } catch {
        return 0n;
      }
    }

    return 0n;
  };

  // Background task to finalize telemetry, cost calculation, and D1 ledger
  const finalizeStream = async (errorOccurred: boolean = false): Promise<void> => {
    if (finalized) return;
    finalized = true;

    const durationMs = deps.timeProvider() - startTime;

    // 1. Extract usage from upstream response, transformer, or tracked usage
    let usage: StreamUsage | null = null;
    try {
      usage = await upstreamRes?.getUsage?.(200);
    } catch {
      usage = null;
    }

    if (!usage) {
      usage =
        trackedUsage ??
        (upstreamRes as { transformer?: { usage?: StreamUsage | null } })?.transformer?.usage ??
        null;
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

    const statusCode = errorOccurred ? 500 : 200;

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
          statusCode,
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
          statusCode: String(statusCode),
          promptTokens: String(usage?.promptTokens ?? 0),
          completionTokens: String(usage?.completionTokens ?? 0),
          totalTokens: String(usage?.totalTokens ?? 0),
        },
      });
    } catch {
      // Non-blocking telemetry invariant
    }
  };

  const triggerFinalize = (errorOccurred: boolean = false) => {
    const bgWork = finalizeStream(errorOccurred);
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(bgWork);
    }
  };

  const encodeOutput = (text: string): Uint8Array | string => {
    return isBinary ? encoder.encode(text) : text;
  };

  const emitKcUsageAndDone = (
    controller: ReadableStreamDefaultController<Uint8Array | string>
  ) => {
    if (emittedKcUsage) return;
    emittedKcUsage = true;

    const activeUsage =
      trackedUsage ??
      (upstreamRes as { transformer?: { usage?: StreamUsage | null } })?.transformer?.usage ??
      null;

    const cuWeight = getCalculatedCu(activeUsage);

    const usagePayload = JSON.stringify({ cu: Number(cuWeight) });
    const usageEvent = `event: kc.usage\ndata: ${usagePayload}\n\n`;
    controller.enqueue(encodeOutput(usageEvent));

    const doneEvent = `data: [DONE]\n\n`;
    controller.enqueue(encodeOutput(doneEvent));
  };

  const processEventBlock = (
    eventRaw: string,
    controller: ReadableStreamDefaultController<Uint8Array | string>
  ) => {
    if (!eventRaw || eventRaw.trim().length === 0) {
      return;
    }

    const lines = eventRaw.split(/\r?\n/);
    const hasDone = lines.some((l) => {
      const trimmed = l.trim();
      return trimmed === "data: [DONE]" || trimmed === "data:[DONE]";
    });

    const isError = lines.some((l) => {
      const trimmed = l.trim();
      return (
        trimmed.startsWith("event: error") ||
        trimmed.startsWith("event:error") ||
        trimmed.startsWith("data: {\"error\"") ||
        trimmed.startsWith("data:{\"error\"")
      );
    });

    // Extract token usage from payload if available
    for (const line of lines) {
      if (line.startsWith("data:")) {
        const val = line.slice(5).trim();
        if (val.startsWith("{")) {
          try {
            const parsed = JSON.parse(val);
            const extracted = extractUsageFromPayload(parsed);
            if (extracted) {
              const promptTokens = extracted.promptTokens ?? trackedUsage?.promptTokens ?? 0;
              const completionTokens = extracted.completionTokens ?? trackedUsage?.completionTokens ?? 0;
              const totalTokens =
                extracted.totalTokens ??
                trackedUsage?.totalTokens ??
                promptTokens + completionTokens;

              trackedUsage = {
                promptTokens,
                completionTokens,
                totalTokens,
                cachedTokens: extracted.cachedTokens ?? trackedUsage?.cachedTokens,
                reasoningTokens: extracted.reasoningTokens ?? trackedUsage?.reasoningTokens,
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: totalTokens,
              };
            }
          } catch {
            // Non-JSON payload
          }
        }
      }
    }

    if (isError) {
      // Upstream emitted mid-stream error event - sanitize before forwarding
      const sanitized = sanitize(eventRaw);
      controller.enqueue(encodeOutput(sanitized + "\n\n"));
      return;
    }

    if (hasDone) {
      // Upstream emitted [DONE].
      // Forward any non-DONE lines in this event block first
      const nonDoneLines = lines.filter((l) => {
        const trimmed = l.trim();
        return trimmed !== "data: [DONE]" && trimmed !== "data:[DONE]";
      });
      if (nonDoneLines.length > 0) {
        controller.enqueue(encodeOutput(nonDoneLines.join("\n") + "\n\n"));
      }
      // Emit kc.usage followed by [DONE]
      emitKcUsageAndDone(controller);
      return;
    }

    controller.enqueue(encodeOutput(eventRaw + "\n\n"));
  };

  const findDoubleNewline = (buf: string): { index: number; len: number } | null => {
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i] === "\n" && buf[i + 1] === "\n") {
        return { index: i, len: 2 };
      }
      if (
        buf[i] === "\r" &&
        buf[i + 1] === "\n" &&
        i + 3 < buf.length &&
        buf[i + 2] === "\r" &&
        buf[i + 3] === "\n"
      ) {
        return { index: i, len: 4 };
      }
      if (buf[i] === "\r" && buf[i + 1] === "\n" && i + 2 < buf.length && buf[i + 2] === "\n") {
        return { index: i, len: 3 };
      }
      if (buf[i] === "\n" && i + 2 < buf.length && buf[i + 1] === "\r" && buf[i + 2] === "\n") {
        return { index: i, len: 3 };
      }
    }
    return null;
  };

  const reader = (bodyStream as ReadableStream<Uint8Array | string>).getReader();

  const transformedStream = new ReadableStream<Uint8Array | string>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (typeof value === "string") {
            isBinary = false;
            textBuffer += value;
          } else {
            isBinary = true;
            textBuffer += decoder.decode(value, { stream: true });
          }

          let nextEvent: { index: number; len: number } | null;
          while ((nextEvent = findDoubleNewline(textBuffer)) !== null) {
            const eventRaw = textBuffer.slice(0, nextEvent.index);
            textBuffer = textBuffer.slice(nextEvent.index + nextEvent.len);
            processEventBlock(eventRaw, controller);
          }
        }

        // Flush any remaining text in buffer
        const remaining = textBuffer + decoder.decode();
        textBuffer = "";
        if (remaining.trim().length > 0) {
          processEventBlock(remaining.trim(), controller);
        }

        // Emit kc.usage and [DONE] if not emitted yet
        if (!emittedKcUsage) {
          emitKcUsageAndDone(controller);
        }

        controller.close();
        triggerFinalize(false);
      } catch (err) {
        // Catch mid-stream upstream error, sanitize it and emit as SSE error event
        const rawMessage = err instanceof Error ? err.message : String(err);
        const sanitizedMessage = sanitize(rawMessage);
        const errorPayload = JSON.stringify({
          error: {
            message: sanitizedMessage,
            type: "upstream_error",
            code: "UPSTREAM_STREAM_ERROR",
          },
        });
        const errorEvent = `event: error\ndata: ${errorPayload}\n\n`;
        controller.enqueue(encodeOutput(errorEvent));
        controller.close();
        triggerFinalize(true);
      }
    },
    async cancel(reason) {
      triggerFinalize(false);
      try {
        await reader.cancel(reason);
      } catch {
        // Ignore cancel errors
      }
    },
  });

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
