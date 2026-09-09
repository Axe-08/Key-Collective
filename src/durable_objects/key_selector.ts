/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * KeySelector Logic for Triage and Capacity Filtering
 *
 * Conforms to LLD 3.3:
 * - Logic: Filters out rate-limited or circuit-broken keys.
 * - Selection: Implements Round-Robin or Least-Used selection among healthy keys.
 * - Prioritization: Supports priority-tier sorting with tie-breaking.
 * - Multi-provider fallback: Fallback to alternative healthy providers when preferred is exhausted.
 *
 * Invariants (GEMINI.md):
 * - Strict TypeScript (strict mode, no `any`).
 * - Fixed-Point Microdollars: All costs in `int64` / `bigint` microdollars (1 USD = 1,000,000 µ$). Zero floating-point math.
 * - Per-Tenant DO Isolation: Zero cross-tenant state.
 * - Non-Blocking Telemetry: Fast in-memory key triage and selection.
 */

import {
  DEFAULT_RETRY_AFTER_SECONDS,
  DEFAULT_RPM_LIMIT,
} from "../constants/limits";
import { KeyMetrics } from "../contracts/key_pool";
import { KeyExhaustedError } from "../errors/key_errors";
import { RoutingStrategy } from "../types/config";
import { KeyStatus } from "../types/models";
import type {
  CircuitBreaker,
  CircuitBreakerState,
  DurableObjectStorageLike,
} from "./circuit_breaker";
import type { RateLimiter } from "./rate_limiter";

/**
 * Common interface satisfied by both APIKey and EncryptedKey.
 * Allows KeySelector to operate generically across storage representations.
 */
export interface SelectableKey {
  id: string;
  provider: string;
  tenantId?: string;
  label?: string;
  priority?: number;
  status?: KeyStatus | string;
  rpmLimit?: number;
  rpdLimit?: number;
  circuitOpenUntil?: string | null;
  lastUsedAt?: string | number | null;
}

/**
 * Key selection strategy modes.
 */
export type KeySelectionStrategy =
  | "round-robin"
  | "least-used"
  | "load-balanced"
  | "priority"
  | "random"
  | RoutingStrategy;

/**
 * Options for configuring a KeySelector instance.
 */
export interface KeySelectorOptions<TKey extends SelectableKey = SelectableKey> {
  /** Optional tenant identifier for scoping and error reporting */
  tenantId?: string;
  /** Initial pool of keys */
  keys?: TKey[];
  /** Circuit breaker instance for health checks */
  circuitBreaker?: CircuitBreaker;
  /** Rate limiter instance for sliding window capacity checks */
  rateLimiter?: RateLimiter;
  /** Default selection strategy (defaults to "round-robin") */
  defaultStrategy?: KeySelectionStrategy;
  /** Optional DO transactional storage for persisting round-robin pointers */
  storage?: DurableObjectStorageLike;
  /** Prefix for storage keys in DO storage (defaults to "ks:") */
  storageKeyPrefix?: string;
  /** Injectable time provider for deterministic testing (defaults to Date.now) */
  timeProvider?: () => number;
}

/**
 * Options passed to selectKey() invocations.
 */
export interface SelectKeyOptions<TKey extends SelectableKey = SelectableKey> {
  /** Selection strategy override for this call */
  strategy?: KeySelectionStrategy;
  /** Estimated cost in microdollars to verify financial budget capacity */
  costMicrodollars?: bigint;
  /** Whether to throw KeyExhaustedError if no healthy keys are available (defaults to true) */
  throwOnExhausted?: boolean;
  /** Whether to fallback to any available healthy provider if preferred is exhausted */
  fallbackToAnyProvider?: boolean;
  /** Explicit candidate keys to select from, bypassing internal pool */
  candidateKeys?: TKey[];
}

/**
 * Detailed triage item for an individual key.
 */
