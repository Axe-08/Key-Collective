/**
 * Non-streaming response handling, cost calculation, and non-blocking D1 ledger logging.
 */

import type { KeyPoolContract } from "../../../contracts/key_pool";
import type { CascadeRouteResponse } from "../../../router/cascade/index";
import { LeaseOrchestrator } from "../../../router/leases/orchestrator";
import { calculateCu } from "../../../router/registry/index";
import type { TokenUsage } from "../../../router/registry/types";
import { createApiResponse } from "../../../types/api";
import type {
  AuthenticatedContext,
  WorkerEnv,
} from "../../auth/index";
import type { ExecutionContextLike } from "../../telemetry_emitter";
import type { ChatHandlerDependencies } from "./types";
import { applyKcHeaders } from "../headers";

const defaultLeaseOrchestrator = new LeaseOrchestrator();

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

  // Calculate Credit Units (CU) from cascadeRes.usage
  let cu = 0n;
  if (cascadeRes.usage) {
    const modelDef =
      cascadeRes.modelDef ??
      deps.modelRegistry?.getModel?.(cascadeRes.model) ??
      deps.modelRegistry?.resolveModel?.(cascadeRes.model);
    if (modelDef) {
      cu = calculateCu(modelDef, cascadeRes.usage);
    }
  }

  // Asynchronous background task for D1 persistence and telemetry
  const postWork = async (): Promise<void> => {
    const activeLease = cascadeRes.lease;
    const keyId = activeLease?.keyId ?? cascadeRes.keyId ?? "";
    if (activeLease) {
      const leaseCtx = cascadeRes.leaseContext ?? {
        tenantId: authContext.tenantId,
        env,
      };
      const settleCu = cu > 0n ? cu : (cascadeRes.modelDef?.cuBase ?? 10n);
      await defaultLeaseOrchestrator
        .settle(activeLease, "ok", leaseCtx, settleCu)
        .catch(() => {
          // Non-blocking settlement
        });
    }

    // 2. Record event to D1 Cost Ledger (Golden Test tc-01)
    const costLedgerRepo = deps.getCostLedgerRepo(env);
    if (costLedgerRepo) {
      try {
        const isBorrowed = activeLease?.source === "borrowed" ? 1 : 0;
        const lenderTenantId =
          activeLease?.source === "borrowed" ? activeLease.ownerTenantId : null;
        await costLedgerRepo.recordEvent({
          requestId: traceId,
          tenantId: authContext.tenantId,
          keyId,
          provider: cascadeRes.provider,
          modelId: cascadeRes.model,
          promptTokens: cascadeRes.usage?.promptTokens ?? 0,
          completionTokens: cascadeRes.usage?.completionTokens ?? 0,
          cachedTokens: cascadeRes.usage?.cachedTokens ?? 0,
          reasoningTokens: cascadeRes.usage?.reasoningTokens ?? 0,
          costMicrodollars,
          cu: cu > 0n ? cu : undefined,
          borrowed: isBorrowed,
          lenderTenantId,
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

  const workPromise = postWork();
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(workPromise);
  }
  await workPromise;

  // Obtain upstream JSON response if available
  let upstreamJson: Record<string, unknown> = {};
  if (cascadeRes.response && typeof cascadeRes.response.json === "function") {
    try {
      const parsed = await cascadeRes.response.json<Record<string, unknown>>();
      if (parsed && typeof parsed === "object") {
        upstreamJson = parsed;
      }
    } catch {
      // Fall back if response is not valid JSON
    }
  }

  // Safely resolve model id using optional chaining (Reviewer feedback point 1)
  const resolvedModelDef =
    deps.modelRegistry?.getModel?.(cascadeRes.model) ??
    deps.modelRegistry?.resolveModel?.(cascadeRes.model) ??
    cascadeRes.modelDef;
  const resolvedModelId = resolvedModelDef?.id ?? cascadeRes.model;

  // Extract usage for CU calculation
  const usageObj = (upstreamJson.usage as Record<string, unknown> | undefined) ?? {};
  const promptTokens =
    cascadeRes.usage?.promptTokens ??
    (typeof usageObj.prompt_tokens === "number" ? usageObj.prompt_tokens : 0);
  const completionTokens =
    cascadeRes.usage?.completionTokens ??
    (typeof usageObj.completion_tokens === "number" ? usageObj.completion_tokens : 0);
  const cachedTokens =
    cascadeRes.usage?.cachedTokens ??
    (typeof usageObj.prompt_tokens_details === "object" &&
    usageObj.prompt_tokens_details !== null &&
    "cached_tokens" in usageObj.prompt_tokens_details
      ? Number((usageObj.prompt_tokens_details as { cached_tokens?: number }).cached_tokens)
      : typeof usageObj.cached_tokens === "number"
      ? usageObj.cached_tokens
      : 0);
  const reasoningTokens =
    cascadeRes.usage?.reasoningTokens ??
    (typeof usageObj.completion_tokens_details === "object" &&
    usageObj.completion_tokens_details !== null &&
    "reasoning_tokens" in usageObj.completion_tokens_details
      ? Number((usageObj.completion_tokens_details as { reasoning_tokens?: number }).reasoning_tokens)
      : typeof usageObj.reasoning_tokens === "number"
      ? usageObj.reasoning_tokens
      : 0);

  const effectiveUsage: TokenUsage = {
    promptTokens,
    completionTokens,
    cachedTokens,
    reasoningTokens,
  };

  let calculatedCu = cu;
  if (calculatedCu === 0n && (upstreamJson.usage || costMicrodollars > 0n)) {
    if (deps.modelRegistry) {
      try {
        const registry = deps.modelRegistry as unknown as {
          calculateCu?: (model: string, usage: TokenUsage) => bigint;
          calculateCost?: (model: string, usage: TokenUsage) => bigint;
        };
        if (typeof registry.calculateCu === "function") {
          calculatedCu = registry.calculateCu(cascadeRes.model, effectiveUsage);
        }
      } catch {
        // Fall back below
      }
    }

    if (calculatedCu === 0n && cascadeRes.modelDef) {
      try {
        calculatedCu = calculateCu(cascadeRes.modelDef, effectiveUsage);
      } catch {
        // Fall back below
      }
    }

    if (calculatedCu === 0n && deps.modelRegistry) {
      try {
        calculatedCu = deps.modelRegistry.calculateCost(cascadeRes.model, effectiveUsage);
      } catch {
        // Fall back below
      }
    }

    if (calculatedCu === 0n && costMicrodollars > 0n) {
      calculatedCu = costMicrodollars;
    }
  }

  // Base usage object
  const baseUsage = (upstreamJson.usage as Record<string, unknown> | undefined) ?? (cascadeRes.usage
    ? {
        prompt_tokens: cascadeRes.usage.promptTokens,
        completion_tokens: cascadeRes.usage.completionTokens,
        total_tokens: cascadeRes.usage.totalTokens,
      }
    : {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      });

  const finalUsage = {
    ...baseUsage,
    kc_cu: Number(calculatedCu),
  };

  // Return upstream JSON with only edits to:
  // id: prefixed with chatcmpl-
  // model: resolved upstream model id
  // usage.kc_cu added
  // object: defaulted to 'chat.completion' (Reviewer feedback point 2)
  // choices[].message.tool_calls, finish_reason, logprobs survive untouched
  const formattedId = traceId.startsWith("chatcmpl-") ? traceId : `chatcmpl-${traceId}`;

  const payload: Record<string, unknown> = {
    ...upstreamJson,
    id: formattedId,
    object: (upstreamJson.object as string) ?? "chat.completion",
    created: (upstreamJson.created as number) ?? Math.floor(startTime / 1000),
    model: resolvedModelId,
    choices: (upstreamJson.choices as unknown[]) ?? [
      {
        index: 0,
        message: {
          role: "assistant",
          content: cascadeRes.content,
        },
        finish_reason: "stop",
      },
    ],
    usage: finalUsage,
    cost_microdollars: (upstreamJson.cost_microdollars as string) ?? costMicrodollars.toString(),
  };

  const rawResponse =
    deps.options.responseFormat === "kc_api"
      ? new Response(
          JSON.stringify(
            createApiResponse(payload, {
              latencyMs: durationMs,
              costMicrodollars: costMicrodollars.toString(),
              traceId,
              requestId: traceId,
              timestamp: startTime,
              provider: cascadeRes.provider,
              model: resolvedModelId,
            })
          ),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
          }
        )
      : Response.json(payload, {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        });

  return applyKcHeaders(rawResponse, {
    requestId: traceId,
    traceId,
    modelUsed: resolvedModelId,
    provider: cascadeRes.provider,
    attempts: cascadeRes.attempts,
    cu: calculatedCu.toString(),
    costMicrodollars: costMicrodollars.toString(),
    isStream: false,
  });
}

export const handleNonStreamingChat = handleNonStreamingResponse;

