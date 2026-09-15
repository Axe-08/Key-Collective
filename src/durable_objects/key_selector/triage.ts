/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Key Triage & Capacity Filtering
 */

import { DEFAULT_RETRY_AFTER_SECONDS } from "../../constants/limits";
import type { CircuitBreaker, CircuitBreakerState } from "../circuit_breaker";
import type { RateLimiter } from "../rate_limiter";
import type {
  KeyTriageItem,
  KeyTriageResult,
  SelectableKey,
} from "./types";

/**
 * Checks whether a key's static status allows execution.
 */
export function isStatusPermitted(status?: string): {
  permitted: boolean;
  reason?: "disabled" | "invalid" | "exhausted";
} {
  if (!status) {
    return { permitted: true };
  }
  const s = status.toLowerCase();
  if (s === "disabled") {
    return { permitted: false, reason: "disabled" };
  }
  if (s === "invalid") {
    return { permitted: false, reason: "invalid" };
  }
  if (s === "exhausted") {
    return { permitted: false, reason: "exhausted" };
  }
  return { permitted: true };
}

export interface TriageContext<TKey extends SelectableKey = SelectableKey> {
  candidates: TKey[];
  provider?: string;
  costMicrodollars: bigint;
  circuitBreaker?: CircuitBreaker;
  rateLimiter?: RateLimiter;
  now: () => number;
}

/**
 * Evaluates key health and capacity asynchronously, returning full triage diagnostics.
 */
export async function triageKeysAsync<TKey extends SelectableKey = SelectableKey>(
  ctx: TriageContext<TKey>
): Promise<KeyTriageResult<TKey>> {
  const { candidates, provider, costMicrodollars, circuitBreaker, rateLimiter, now } = ctx;

  const healthyKeys: TKey[] = [];
  const unhealthyKeys: KeyTriageItem<TKey>[] = [];
  const rateLimitedKeys: KeyTriageItem<TKey>[] = [];
  const circuitBrokenKeys: KeyTriageItem<TKey>[] = [];
  const disabledKeys: KeyTriageItem<TKey>[] = [];

  const retryDelays: number[] = [];

  for (const key of candidates) {
    // 1. Static status check
    const statusCheck = isStatusPermitted(key.status);
    if (!statusCheck.permitted) {
      const item: KeyTriageItem<TKey> = {
        key,
        healthy: false,
        reason: statusCheck.reason,
      };
      unhealthyKeys.push(item);
      disabledKeys.push(item);
      continue;
    }

    // 2. Circuit Breaker check
    let cbAllowed = true;
    let cbRetryAfter = 0;
    let cbOpenUntil: string | null = null;
    let cbState: CircuitBreakerState = "CLOSED";

    if (circuitBreaker) {
      cbAllowed = await circuitBreaker.canExecute(key.id);
      cbState = await circuitBreaker.getState(key.id);
      if (!cbAllowed) {
        cbRetryAfter = await circuitBreaker.getRetryAfterSeconds(key.id);
        cbOpenUntil = await circuitBreaker.getCircuitOpenUntil(key.id);
      }
    } else if (key.circuitOpenUntil) {
      const openUntilMs = Date.parse(key.circuitOpenUntil);
      if (!isNaN(openUntilMs) && openUntilMs > now()) {
        cbAllowed = false;
        cbRetryAfter = Math.max(1, Math.ceil((openUntilMs - now()) / 1000));
        cbOpenUntil = key.circuitOpenUntil;
        cbState = "OPEN";
      }
    }

    if (!cbAllowed) {
      const retry = cbRetryAfter > 0 ? cbRetryAfter : DEFAULT_RETRY_AFTER_SECONDS;
      retryDelays.push(retry);
      const item: KeyTriageItem<TKey> = {
        key,
        healthy: false,
        reason: "circuit_breaker_open",
        retryAfterSeconds: retry,
        circuitOpenUntil: cbOpenUntil,
        circuitBreakerState: cbState,
      };
      unhealthyKeys.push(item);
      circuitBrokenKeys.push(item);
      continue;
    }

    // 3. Rate Limiter capacity check
    let rlAllowed = true;
    let rlRetryAfter = 0;
    let currentRpm: number | undefined;
    let remainingRpm: number | undefined;
    let rlReason: "rate_limit_exceeded" | "budget_exceeded" | undefined;

    if (rateLimiter) {
      const limitResult = await rateLimiter.checkLimitDetailed(key.id, costMicrodollars);
      rlAllowed = limitResult.allowed;
      currentRpm = limitResult.currentRpm;
      remainingRpm = Math.max(0, limitResult.rpmLimit - limitResult.currentRpm);

      if (!rlAllowed) {
        rlRetryAfter = limitResult.retryAfterSeconds;
        rlReason =
          limitResult.reason === "budget_exceeded"
            ? "budget_exceeded"
            : "rate_limit_exceeded";
      }
    }

    if (!rlAllowed) {
      const retry = rlRetryAfter > 0 ? rlRetryAfter : DEFAULT_RETRY_AFTER_SECONDS;
      retryDelays.push(retry);
      const item: KeyTriageItem<TKey> = {
        key,
        healthy: false,
        reason: rlReason ?? "rate_limit_exceeded",
        retryAfterSeconds: retry,
        currentRpm,
        remainingRpm,
      };
      unhealthyKeys.push(item);
      rateLimitedKeys.push(item);
      continue;
    }

    // Key passed all filters
    healthyKeys.push(key);
  }

  const minRetryAfterSeconds =
    retryDelays.length > 0
      ? Math.min(...retryDelays)
      : DEFAULT_RETRY_AFTER_SECONDS;

  return {
    provider,
    totalKeys: candidates.length,
    healthyKeys,
    unhealthyKeys,
    rateLimitedKeys,
    circuitBrokenKeys,
    disabledKeys,
    minRetryAfterSeconds,
  };
}