export interface KeyTriageItem<TKey extends SelectableKey = SelectableKey> {
  key: TKey;
  healthy: boolean;
  reason?:
    | "healthy"
    | "disabled"
    | "invalid"
    | "exhausted"
    | "circuit_breaker_open"
    | "rate_limit_exceeded"
    | "budget_exceeded";
  retryAfterSeconds?: number;
  circuitOpenUntil?: string | null;
  circuitBreakerState?: CircuitBreakerState;
  currentRpm?: number;
  remainingRpm?: number;
}

/**
 * Comprehensive key triage result returned by triageKeys().
 */
export interface KeyTriageResult<TKey extends SelectableKey = SelectableKey> {
  provider?: string;
  totalKeys: number;
  healthyKeys: TKey[];
  unhealthyKeys: KeyTriageItem<TKey>[];
  rateLimitedKeys: KeyTriageItem<TKey>[];
  circuitBrokenKeys: KeyTriageItem<TKey>[];
  disabledKeys: KeyTriageItem<TKey>[];
  minRetryAfterSeconds: number;
}

/**
 * Capacity summary for a provider or the entire tenant pool.
 */
export interface CapacitySummary {
  provider?: string;
  totalKeys: number;
  healthyKeys: number;
  totalRpmLimit: number;
  currentRpm: number;
  remainingRpm: number;
  utilizationPercent: number;
}

/**
 * Type guard for SelectableKey.
 */
export function isSelectableKey(value: unknown): value is SelectableKey {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.provider === "string" &&
    candidate.id.trim().length > 0 &&
    candidate.provider.trim().length > 0
  );
}

/**
 * KeySelector coordinates key triage, capacity filtering, and selection algorithms
 * within Cloudflare Durable Objects.
 */
export class KeySelector<TKey extends SelectableKey = SelectableKey> {
  public readonly tenantId?: string;
  private readonly defaultStrategy: KeySelectionStrategy;
  private readonly storage?: DurableObjectStorageLike;
  private readonly storageKeyPrefix: string;
  private readonly timeProvider: () => number;

  private circuitBreaker?: CircuitBreaker;
  private rateLimiter?: RateLimiter;

  /**
   * Internal pool of keys keyed by key.id.
   */
  private readonly keysMap = new Map<string, TKey>();

  /**
   * In-memory round-robin pointer per normalized provider.
   */
  private readonly roundRobinIndices = new Map<string, number>();

  /**
   * In-memory invocation/usage counters per key ID for least-used selection.
   */
  private readonly usageCounts = new Map<string, number>();

  constructor(options?: KeySelectorOptions<TKey>) {
    this.tenantId = options?.tenantId;
    this.defaultStrategy = options?.defaultStrategy ?? "round-robin";
    this.circuitBreaker = options?.circuitBreaker;
    this.rateLimiter = options?.rateLimiter;
    this.storage = options?.storage;
    this.storageKeyPrefix = options?.storageKeyPrefix ?? "ks:";
    this.timeProvider = options?.timeProvider ?? (() => Date.now());

    if (options?.keys) {
      this.addKeys(options.keys);
    }
  }

  /**
   * Current timestamp in milliseconds.
   */
  private now(): number {
    return this.timeProvider();
  }

  /**
   * Normalizes provider name for case-insensitive matching.
   */
  private normalizeProvider(provider: string): string {
    return provider.trim().toLowerCase();
  }

  // =========================================================================
  // Dependency Inversion Setters / Getters
  // =========================================================================

  public setCircuitBreaker(cb: CircuitBreaker): void {
    this.circuitBreaker = cb;
  }

  public getCircuitBreaker(): CircuitBreaker | undefined {
    return this.circuitBreaker;
  }

  public setRateLimiter(rl: RateLimiter): void {
    this.rateLimiter = rl;
  }

  public getRateLimiter(): RateLimiter | undefined {
    return this.rateLimiter;
  }

  // =========================================================================
  // Key Pool Management
  // =========================================================================

