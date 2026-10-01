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
import { calculateCu, type IModelRegistry } from "../registry/index";
import {
  type UpstreamClient,
  type UpstreamChatRequest,
} from "../../proxy/upstream/index";
import type { ModelDef } from "../../types/models";
import {
  FallbackExhaustedError,
  type FallbackAttempt,
} from "../../errors";
import type {
  Lease,
  LeaseAcquireContext,
  LeaseProvider,
} from "../leases/orchestrator";
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
  leaseProvider?: LeaseProvider;
  leaseContext?: LeaseAcquireContext;
  useLeases?: boolean;
  maxFallbacks: number;
  options: CascadeRouterOptions;
  checkSelfKeyAvailable?: (provider: string, tenantId: string) => Promise<boolean>;
}

function classifyErrorOutcome(err: unknown): { outcome: string; until?: number } {
  const status =
    err && typeof err === "object" && "upstreamStatusCode" in err
      ? Number((err as { upstreamStatusCode?: unknown }).upstreamStatusCode)
      : err && typeof err === "object" && "statusCode" in err
      ? Number((err as { statusCode?: unknown }).statusCode)
      : 0;
  const msg = err instanceof Error ? err.message : String(err);

  if (status === 401 || status === 403 || /API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) {
    return { outcome: "key_invalid" };
  }
  if (status === 429) {
    if (/PerDay|rpd/i.test(msg)) {
      return { outcome: "rpd_exhausted" };
    }
    return { outcome: "rpm_limited" };
  }
  if (status === 400) {
    return { outcome: "request_error" };
  }
  return { outcome: "upstream_error" };
}

/**
 * Executes multi-model cascade routing across ordered candidate models.
 * Automatically acquires credentials from KeyPool (legacy) or LeaseProvider (leases),
 * executes upstream chat calls, and escalates to fallback candidates if errors arise.
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
  const useLeases = Boolean(
    context.useLeases && (context.leaseProvider ?? context.options.leaseProvider)
  );
  const leaseProvider = context.leaseProvider ?? context.options.leaseProvider;

  // On the lease path, allow scanning across all candidate models so if the cheapest provider
  // has 0 keys (e.g. a Groq-only tenant calling `auto` when 6 Gemini models sort cheaper),
  // we skip the empty provider and reach the tenant's Groq model without exhausting early.
  const candidatesToTry = useLeases
    ? candidates
    : candidates.slice(0, 1 + maxFallbacks);

  const attempts: FallbackAttempt[] = [];
  const emptyProviders = new Set<string>();
  let upstreamAttempts = 0;
  const maxUpstreamAttempts = 1 + maxFallbacks;

  // 1. Self-Key Priority Pre-check (legacy path only; unused on lease path per WP-4.1)
  let selfKeyRouted = false;
  if (
    !useLeases &&
    reqOptions.tenantId &&
    candidatesToTry.length > 0 &&
    context.checkSelfKeyAvailable
  ) {
    selfKeyRouted = await context.checkSelfKeyAvailable(
      candidatesToTry[0].provider,
      reqOptions.tenantId
    );
  }

  // 2. Iterate through candidates with fallback escalation
  for (let i = 0; i < candidatesToTry.length; i++) {
    if (useLeases && upstreamAttempts >= maxUpstreamAttempts) {
      break;
    }

    const candidate = candidatesToTry[i];
    const nextCandidate = candidatesToTry[i + 1];

    // Check external abort signal
    if (reqOptions.signal?.aborted) {
      throw new DOMException("Request was aborted", "AbortError");
    }

    // On the lease path, if a provider already returned null lease (no keys available),
    // skip remaining models of that same provider without re-querying the DOs.
    if (useLeases && emptyProviders.has(candidate.provider)) {
      continue;
    }

    let apiKey = reqOptions.apiKey;
    let keyId: string | undefined;
    let activeLease: Lease | undefined;
    let activeLeaseCtx: LeaseAcquireContext | undefined;

    if (useLeases && leaseProvider && !apiKey) {
      const estTokens = BigInt(Math.max(0, reqOptions.estimatedPromptTokens ?? 0));
      const estCu =
        (candidate.cuBase ?? 10n) +
        ((estTokens + 999n) / 1000n) * (candidate.cuInPer1k ?? 1n);

      activeLeaseCtx = reqOptions.leaseContext ??
        context.leaseContext ??
        context.options.leaseContext ?? {
          tenantId: reqOptions.tenantId ?? "default",
          env: {},
          estimateCu: estCu,
        };
      if (activeLeaseCtx.estimateCu === undefined) {
        activeLeaseCtx = { ...activeLeaseCtx, estimateCu: estCu };
      }

      try {
        const lease = await leaseProvider.acquire(candidate.provider, activeLeaseCtx);
        if (!lease) {
          emptyProviders.add(candidate.provider);
          const attempt: FallbackAttempt = {
            provider: candidate.provider,
            modelId: candidate.id,
            error: `No lease available for provider '${candidate.provider}'`,
          };
          attempts.push(attempt);
          context.options.onFallback?.(attempt, nextCandidate);
          continue;
        }
        activeLease = lease;
        keyId = lease.keyId;
        apiKey = lease.keyId;
      } catch (leaseErr) {
        const errMsg = leaseErr instanceof Error ? leaseErr.message : String(leaseErr);
        const attempt: FallbackAttempt = {
          provider: candidate.provider,
          modelId: candidate.id,
          error: `Lease acquisition failed: ${errMsg}`,
        };
        attempts.push(attempt);
        context.options.onFallback?.(attempt, nextCandidate);
        continue;
      }
    } else if (!apiKey && context.keyPool) {
      // 3. Legacy path: Acquire key from KeyPool if available and no explicit key supplied
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

    upstreamAttempts += 1;

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
      recordPoolUsage: !useLeases,
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

      if (useLeases && activeLease && activeLeaseCtx && leaseProvider) {
        // For non-streaming requests, settle immediately (idempotent if also settled in postWork)
        if (!request.stream) {
          const actualCu = chatRes.usage
            ? calculateCu(candidate, chatRes.usage)
            : (candidate.cuBase ?? 10n);
          await leaseProvider.settle(activeLease, "ok", activeLeaseCtx, actualCu);
        }
      } else if (context.keyPool && keyId) {
        // 7. Legacy: Record KeyPool success and usage (non-blocking hot path)
        if (typeof context.keyPool.recordDispatch === "function") {
          try {
            context.keyPool.recordDispatch(keyId, !selfKeyRouted);
          } catch (err) {
            void err;
          }
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
        isSelfKey: useLeases
          ? activeLease?.source !== "borrowed"
          : selfKeyRouted,
        lease: activeLease,
        leaseContext: activeLeaseCtx,
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

      if (useLeases && activeLease && activeLeaseCtx && leaseProvider) {
        const { outcome, until } = classifyErrorOutcome(upstreamErr);
        await leaseProvider
          .settle(activeLease, outcome, activeLeaseCtx, 0n, until)
          .catch(() => {});
      } else if (context.keyPool && keyId) {
        // Record failure against KeyPool (non-blocking)
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
