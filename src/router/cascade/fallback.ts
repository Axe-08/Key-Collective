/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Cascade Router Subsystem: Fallback Escalation & Upstream Dispatcher
 *
 * Conforms to:
 * - LLD 2.3: Upstream execution, key acquisition, fallback escalation on error.
 * - Golden Test tc-01: Routes requests to provider keys with success 200 response and cost calculation.
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no `any`).
 * - Fixed-Point Microdollars: All costs in int64 / bigint microdollars. Zero floating-point math.
 * - Non-blocking hot path: Non-blocking KeyPool usage and telemetry recording.
 */

import type { RouteRequest } from "../../contracts/router";
import type { KeyPoolContract } from "../../contracts/key_pool";
import type { IModelRegistry } from "../model_registry";
import {
  type UpstreamClient,
  type UpstreamChatRequest,
} from "../../proxy/upstream_client";
import type { ModelDef } from "../../types/models";
import {
  FallbackExhaustedError,
  type FallbackAttempt,
} from "../../errors";
import type {
  CascadeRouteRequest,
  CascadeRouteResponse,
  CascadeRouterOptions,
} from "./types";

/**
 * Execution context required to run cascade routing with fallbacks.
 */
export interface FallbackExecutionContext {
  registry: IModelRegistry;
  upstreamClient: UpstreamClient;
  keyPool?: KeyPoolContract;
  maxFallbacks: number;
  options: CascadeRouterOptions;
  checkSelfKeyAvailable?: (provider: string, tenantId: string) => Promise<boolean>;
}

/**
 * Executes multi-model cascade routing across ordered candidate models.
 * Automatically acquires credentials from KeyPool, executes upstream chat calls,
 * and escalates to fallback candidates if errors arise.
 *
 * @param request Inbound route request
 * @param candidates Non-empty ordered array of candidate models
 * @param context Dependencies and configuration for fallback execution
 * @returns Detailed route response upon success
 * @throws FallbackExhaustedError (HTTP 502) if all candidates fail
 */
export async function executeCascadeRouting(
  request: RouteRequest | CascadeRouteRequest,
  candidates: ModelDef<bigint>[],
  context: FallbackExecutionContext
): Promise<CascadeRouteResponse> {
  const reqOptions = request as CascadeRouteRequest;
  const maxFallbacks = reqOptions.maxFallbacks ?? context.maxFallbacks;
  const candidatesToTry = candidates.slice(0, 1 + maxFallbacks);

  const attempts: FallbackAttempt[] = [];

  // 1. Self-Key Priority Pre-check
  let selfKeyRouted = false;
  if (reqOptions.tenantId && candidatesToTry.length > 0 && context.checkSelfKeyAvailable) {
    selfKeyRouted = await context.checkSelfKeyAvailable(
      candidatesToTry[0].provider,
      reqOptions.tenantId
    );
  }

  // 2. Iterate through candidates with fallback escalation
  for (let i = 0; i < candidatesToTry.length; i++) {
    const candidate = candidatesToTry[i];
    const nextCandidate = candidatesToTry[i + 1];

    // Check external abort signal
    if (reqOptions.signal?.aborted) {
      throw new DOMException("Request was aborted", "AbortError");
    }

    let apiKey = reqOptions.apiKey;
    let keyId: string | undefined;

    // 3. Acquire key from KeyPool if available and no explicit key supplied
    if (!apiKey && context.keyPool) {
      try {
        keyId = await context.keyPool.getKey(candidate.provider);
        apiKey = keyId;
      } catch (keyErr) {
        const errMsg = keyErr instanceof Error ? keyErr.message : String(keyErr);
        const attempt: FallbackAttempt = {
          provider: candidate.provider,
          modelId: candidate.id,
          error: `Key acquisition failed: ${errMsg}`,
        };
        attempts.push(attempt);
        context.options.onFallback?.(attempt, nextCandidate);
        continue; // Escalate immediately to next candidate model
      }
    }

    // 4. Construct upstream chat request
    const maxTokens =
      reqOptions.maxTokens ??
      reqOptions.max_tokens ??
      reqOptions.max_completion_tokens ??
      context.options.defaultMaxTokens;

    const chatRequest: UpstreamChatRequest = {
      provider: candidate.provider,
      model: candidate.id,
      messages: request.messages,
      stream: request.stream,
      apiKey,
      keyId,
      temperature: reqOptions.temperature ?? context.options.defaultTemperature,
      maxTokens,
      headers: reqOptions.headers,
      timeoutMs: reqOptions.timeoutMs,
      extraBodyParams: {
        ...context.options.extraBodyParams,
        ...reqOptions.extraBodyParams,
        ...(reqOptions.tools ? { tools: reqOptions.tools } : {}),
        ...(reqOptions.functions ? { functions: reqOptions.functions } : {}),
        ...(reqOptions.tool_choice ? { tool_choice: reqOptions.tool_choice } : {}),
        ...(reqOptions.function_call ? { function_call: reqOptions.function_call } : {}),
        ...(reqOptions.response_format
          ? { response_format: reqOptions.response_format }
          : {}),
      },
    };

    // 5. Execute call via UpstreamClient
    try {
      const chatRes = await context.upstreamClient.chat(chatRequest);

      // 6. Calculate or verify fixed-point microdollar cost
      let costMicrodollars = chatRes.costMicrodollars;
      if ((costMicrodollars === 0n || costMicrodollars === undefined) && chatRes.usage) {
        try {
          costMicrodollars = context.registry.calculateCost(candidate.id, chatRes.usage);
        } catch {
          costMicrodollars = 0n;
        }
      }

      // 7. Record KeyPool success and usage (non-blocking hot path)
      if (context.keyPool && keyId) {
        if (typeof context.keyPool.recordDispatch === "function") {
          try {
            context.keyPool.recordDispatch(keyId, !selfKeyRouted);
          } catch {}
        }
        context.keyPool.recordResult(keyId, true).catch(() => {});
        if (costMicrodollars > 0n) {
          context.keyPool.recordUsage(keyId, costMicrodollars).catch(() => {});
        }
      }

      // 8. Build success response
      const successResponse: CascadeRouteResponse = {
        content: chatRes.content,
        costMicrodollars,
        model: candidate.id,
        provider: candidate.provider,
        modelDef: candidate,
        attempts,
        usage: chatRes.usage,
        response: chatRes.response,
        isSelfKey: selfKeyRouted,
      };

      context.options.onSuccess?.(successResponse);
      return successResponse;
    } catch (upstreamErr) {
      // Respect external cancellation without fallback loop
      if (
        upstreamErr instanceof Error &&
        (upstreamErr.name === "AbortError" || reqOptions.signal?.aborted)
      ) {
        throw upstreamErr;
      }

      // Record failure against KeyPool (non-blocking)
      if (context.keyPool && keyId) {
        context.keyPool.recordResult(keyId, false).catch(() => {});
      }

      const errMsg =
        upstreamErr instanceof Error ? upstreamErr.message : String(upstreamErr);

      const attempt: FallbackAttempt = {
        provider: candidate.provider,
        modelId: candidate.id,
        error: errMsg,
      };
      attempts.push(attempt);
      context.options.onFallback?.(attempt, nextCandidate);

      // Loop continues to attempt nextCandidate
    }
  }

  // 9. All candidate routes exhausted
  throw new FallbackExhaustedError(
    attempts,
    `Cascade routing exhausted all ${attempts.length} candidate route(s) without success`
  );
}
