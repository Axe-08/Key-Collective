/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * KeySelector Class Implementation
 */

import {
  DEFAULT_RPM_LIMIT,
} from "../../constants/limits";
import { KeyMetrics } from "../../contracts/key_pool";
import { KeyExhaustedError } from "../../errors/key_errors";
import type {
  CircuitBreaker,
  DurableObjectStorageLike,
} from "../circuit_breaker";
import type { RateLimiter } from "../rate_limiter";
import {
  selectLeastUsed,
  selectLeastUsedSync,
  selectPriority,
  selectPrioritySync,
  selectRoundRobin,
  selectRoundRobinSync,
  StrategyContext,
} from "./strategies";
import {
  triageKeysAsync,
  triageKeysSync,
} from "./triage";
import type {
  CapacitySummary,
  KeySelectionStrategy,
  KeySelectorOptions,
  KeyTriageResult,
  SelectableKey,
  SelectKeyOptions,
} from "./types";

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
    const costMicrodollars = options?.costMicrodollars ?? 0n;

    return triageKeysAsync({
      candidates,
      provider,
      costMicrodollars,
      circuitBreaker: this.circuitBreaker,
      rateLimiter: this.rateLimiter,
      now: () => this.now(),
    });
  }

  /**
   * Synchronous triage check using in-memory state.
   */
  public triageKeysSync(
    provider?: string,
    options?: { costMicrodollars?: bigint; candidateKeys?: TKey[] }
  ): KeyTriageResult<TKey> {
    const candidates = options?.candidateKeys ?? this.getKeys(provider);
    const costMicrodollars = options?.costMicrodollars ?? 0n;

    return triageKeysSync({
      candidates,
      provider,
      costMicrodollars,
      circuitBreaker: this.circuitBreaker,
      rateLimiter: this.rateLimiter,
      now: () => this.now(),
    });
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
  // Round-Robin State Persistence
  // =========================================================================

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

  private getRoundRobinIndexSync(provider: string): number {
    const norm = this.normalizeProvider(provider);
    return this.roundRobinIndices.get(norm) ?? 0;
  }

  private setRoundRobinIndexSync(provider: string, newIndex: number): void {
    const norm = this.normalizeProvider(provider);
    this.roundRobinIndices.set(norm, newIndex);
  }

  private createStrategyContext(
    provider: string,
    healthyKeys: TKey[]
  ): StrategyContext<TKey> {
    return {
      provider,
      healthyKeys,
      rateLimiter: this.rateLimiter,
      getUsageCount: (keyId) => this.getUsageCount(keyId),
      getRoundRobinIndex: (p) => this.getOrLoadRoundRobinIndex(p),
      persistRoundRobinIndex: (p, idx) => this.persistRoundRobinIndex(p, idx),
      getRoundRobinIndexSync: (p) => this.getRoundRobinIndexSync(p),
      setRoundRobinIndexSync: (p, idx) => this.setRoundRobinIndexSync(p, idx),
    };
  }

  // =========================================================================
  // Primary Public Selection Contract (LLD 3.3 & LLD 3.4)
  // =========================================================================

  /**
   * Selects an optimal available key for the requested provider.
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
    const stratCtx = this.createStrategyContext(effectiveProvider, triage.healthyKeys);

    switch (strategy) {
      case "least-used":
      case "load-balanced":
        selected = await selectLeastUsed(stratCtx);
        break;

      case "priority":
        selected = await selectPriority(stratCtx, "round-robin");
        break;

      case "random": {
        const idx = Math.floor(Math.random() * triage.healthyKeys.length);
        selected = triage.healthyKeys[idx]!;
        break;
      }

      case "round-robin":
      default:
        selected = await selectRoundRobin(stratCtx);
        break;
    }

    // 5. Update usage telemetry
    this.recordUsage(selected.id);
    selected.lastUsedAt = new Date(this.now()).toISOString();

    return selected;
  }

  /**
   * Synchronous key selection from in-memory hot state.
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
    const stratCtx = this.createStrategyContext(effectiveProvider, triage.healthyKeys);

    switch (strategy) {
      case "least-used":
      case "load-balanced":
        selected = selectLeastUsedSync(stratCtx);
        break;

      case "priority":
        selected = selectPrioritySync(stratCtx, "round-robin");
        break;

      case "random": {
        const idx = Math.floor(Math.random() * triage.healthyKeys.length);
        selected = triage.healthyKeys[idx]!;
        break;
      }

      case "round-robin":
      default:
        selected = selectRoundRobinSync(stratCtx);
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