  /**
   * Adds or updates a single key in the pool.
   */
  public addKey(key: TKey): void {
    this.keysMap.set(key.id, { ...key });
  }

  /**
   * Adds or updates multiple keys in the pool.
   */
  public addKeys(keys: TKey[]): void {
    for (const key of keys) {
      this.addKey(key);
    }
  }

  /**
   * Removes a key by ID from the pool. Returns true if key was present.
   */
  public removeKey(keyId: string): boolean {
    this.usageCounts.delete(keyId);
    return this.keysMap.delete(keyId);
  }

  /**
   * Replaces all keys in the pool with the provided array.
   */
  public setKeys(keys: TKey[]): void {
    this.keysMap.clear();
    this.addKeys(keys);
  }

  /**
   * Retrieves all keys, optionally filtered by provider.
   */
  public getKeys(provider?: string): TKey[] {
    const all = Array.from(this.keysMap.values());
    if (!provider || provider === "*") {
      return all;
    }
    const target = this.normalizeProvider(provider);
    return all.filter((k) => this.normalizeProvider(k.provider) === target);
  }

  /**
   * Retrieves a single key by ID.
   */
  public getKeyById(keyId: string): TKey | undefined {
    const key = this.keysMap.get(keyId);
    return key ? { ...key } : undefined;
  }

  /**
   * Checks whether a key ID exists in the pool.
   */
  public hasKey(keyId: string): boolean {
    return this.keysMap.has(keyId);
  }

  /**
   * Total number of keys, optionally filtered by provider.
   */
  public getKeyCount(provider?: string): number {
    return this.getKeys(provider).length;
  }

  /**
   * Clears all keys from the pool.
   */
  public clearKeys(): void {
    this.keysMap.clear();
    this.usageCounts.clear();
    this.roundRobinIndices.clear();
  }

  // =========================================================================
  // Status Checks
  // =========================================================================

