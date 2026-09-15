/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Key Selection Strategies
 */

import type { RateLimiter } from "../rate_limiter";
import type { SelectableKey } from "./types";

export interface StrategyContext<TKey extends SelectableKey = SelectableKey> {
  provider: string;
  healthyKeys: TKey[];
  rateLimiter?: RateLimiter;
  getUsageCount: (keyId: string) => number;
  getRoundRobinIndex: (provider: string) => Promise<number>;
  persistRoundRobinIndex: (provider: string, nextIndex: number) => Promise<void>;
  getRoundRobinIndexSync: (provider: string) => number;
  setRoundRobinIndexSync: (provider: string, nextIndex: number) => void;
}

/**
 * Implements Round-Robin selection over candidate keys.
 */
export async function selectRoundRobin<TKey extends SelectableKey = SelectableKey>(
  ctx: StrategyContext<TKey>
): Promise<TKey> {
  const { provider, healthyKeys, getRoundRobinIndex, persistRoundRobinIndex } = ctx;
  const currentIndex = await getRoundRobinIndex(provider);
  const selected = healthyKeys[currentIndex % healthyKeys.length]!;
  const nextIndex = (currentIndex + 1) % 1_000_000;
  await persistRoundRobinIndex(provider, nextIndex);
  return selected;
}

/**
 * Synchronous Round-Robin selection over candidate keys.
 */
export function selectRoundRobinSync<TKey extends SelectableKey = SelectableKey>(
  ctx: StrategyContext<TKey>
): TKey {
  const { provider, healthyKeys, getRoundRobinIndexSync, setRoundRobinIndexSync } = ctx;
  const currentIndex = getRoundRobinIndexSync(provider);
  const selected = healthyKeys[currentIndex % healthyKeys.length]!;
  const nextIndex = (currentIndex + 1) % 1_000_000;
  setRoundRobinIndexSync(provider, nextIndex);
  return selected;
}

/**
 * Implements Least-Used / Load-Balanced selection.
 * Prioritizes keys with lowest current RPM load, breaking ties with total invocation counts.
 */
export async function selectLeastUsed<TKey extends SelectableKey = SelectableKey>(
  ctx: StrategyContext<TKey>
): Promise<TKey> {
  const { healthyKeys, rateLimiter, getUsageCount } = ctx;
  let bestKey = healthyKeys[0]!;
  let minLoad = Infinity;

  for (const key of healthyKeys) {
    let load = 0;
    if (rateLimiter) {
      load = await rateLimiter.getCurrentRpm(key.id);
    } else {
      load = getUsageCount(key.id);
    }

    if (load < minLoad) {
      minLoad = load;
      bestKey = key;
    } else if (load === minLoad) {
      const bestUsage = getUsageCount(bestKey.id);
      const candidateUsage = getUsageCount(key.id);
      if (candidateUsage < bestUsage) {
        bestKey = key;
      }
    }
  }

  return bestKey;
}

/**
 * Synchronous Least-Used selection.
 */
export function selectLeastUsedSync<TKey extends SelectableKey = SelectableKey>(
  ctx: StrategyContext<TKey>
): TKey {
  const { healthyKeys, rateLimiter, getUsageCount } = ctx;
  let bestKey = healthyKeys[0]!;
  let minLoad = Infinity;

  for (const key of healthyKeys) {
    let load = 0;
    if (rateLimiter) {
      const rlData = rateLimiter.getDataSync(key.id);
      if (rlData) {
        load = rlData.entries.reduce((acc, e) => acc + e.count, 0);
      }
    } else {
      load = getUsageCount(key.id);
    }

    if (load < minLoad) {
      minLoad = load;
      bestKey = key;
    } else if (load === minLoad) {
      const bestUsage = getUsageCount(bestKey.id);
      const candidateUsage = getUsageCount(key.id);
      if (candidateUsage < bestUsage) {
        bestKey = key;
      }
    }
  }

  return bestKey;
}

/**
 * Implements Priority-based selection.
 * Selects highest priority keys, breaking ties with round-robin or least-used.
 */
export async function selectPriority<TKey extends SelectableKey = SelectableKey>(
  ctx: StrategyContext<TKey>,
  tieBreaker: "round-robin" | "least-used" = "round-robin"
): Promise<TKey> {
  const { healthyKeys } = ctx;
  let maxPriority = -Infinity;
  for (const key of healthyKeys) {
    const p = key.priority ?? 0;
    if (p > maxPriority) {
      maxPriority = p;
    }
  }

  const topTier = healthyKeys.filter((k) => (k.priority ?? 0) === maxPriority);
  if (topTier.length === 1) {
    return topTier[0]!;
  }

  const tierCtx: StrategyContext<TKey> = {
    ...ctx,
    healthyKeys: topTier,
  };

  if (tieBreaker === "least-used") {
    return selectLeastUsed(tierCtx);
  }
  return selectRoundRobin(tierCtx);
}

/**
 * Synchronous Priority selection.
 */
export function selectPrioritySync<TKey extends SelectableKey = SelectableKey>(
  ctx: StrategyContext<TKey>,
  tieBreaker: "round-robin" | "least-used" = "round-robin"
): TKey {
  const { healthyKeys } = ctx;
  let maxPriority = -Infinity;
  for (const key of healthyKeys) {
    const p = key.priority ?? 0;
    if (p > maxPriority) {
      maxPriority = p;
    }
  }

  const topTier = healthyKeys.filter((k) => (k.priority ?? 0) === maxPriority);
  if (topTier.length === 1) {
    return topTier[0]!;
  }

  const tierCtx: StrategyContext<TKey> = {
    ...ctx,
    healthyKeys: topTier,
  };

  if (tieBreaker === "least-used") {
    return selectLeastUsedSync(tierCtx);
  }
  return selectRoundRobinSync(tierCtx);
}