/**
 * Synchronous triage check using in-memory state.
 */
export function triageKeysSync<TKey extends SelectableKey = SelectableKey>(
  ctx: TriageContext<TKey>
): KeyTriageResult<TKey> {
  const { candidates, provider, costMicrodollars, circuitBreaker, rateLimiter, now } = ctx;

  const healthyKeys: TKey[] = [];
  const unhealthyKeys: KeyTriageItem<TKey>[] = [];
  const rateLimitedKeys: KeyTriageItem<TKey>[] = [];
  const circuitBrokenKeys: KeyTriageItem<TKey>[] = [];
  const disabledKeys: KeyTriageItem<TKey>[] = [];

  const retryDelays: number[] = [];

  for (const key of candidates) {
    // 1. Static status check
    const statusCheck = isStatusPermitted(key.status);
    if (!statusCheck.permitted) {
      const item: KeyTriageItem<TKey> = {
        key,
        healthy: false,
        reason: statusCheck.reason,
      };
      unhealthyKeys.push(item);
      disabledKeys.push(item);
      continue;
    }

    // 2. Circuit Breaker sync check
    let cbAllowed = true;
    let cbRetryAfter = 0;
    let cbState: CircuitBreakerState = "CLOSED";

    if (circuitBreaker) {
      cbAllowed = circuitBreaker.canExecuteSync(key.id);
      cbState = circuitBreaker.getStateSync(key.id);
      if (!cbAllowed) {
        const cbData = circuitBreaker.getDataSync(key.id);
        if (cbData && cbData.openedAt !== null) {
          const rem = cbData.openedAt + circuitBreaker.cooldownMs - now();
          cbRetryAfter = rem > 0 ? Math.ceil(rem / 1000) : 1;
        }
      }
    } else if (key.circuitOpenUntil) {
      const openUntilMs = Date.parse(key.circuitOpenUntil);
      if (!isNaN(openUntilMs) && openUntilMs > now()) {
        cbAllowed = false;
        cbRetryAfter = Math.max(1, Math.ceil((openUntilMs - now()) / 1000));
        cbState = "OPEN";
      }
    }

    if (!cbAllowed) {
      const retry = cbRetryAfter > 0 ? cbRetryAfter : DEFAULT_RETRY_AFTER_SECONDS;
      retryDelays.push(retry);
      const item: KeyTriageItem<TKey> = {
        key,
        healthy: false,
        reason: "circuit_breaker_open",
        retryAfterSeconds: retry,
        circuitBreakerState: cbState,
      };
      unhealthyKeys.push(item);
      circuitBrokenKeys.push(item);
      continue;
    }

    // 3. Rate Limiter sync check
    let rlAllowed = true;
    if (rateLimiter) {
      rlAllowed = rateLimiter.checkLimitSync(key.id, costMicrodollars);
    }

    if (!rlAllowed) {
      const retry = DEFAULT_RETRY_AFTER_SECONDS;
      retryDelays.push(retry);
      const item: KeyTriageItem<TKey> = {
        key,
        healthy: false,
        reason: "rate_limit_exceeded",
        retryAfterSeconds: retry,
      };
      unhealthyKeys.push(item);
      rateLimitedKeys.push(item);
      continue;
    }

    healthyKeys.push(key);
  }

  const minRetryAfterSeconds =
    retryDelays.length > 0
      ? Math.min(...retryDelays)
      : DEFAULT_RETRY_AFTER_SECONDS;

  return {
    provider,
    totalKeys: candidates.length,
    healthyKeys,
    unhealthyKeys,
    rateLimitedKeys,
    circuitBrokenKeys,
    disabledKeys,
    minRetryAfterSeconds,
  };
}