  /**
   * Checks whether a key's static status allows execution.
   */
  private isStatusPermitted(status?: KeyStatus | string): {
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

  // =========================================================================
  // Key Triage & Health Filtering (LLD 3.3)
  // =========================================================================

  /**
   * Evaluates key health and capacity asynchronously, returning full triage diagnostics.
   */
  public async triageKeys(
    provider?: string,
    options?: { costMicrodollars?: bigint; candidateKeys?: TKey[] }
  ): Promise<KeyTriageResult<TKey>> {
    const candidates = options?.candidateKeys ?? this.getKeys(provider);
    const cost = options?.costMicrodollars ?? 0n;

    const healthyKeys: TKey[] = [];
    const unhealthyKeys: KeyTriageItem<TKey>[] = [];
    const rateLimitedKeys: KeyTriageItem<TKey>[] = [];
    const circuitBrokenKeys: KeyTriageItem<TKey>[] = [];
    const disabledKeys: KeyTriageItem<TKey>[] = [];

    const retryDelays: number[] = [];

    for (const key of candidates) {
      // 1. Static status check
      const statusCheck = this.isStatusPermitted(key.status);
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

      if (this.circuitBreaker) {
        cbAllowed = await this.circuitBreaker.canExecute(key.id);
        cbState = await this.circuitBreaker.getState(key.id);
        if (!cbAllowed) {
          cbRetryAfter = await this.circuitBreaker.getRetryAfterSeconds(key.id);
          cbOpenUntil = await this.circuitBreaker.getCircuitOpenUntil(key.id);
        }
      } else if (key.circuitOpenUntil) {
        const openUntilMs = Date.parse(key.circuitOpenUntil);
        if (!isNaN(openUntilMs) && openUntilMs > this.now()) {
          cbAllowed = false;
          cbRetryAfter = Math.max(1, Math.ceil((openUntilMs - this.now()) / 1000));
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

      if (this.rateLimiter) {
        const limitResult = await this.rateLimiter.checkLimitDetailed(key.id, cost);
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
  public triageKeysSync(
    provider?: string,
    options?: { costMicrodollars?: bigint; candidateKeys?: TKey[] }
  ): KeyTriageResult<TKey> {
    const candidates = options?.candidateKeys ?? this.getKeys(provider);
    const cost = options?.costMicrodollars ?? 0n;

    const healthyKeys: TKey[] = [];
    const unhealthyKeys: KeyTriageItem<TKey>[] = [];
    const rateLimitedKeys: KeyTriageItem<TKey>[] = [];
    const circuitBrokenKeys: KeyTriageItem<TKey>[] = [];
    const disabledKeys: KeyTriageItem<TKey>[] = [];

    const retryDelays: number[] = [];

    for (const key of candidates) {
      // 1. Static status check
      const statusCheck = this.isStatusPermitted(key.status);
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

      if (this.circuitBreaker) {
        cbAllowed = this.circuitBreaker.canExecuteSync(key.id);
        cbState = this.circuitBreaker.getStateSync(key.id);
        if (!cbAllowed) {
          const cbData = this.circuitBreaker.getDataSync(key.id);
          if (cbData && cbData.openedAt !== null) {
            const rem = cbData.openedAt + this.circuitBreaker.cooldownMs - this.now();
            cbRetryAfter = rem > 0 ? Math.ceil(rem / 1000) : 1;
          }
        }
      } else if (key.circuitOpenUntil) {
        const openUntilMs = Date.parse(key.circuitOpenUntil);
        if (!isNaN(openUntilMs) && openUntilMs > this.now()) {
          cbAllowed = false;
          cbRetryAfter = Math.max(1, Math.ceil((openUntilMs - this.now()) / 1000));
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
      if (this.rateLimiter) {
        rlAllowed = this.rateLimiter.checkLimitSync(key.id, cost);
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

  /**
   * Filters out rate-limited or circuit-broken keys and returns only healthy keys.
   */
  public async filterHealthyKeys(
    provider?: string,
    options?: { costMicrodollars?: bigint; candidateKeys?: TKey[] }
  ): Promise<TKey[]> {
    const triage = await this.triageKeys(provider, options);
    return triage.healthyKeys;
  }

  /**
   * Synchronous filter returning only healthy keys.
   */
  public filterHealthyKeysSync(
    provider?: string,
    options?: { costMicrodollars?: bigint; candidateKeys?: TKey[] }
  ): TKey[] {
    const triage = this.triageKeysSync(provider, options);
    return triage.healthyKeys;
  }

  // =========================================================================
  // Selection Algorithms (Round-Robin, Least-Used, Priority)
  // =========================================================================

  /**
   * Retrieves or loads persisted round-robin index for a provider.
   */
  private async getOrLoadRoundRobinIndex(provider: string): Promise<number> {
    const norm = this.normalizeProvider(provider);
    let index = this.roundRobinIndices.get(norm);

    if (index === undefined && this.storage) {
      const storageKey = `${this.storageKeyPrefix}rr:${norm}`;
      const stored = await this.storage.get<number>(storageKey);
      if (typeof stored === "number" && Number.isInteger(stored) && stored >= 0) {
        index = stored;
      } else {
        index = 0;
      }
      this.roundRobinIndices.set(norm, index);
    }

    return index ?? 0;
  }

  /**
   * Persists new round-robin index.
   */
  private async persistRoundRobinIndex(
    provider: string,
    newIndex: number
  ): Promise<void> {
    const norm = this.normalizeProvider(provider);
    this.roundRobinIndices.set(norm, newIndex);
    if (this.storage) {
      const storageKey = `${this.storageKeyPrefix}rr:${norm}`;
      await this.storage.put<number>(storageKey, newIndex);
    }
  }

  /**
   * Internal synchronous round-robin index getter.
   */
  private getRoundRobinIndexSync(provider: string): number {
    const norm = this.normalizeProvider(provider);
    return this.roundRobinIndices.get(norm) ?? 0;
  }

  /**
   * Internal synchronous round-robin index setter.
   */
  private setRoundRobinIndexSync(provider: string, newIndex: number): void {
    const norm = this.normalizeProvider(provider);
    this.roundRobinIndices.set(norm, newIndex);
  }

  /**
   * Implements Round-Robin selection over candidate keys.
   */
  private async selectRoundRobin(
    provider: string,
    healthyKeys: TKey[]
  ): Promise<TKey> {
    const currentIndex = await this.getOrLoadRoundRobinIndex(provider);
    const selected = healthyKeys[currentIndex % healthyKeys.length]!;
    const nextIndex = (currentIndex + 1) % 1_000_000;
    await this.persistRoundRobinIndex(provider, nextIndex);
    return selected;
  }

  /**
   * Synchronous Round-Robin selection over candidate keys.
   */
  private selectRoundRobinSync(provider: string, healthyKeys: TKey[]): TKey {
    const currentIndex = this.getRoundRobinIndexSync(provider);
    const selected = healthyKeys[currentIndex % healthyKeys.length]!;
    const nextIndex = (currentIndex + 1) % 1_000_000;
    this.setRoundRobinIndexSync(provider, nextIndex);
    return selected;
  }

  /**
   * Implements Least-Used / Load-Balanced selection.
   * Prioritizes keys with lowest current RPM load, breaking ties with total invocation counts.
   */
  private async selectLeastUsed(healthyKeys: TKey[]): Promise<TKey> {
    let bestKey = healthyKeys[0]!;
    let minLoad = Infinity;

    for (const key of healthyKeys) {
      let load = 0;
      if (this.rateLimiter) {
        load = await this.rateLimiter.getCurrentRpm(key.id);
      } else {
        load = this.getUsageCount(key.id);
      }

      if (load < minLoad) {
        minLoad = load;
        bestKey = key;
      } else if (load === minLoad) {
        const bestUsage = this.getUsageCount(bestKey.id);
        const candidateUsage = this.getUsageCount(key.id);
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
  private selectLeastUsedSync(healthyKeys: TKey[]): TKey {
    let bestKey = healthyKeys[0]!;
    let minLoad = Infinity;

    for (const key of healthyKeys) {
      let load = 0;
      if (this.rateLimiter) {
        const rlData = this.rateLimiter.getDataSync(key.id);
        if (rlData) {
          load = rlData.entries.reduce((acc, e) => acc + e.count, 0);
        }
      } else {
        load = this.getUsageCount(key.id);
      }

      if (load < minLoad) {
        minLoad = load;
        bestKey = key;
      } else if (load === minLoad) {
        const bestUsage = this.getUsageCount(bestKey.id);
        const candidateUsage = this.getUsageCount(key.id);
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
  private async selectPriority(
    provider: string,
    healthyKeys: TKey[],
    tieBreaker: "round-robin" | "least-used" = "round-robin"
  ): Promise<TKey> {
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

    if (tieBreaker === "least-used") {
      return this.selectLeastUsed(topTier);
    }
    return this.selectRoundRobin(provider, topTier);
  }

  /**
   * Synchronous Priority selection.
   */
  private selectPrioritySync(
    provider: string,
    healthyKeys: TKey[],
    tieBreaker: "round-robin" | "least-used" = "round-robin"
  ): TKey {
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

    if (tieBreaker === "least-used") {
      return this.selectLeastUsedSync(topTier);
    }
    return this.selectRoundRobinSync(provider, topTier);
  }

  // =========================================================================
  // Primary Public Selection Contract (LLD 3.3 & LLD 3.4)
  // =========================================================================

  /**
   * Selects an optimal available key for the requested provider.
   *
   * @param provider - Target model provider (e.g. "openai", "anthropic", "gemini")
   * @param options - Triage, budget, and selection options
   * @returns Selected healthy key
   * @throws KeyExhaustedError if no healthy keys are available and throwOnExhausted is true
   */
  public async selectKey(
    provider: string,
    options?: SelectKeyOptions<TKey>
  ): Promise<TKey> {
    const throwOnExhausted = options?.throwOnExhausted ?? true;
    const strategy = options?.strategy ?? this.defaultStrategy;
    const cost = options?.costMicrodollars ?? 0n;

    // 1. Primary triage for requested provider
    let triage = await this.triageKeys(provider, {
      costMicrodollars: cost,
      candidateKeys: options?.candidateKeys,
    });

    // 2. Multi-provider fallback if requested provider has no healthy keys
    if (
      triage.healthyKeys.length === 0 &&
      options?.fallbackToAnyProvider === true
    ) {
      const fallbackTriage = await this.triageKeys("*", {
        costMicrodollars: cost,
      });
      if (fallbackTriage.healthyKeys.length > 0) {
        triage = fallbackTriage;
      }
    }

    // 3. Exhaustion assertion
    if (triage.healthyKeys.length === 0) {
      if (throwOnExhausted) {
        const total = triage.totalKeys;
        const msg =
          total === 0
            ? `No API keys configured for provider '${provider}'`
            : `All ${total} keys for provider '${provider}' are exhausted, rate limited, or circuit broken`;

        throw new KeyExhaustedError(msg, {
          provider,
          tenantId: this.tenantId,
          totalKeys: total,
          retryAfterSeconds: triage.minRetryAfterSeconds,
        });
      }
      return null as unknown as TKey;
    }

    // 4. Algorithm dispatch
    let selected: TKey;
    const effectiveProvider = triage.healthyKeys[0]?.provider ?? provider;

    switch (strategy) {
      case "least-used":
      case "load-balanced":
        selected = await this.selectLeastUsed(triage.healthyKeys);
        break;

      case "priority":
        selected = await this.selectPriority(
          effectiveProvider,
          triage.healthyKeys,
          "round-robin"
        );
        break;

      case "random": {
        const idx = Math.floor(Math.random() * triage.healthyKeys.length);
        selected = triage.healthyKeys[idx]!;
        break;
      }

      case "round-robin":
      default:
        selected = await this.selectRoundRobin(
          effectiveProvider,
          triage.healthyKeys
        );
        break;
    }

    // 5. Update usage telemetry
    this.recordUsage(selected.id);
    selected.lastUsedAt = new Date(this.now()).toISOString();

    return selected;
  }

  /**
   * Synchronous key selection from in-memory hot state.
   * Suitable for proxy hot-path (<0.5ms) without async I/O.
   */
  public selectKeySync(
    provider: string,
    options?: SelectKeyOptions<TKey>
  ): TKey | null {
    const throwOnExhausted = options?.throwOnExhausted ?? true;
    const strategy = options?.strategy ?? this.defaultStrategy;
    const cost = options?.costMicrodollars ?? 0n;

    let triage = this.triageKeysSync(provider, {
      costMicrodollars: cost,
      candidateKeys: options?.candidateKeys,
    });

    if (
      triage.healthyKeys.length === 0 &&
      options?.fallbackToAnyProvider === true
    ) {
      const fallbackTriage = this.triageKeysSync("*", {
        costMicrodollars: cost,
      });
      if (fallbackTriage.healthyKeys.length > 0) {
        triage = fallbackTriage;
      }
    }

    if (triage.healthyKeys.length === 0) {
      if (throwOnExhausted) {
        const total = triage.totalKeys;
        const msg =
          total === 0
            ? `No API keys configured for provider '${provider}'`
            : `All ${total} keys for provider '${provider}' are exhausted, rate limited, or circuit broken`;

        throw new KeyExhaustedError(msg, {
          provider,
          tenantId: this.tenantId,
          totalKeys: total,
          retryAfterSeconds: triage.minRetryAfterSeconds,
        });
      }
      return null;
    }

    let selected: TKey;
    const effectiveProvider = triage.healthyKeys[0]?.provider ?? provider;

    switch (strategy) {
      case "least-used":
      case "load-balanced":
        selected = this.selectLeastUsedSync(triage.healthyKeys);
        break;

      case "priority":
        selected = this.selectPrioritySync(
          effectiveProvider,
          triage.healthyKeys,
          "round-robin"
        );
        break;

      case "random": {
        const idx = Math.floor(Math.random() * triage.healthyKeys.length);
        selected = triage.healthyKeys[idx]!;
        break;
      }

      case "round-robin":
      default:
        selected = this.selectRoundRobinSync(
          effectiveProvider,
          triage.healthyKeys
        );
        break;
    }

    this.recordUsage(selected.id);
    selected.lastUsedAt = new Date(this.now()).toISOString();

    return selected;
  }

  // =========================================================================
  // Telemetry, Metrics & Capacity Reporting
  // =========================================================================

  /**
   * Increments internal invocation counter for least-used selection.
   */
  public recordUsage(keyId: string): void {
    const current = this.usageCounts.get(keyId) ?? 0;
    this.usageCounts.set(keyId, current + 1);
  }

  /**
   * Returns current internal invocation count for a key ID.
   */
  public getUsageCount(keyId: string): number {
    return this.usageCounts.get(keyId) ?? 0;
  }

  /**
   * Resets all internal invocation counters.
   */
  public resetUsage(): void {
    this.usageCounts.clear();
  }

  /**
   * Returns KeyMetrics for a key ID, conforming to KeyPoolContract.
   */
  public async getKeyMetrics(keyId: string): Promise<KeyMetrics> {
    const rpm = this.rateLimiter
      ? await this.rateLimiter.getCurrentRpm(keyId)
      : 0;

    const circuitBreakerTripped = this.circuitBreaker
      ? (await this.circuitBreaker.getState(keyId)) === "OPEN"
      : false;

    const costAccumulatedMicrodollars = this.rateLimiter
      ? await this.rateLimiter.getAccumulatedCost(keyId)
      : 0n;

    return {
      rpm,
      circuitBreakerTripped,
      costAccumulatedMicrodollars,
    };
  }

  /**
   * Computes comprehensive RPM capacity and utilization summary.
   */
  public async getCapacitySummary(provider?: string): Promise<CapacitySummary> {
    const keys = this.getKeys(provider);
    const triage = await this.triageKeys(provider);

    let totalRpmLimit = 0;
    let currentRpm = 0;

    for (const key of keys) {
      const limit = key.rpmLimit ?? DEFAULT_RPM_LIMIT;
      totalRpmLimit += limit;

      if (this.rateLimiter) {
        currentRpm += await this.rateLimiter.getCurrentRpm(key.id);
      }
    }

    const remainingRpm = Math.max(0, totalRpmLimit - currentRpm);
    const utilizationPercent =
      totalRpmLimit > 0
        ? Math.min(100, Math.round((currentRpm / totalRpmLimit) * 100))
        : 0;

    return {
      provider,
      totalKeys: keys.length,
      healthyKeys: triage.healthyKeys.length,
      totalRpmLimit,
      currentRpm,
      remainingRpm,
      utilizationPercent,
    };
  }

  /**
   * Returns current round-robin index for a provider.
   */
  public async getRoundRobinIndex(provider: string): Promise<number> {
    return this.getOrLoadRoundRobinIndex(provider);
  }

  /**
   * Manually sets round-robin index for a provider.
   */
  public async setRoundRobinIndex(
    provider: string,
    index: number
  ): Promise<void> {
    await this.persistRoundRobinIndex(provider, index);
  }

  /**
   * Clears memory cache (simulates DO instance eviction).
   */
  public clearMemoryCache(): void {
    this.roundRobinIndices.clear();
    this.usageCounts.clear();
  }
}
